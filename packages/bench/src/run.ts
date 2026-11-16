// The run layer: results records in, per-brief scored records out.

import { hexToRgb, refine, rgbToOklab, score, type GradientDocument } from "@opal42/gradient";
import type { BriefSet } from "./briefs";
import { round } from "./canon";
import { extractGradients, type ExtractedGradient, type ExtractOptions } from "./extract";
import { mean } from "./stats";
import type { Diagnostic, ResultRecord } from "./results";

export type GradientStatus = "scored" | "skipped" | "unscorable";

export interface GradientResult {
  form: string;
  /** The text scored, cut to 200 characters. */
  css: string;
  status: GradientStatus;
  /** Parser skip code or core unscorable code. */
  code?: string;
  score?: number;
  dimensions?: { lightness: number; chroma: number; hue: number; spacing: number };
  /** Distinct v1 finding codes of this gradient. */
  findingCodes: string[];
  hasHardStops?: boolean;
  stops?: number;
  refine?: {
    /** Core's `refined` flag (also true when only positions were rewritten). */
    refined: boolean;
    /** True when at least one stop colour moved by more than COLOUR_CHANGE_EPSILON. */
    colourChanged: boolean;
    scoreAfter: number;
    /** Mean OKLAB distance between original and refined stop colours (0 when not refined). */
    meanDeltaE: number;
    maxDeltaE: number;
  };
}

export interface BriefRecord {
  briefId: string;
  category: string;
  model: string;
  condition: string;
  sample: number;
  synthetic: boolean;
  outputChars: number;
  found: number;
  scored: number;
  anyGradientFound: boolean;
  /** scored / found; null when nothing was found. */
  scorableRatio: number | null;
  minScore: number | null;
  meanScore: number | null;
  findingCodes: Record<string, number>;
  /** Scored gradients whose colours refine would change. */
  colourChangedCount: number;
  /** Mean over those gradients of their mean stop ΔE; null when there are none. */
  meanRefineDeltaE: number | null;
  duplicatesDropped: number;
  notes: string[];
  gradients: GradientResult[];
}

/** OKLAB distance below which a refined colour counts as unchanged (rounding noise). */
export const COLOUR_CHANGE_EPSILON = 0.0005;

export function recordKey(r: { briefId: string; model: string; condition: string; sample: number }): string {
  return `${r.briefId}\u0000${r.model}\u0000${r.condition}\u0000${r.sample}`;
}

function oklabOf(hex: string) {
  return rgbToOklab(hexToRgb(hex));
}

/** OKLAB Euclidean distance between two `#rrggbb` colours (black to white is 1). */
export function deltaEOK(a: string, b: string): number {
  const x = oklabOf(a);
  const y = oklabOf(b);
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}

function refineDeltas(before: GradientDocument, after: GradientDocument): { mean: number; max: number } {
  const n = Math.min(before.stops.length, after.stops.length);
  if (n === 0 || before.stops.length !== after.stops.length) return { mean: 0, max: 0 };
  const ds: number[] = [];
  for (let i = 0; i < n; i++) ds.push(deltaEOK(before.stops[i]!.color, after.stops[i]!.color));
  return { mean: mean(ds), max: Math.max(...ds) };
}

export function scoreGradientResult(g: ExtractedGradient): GradientResult {
  const base = { form: g.form, css: g.css.length > 200 ? g.css.slice(0, 200) : g.css, findingCodes: [] as string[] };
  if (!g.document) return { ...base, status: "skipped", code: g.skipped?.code ?? "unknown" };
  const s = score(g.document);
  if (s.status !== "ok") return { ...base, status: "unscorable", code: s.code, stops: g.document.stops.length };
  const out: GradientResult = {
    ...base,
    status: "scored",
    score: s.score,
    dimensions: { ...s.dimensions },
    findingCodes: [...new Set(s.issues.map((i) => i.code))].sort(),
    hasHardStops: s.analysis.hasHardStops,
    stops: g.document.stops.length,
  };
  const r = refine(g.document);
  const after = r.after.status === "ok" ? r.after.score : s.score;
  const d = r.refined ? refineDeltas(g.document, r.document) : { mean: 0, max: 0 };
  out.refine = { refined: r.refined, colourChanged: d.max > COLOUR_CHANGE_EPSILON, scoreAfter: after, meanDeltaE: round(d.mean, 4) ?? 0, maxDeltaE: round(d.max, 4) ?? 0 };
  return out;
}

export function scoreOutput(r: ResultRecord, category: string, opts: ExtractOptions): BriefRecord {
  const ex = extractGradients(r.output, opts);
  const gradients = ex.gradients.map(scoreGradientResult);
  const scoredG = gradients.filter((g) => g.status === "scored");
  const scores = scoredG.map((g) => g.score!);
  const codes: Record<string, number> = {};
  for (const g of scoredG) for (const c of g.findingCodes) codes[c] = (codes[c] ?? 0) + 1;
  const changed = scoredG.filter((g) => g.refine?.colourChanged);
  return {
    briefId: r.briefId,
    category,
    model: r.model,
    condition: r.condition,
    sample: r.sample,
    synthetic: r.synthetic,
    outputChars: r.output.length,
    found: gradients.length,
    scored: scoredG.length,
    anyGradientFound: gradients.length > 0,
    scorableRatio: gradients.length ? round(scoredG.length / gradients.length, 4) : null,
    minScore: scores.length ? Math.min(...scores) : null,
    meanScore: scores.length ? round(mean(scores), 4) : null,
    findingCodes: Object.fromEntries(Object.entries(codes).sort(([a], [b]) => (a < b ? -1 : 1))),
    colourChangedCount: changed.length,
    meanRefineDeltaE: changed.length ? round(mean(changed.map((g) => g.refine!.meanDeltaE)), 4) : null,
    duplicatesDropped: ex.duplicatesDropped,
    notes: ex.notes,
    gradients,
  };
}

/** Scores result records against a brief set. Unknown briefs and duplicates are diagnostics, not records. */
export function scoreRecords(records: readonly ResultRecord[], briefs: BriefSet, opts: ExtractOptions = {}, source = "<memory>"): { records: BriefRecord[]; diagnostics: Diagnostic[] } {
  const category = new Map(briefs.briefs.map((b) => [b.id, b.category]));
  const seen = new Set<string>();
  const out: BriefRecord[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const r of records) {
    const cat = category.get(r.briefId);
    if (cat === undefined) {
      diagnostics.push({ source, code: "unknown-brief", message: `briefId "${r.briefId}" is not in the brief set; record ignored` });
      continue;
    }
    const key = recordKey(r);
    if (seen.has(key)) {
      diagnostics.push({ source, code: "duplicate-record", message: `duplicate (briefId, model, condition, sample) for "${r.briefId}" / "${r.model}" / "${r.condition}" / ${r.sample}; later record ignored` });
      continue;
    }
    seen.add(key);
    out.push(scoreOutput(r, cat, opts));
  }
  return { records: out, diagnostics };
}
