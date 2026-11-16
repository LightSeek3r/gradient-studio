// Pure analysis of a document's text: no `vscode` import, no I/O, no state.
// The extension adapter (extension.ts) only turns these plain objects into
// VS Code objects. All offsets are UTF-16 code units into the string passed in,
// which is what `TextDocument.positionAt` / `offsetAt` use (CRLF counts as two).
//
// Scoring logic lives in `@opal42/gradient`; nothing here judges a gradient.

import {
  parseGradient,
  proposeFixes,
  refine,
  resolveStops,
  scoreParsed,
  type GradientDocument,
  type Issue,
  type ParsedGradient,
  type ScoreResult,
  type SkipCode,
} from "@opal42/gradient";

/** Language ids the extension activates for (kept equal to `activationEvents` by a test). */
export const LANGUAGE_IDS = [
  "css",
  "scss",
  "less",
  "html",
  "vue",
  "svelte",
  "astro",
  "javascriptreact",
  "typescriptreact",
  "javascript",
  "typescript",
  "markdown",
  "mdx",
] as const;

/** Stylesheet languages: a gradient inside a quoted string (`content: "..."`) is not a gradient there. */
const STYLESHEET_IDS: ReadonlySet<string> = new Set(["css", "scss", "less"]);

export interface Range {
  start: number;
  end: number;
}

export interface Settings {
  /** Below this score diagnostics become errors. Unset by default (PLAN D5). */
  minScore: number | undefined;
  /** Give not-scored gradients a lens too. */
  showSkipped: boolean;
  /** Documents larger than this many kilobytes are not analysed. */
  maxFileSizeKB: number;
  /** Most gradients analysed per document. */
  maxGradients: number;
  /** Stop analysing after this many milliseconds (unset: no time limit; tests are deterministic). */
  budgetMs: number | undefined;
}

export const DEFAULT_SETTINGS: Settings = {
  minScore: undefined,
  showSkipped: false,
  maxFileSizeKB: 500,
  maxGradients: 1500,
  budgetMs: undefined,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Turn loosely typed configuration values into valid settings. Never throws. */
export function normalizeSettings(raw: Partial<Record<keyof Settings, unknown>> | undefined | null): Settings {
  const r = raw ?? {};
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const min = num(r.minScore);
  const size = num(r.maxFileSizeKB);
  const count = num(r.maxGradients);
  const budget = num(r.budgetMs);
  return {
    minScore: min === undefined ? undefined : clamp(min, 0, 100),
    showSkipped: r.showSkipped === true,
    maxFileSizeKB: size === undefined ? DEFAULT_SETTINGS.maxFileSizeKB : clamp(size, 1, 2000),
    maxGradients: count === undefined ? DEFAULT_SETTINGS.maxGradients : clamp(Math.floor(count), 1, 20000),
    budgetMs: budget === undefined || budget <= 0 ? undefined : budget,
  };
}

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface FindingDiagnostic {
  range: Range;
  /** The finding code, e.g. `lightness/reversal`. */
  code: string;
  message: string;
  severity: DiagnosticSeverity;
  /** The finding as the core reports it. */
  issue: Issue;
}

export interface Lens {
  /** Zero-width range at the start of the gradient. */
  range: Range;
  title: string;
}

export interface AnalyzedGradient {
  /** Position in the document's gradient list. */
  index: number;
  /** The whole function, name to closing parenthesis. */
  range: Range;
  /** `stopRanges[i]` is the source of `parsed.document.stops[i]`. */
  stopRanges: Range[];
  status: "scored" | "skipped";
  score?: number;
  dimensions?: Record<"lightness" | "hue" | "chroma" | "spacing", number>;
  issues: Issue[];
  skip?: { code: string; reason: string };
  diagnostics: FindingDiagnostic[];
  /** Null for a skipped gradient unless `showSkipped` is set. */
  lens: Lens | null;
  /** Parser output, kept for fixes, the swatch and the Studio link. */
  parsed: ParsedGradient;
}

export type AnalysisLimit = "size" | "count" | "time" | "input";

export interface Analysis {
  items: AnalyzedGradient[];
  /** UTF-8 size of the text. */
  bytes: number;
  /** Set when the result is incomplete or empty because of a cap. */
  limit?: AnalysisLimit;
}

/** UTF-8 length of `text`. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

const GRADIENT_HINT = /gradient\(/i;

/** Start offsets inside a quoted string of a stylesheet value (ported from the Stylelint plugin). */
function stringSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (c === "/" && text[i + 1] === "/" && text[i - 1] !== ":") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end + 1;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      spans.push([i + 1, Math.min(j, text.length)]);
      i = j + 1;
    } else if (c === "\\") {
      i += 2;
    } else {
      i++;
    }
  }
  return spans;
}

/** Plain words for a skip code, used in the lens: "Not scored - uses var()". */
export const SKIP_WORDS: Readonly<Record<string, string>> = {
  var: "uses var()",
  calc: "uses calc() or another math function",
  env: "uses env()",
  currentColor: "uses currentColor",
  "color-mix": "uses color-mix()",
  "relative-color": "uses relative colour syntax",
  "lab-lch": "uses lab() or lch()",
  "color-function": "uses color()",
  "system-color": "uses a system colour",
  "unknown-color": "colour not understood",
  "length-position": "stop position in a length unit",
  "too-many-stops": "too many stops",
  "interpolation-space": "interpolation space not supported",
  preprocessor: "uses a preprocessor or template expression",
  syntax: "not a plain linear gradient",
  unbalanced: "not closed",
  "too-long": "too long",
  "too-deep": "nested too deeply",
  "legacy-syntax": "vendor-prefixed or legacy syntax",
  "unsupported-kind": "radial or conic gradient",
  repeating: "repeating gradient",
  alpha: "has transparent stops",
  "hard-stops": "has hard stops (stripes)",
  "too-few-stops": "fewer than two stops",
  "invalid-color": "colour not understood",
};

export function skipWords(code: string): string {
  return Object.prototype.hasOwnProperty.call(SKIP_WORDS, code) ? SKIP_WORDS[code] : code;
}

type Ok = Extract<ScoreResult, { status: "ok" }>;

/** Lens text: "Smoothness 72 - 2 issues". Neutral wording, no verdict. */
export function lensTitle(score: number, issueCount: number): string {
  const issues = issueCount === 0 ? "no issues" : issueCount === 1 ? "1 issue" : `${issueCount} issues`;
  return `Smoothness ${score} - ${issues}`;
}

export function skippedLensTitle(code: string): string {
  return `Not scored - ${skipWords(code)}`;
}

function severityOf(issue: Issue, belowMin: boolean): DiagnosticSeverity {
  if (belowMin) return "error";
  return issue.severity === "info" ? "info" : "warning";
}

function diagnosticsFor(g: ParsedGradient, result: Ok, minScore: number | undefined): FindingDiagnostic[] {
  const belowMin = minScore !== undefined && result.score < minScore;
  return result.issues.map((issue) => ({
    range: issue.range ?? g.range,
    code: issue.code,
    message: `${issue.message} (-${issue.pointsLost} points)`,
    severity: severityOf(issue, belowMin),
    issue,
  }));
}

function judge(g: ParsedGradient, index: number, settings: Settings): AnalyzedGradient {
  const base = { index, range: g.range, stopRanges: g.stopRanges, parsed: g };
  const result = scoreParsed(g);
  const skip = (code: string, reason: string): AnalyzedGradient => ({
    ...base,
    status: "skipped",
    issues: [],
    skip: { code, reason },
    diagnostics: [],
    lens: settings.showSkipped ? { range: { start: g.range.start, end: g.range.start }, title: skippedLensTitle(code) } : null,
  });
  if (result.status !== "ok") return skip(result.code, result.reason);
  if (result.analysis.hasHardStops) {
    return skip("hard-stops", "Two neighbouring stops share a position, which makes a hard edge. The v1 score does not judge stripes.");
  }
  return {
    ...base,
    status: "scored",
    score: result.score,
    dimensions: result.dimensions,
    issues: result.issues,
    diagnostics: diagnosticsFor(g, result, settings.minScore),
    lens: { range: { start: g.range.start, end: g.range.start }, title: lensTitle(result.score, result.issues.length) },
  };
}

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Find and score the gradients in `text`. Pure and deterministic (except the
 * optional `budgetMs`). Never throws: any internal failure yields an empty,
 * flagged result instead.
 */
export function analyze(text: string, languageId: string, settings?: Partial<Record<keyof Settings, unknown>>): Analysis {
  const s = normalizeSettings(settings);
  try {
    if (typeof text !== "string") return { items: [], bytes: 0 };
    const maxBytes = s.maxFileSizeKB * 1024;
    // UTF-8 takes at least one byte per UTF-16 unit: a text longer than the cap is too large
    // without encoding it.
    if (text.length > maxBytes) return { items: [], bytes: text.length, limit: "size" };
    const bytes = utf8Length(text);
    if (bytes > maxBytes) return { items: [], bytes, limit: "size" };
    if (!GRADIENT_HINT.test(text)) return { items: [], bytes };

    const parsed = parseGradient(text, { maxInputLength: 4_000_000 });
    let gradients = parsed.gradients;
    if (gradients.length > 0 && STYLESHEET_IDS.has(languageId) && /["']/.test(text)) {
      const spans = stringSpans(text);
      gradients = gradients.filter((g) => !spans.some(([a, b]) => g.range.start >= a && g.range.start < b));
    }

    const started = s.budgetMs === undefined ? 0 : now();
    const items: AnalyzedGradient[] = [];
    let limit: AnalysisLimit | undefined = parsed.truncated ? "input" : undefined;
    for (let i = 0; i < gradients.length; i++) {
      if (i >= s.maxGradients) {
        limit = "count";
        break;
      }
      if (s.budgetMs !== undefined && i % 16 === 15 && now() - started > s.budgetMs) {
        limit = "time";
        break;
      }
      items.push(judge(gradients[i], items.length, s));
    }
    return limit ? { items, bytes, limit } : { items, bytes };
  } catch {
    return { items: [], bytes: 0, limit: "input" };
  }
}

/** The gradient whose range contains `offset` (end inclusive), the innermost first-start one. */
export function gradientAt(items: readonly AnalyzedGradient[], offset: number): AnalyzedGradient | undefined {
  return items.find((g) => offset >= g.range.start && offset <= g.range.end);
}

/** Gradients whose range touches `[start, end]`. */
export function gradientsIn(items: readonly AnalyzedGradient[], start: number, end: number): AnalyzedGradient[] {
  return items.filter((g) => g.range.start <= end && g.range.end >= start);
}

// ── Fixes ────────────────────────────────────────────────────────────────────

export interface TextEdit {
  start: number;
  end: number;
  newText: string;
}

export interface FixAction {
  kind: "fix" | "refine";
  /** The finding removed (fixes only). */
  code?: string;
  /** Core label, e.g. "Make stop 2 darker". */
  label: string;
  /** "Apply fix: Make stop 2 darker (+12)" / "Refine whole gradient (+12)". */
  title: string;
  gain: number;
  scoreBefore: number;
  scoreAfter: number;
  /** Replacements of stop arguments only, ascending, non-overlapping, offsets into the analysed text. */
  edits: TextEdit[];
  changedStops: number[];
  /** The gradient document after the fix. */
  document: GradientDocument;
  /** The whole gradient function after the edits. */
  newGradientText: string;
}

/** Apply non-overlapping edits (offsets into `text`). */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  return out;
}

const SCALE = 1e4;
/** A percentage with at most 4 decimals and no trailing zeros. */
function pct(position: number): string {
  const v = Math.round(position * 100 * SCALE) / SCALE;
  return `${Object.is(v, -0) ? 0 : v}%`;
}

const HEX = /^#[0-9a-f]{6}$/;

/** Why a gradient's stop arguments cannot be rewritten one by one, or null when they can. */
export function fixBlocked(g: ParsedGradient): string | null {
  const doc = g.document;
  if (!doc || g.skipped) return "not parsed";
  if (g.kind !== "linear" || g.repeating || g.vendorPrefix) return "not a plain linear gradient";
  if (g.warnings.some((w) => w.code === "color-hint-ignored")) return "colour hint";
  if (doc.stops.some((s) => s.alpha !== undefined && s.alpha < 1)) return "translucent stop";
  if (g.stopRanges.length !== doc.stops.length) return "stop ranges";
  for (let i = 1; i < g.stopRanges.length; i++) {
    if (g.stopRanges[i].start <= g.stopRanges[i - 1].start) return "double-position stop";
  }
  return null;
}

/**
 * The edits turning `doc` into `next` (same stops, same order). Only the
 * source of stops that changed is replaced, by `#rrggbb[ N%]`. With `force`,
 * every stop without an explicit position gets one (needed when moving a
 * neighbour would otherwise shift an automatically placed stop).
 */
function planEdits(g: ParsedGradient, next: GradientDocument, force: boolean): TextEdit[] | null {
  const doc = g.document as GradientDocument;
  if (next.stops.length !== doc.stops.length) return null;
  const was = resolveStops(doc);
  const will = resolveStops(next);
  const edits: TextEdit[] = [];
  for (let i = 0; i < doc.stops.length; i++) {
    const n = next.stops[i];
    const old = doc.stops[i];
    if (typeof n.color !== "string" || !HEX.test(n.color)) return null;
    const moved = Math.abs(will[i].position - was[i].position) >= 1e-9;
    const auto = old.position === undefined;
    const needsExplicit = !auto || moved || (force && auto);
    if (n.color === old.color && !moved && !(force && auto)) continue;
    const r = g.stopRanges[i];
    edits.push({ start: r.start, end: r.end, newText: needsExplicit ? `${n.color} ${pct(will[i].position)}` : n.color });
  }
  return edits;
}

interface Candidate {
  kind: "fix" | "refine";
  code?: string;
  label: string;
  gain: number;
  before: Ok;
  after: Ok;
  document: GradientDocument;
  changedStops: number[];
}

const tagged = (doc: GradientDocument): GradientDocument => ({ ...doc, stops: doc.stops.map((s, i) => ({ ...s, id: String(i) })) });

/** Re-parse the rewritten gradient and require the score the candidate promised. */
function verify(text: string, item: AnalyzedGradient, edits: TextEdit[], expected: number): string | null {
  const slice = text.slice(item.range.start, item.range.end);
  const local = edits.map((e) => ({ ...e, start: e.start - item.range.start, end: e.end - item.range.start }));
  const next = applyEdits(slice, local);
  const { gradients } = parseGradient(next);
  if (gradients.length !== 1 || gradients[0].range.start !== 0 || gradients[0].range.end !== next.length) return null;
  const doc = gradients[0].document;
  if (!doc || fixBlocked(gradients[0]) !== null || doc.stops.length !== item.parsed.document?.stops.length) return null;
  const r = scoreParsed(gradients[0]);
  if (r.status !== "ok" || r.analysis.hasHardStops || r.score !== expected) return null;
  return next;
}

function toAction(text: string, item: AnalyzedGradient, c: Candidate): FixAction | null {
  const g = item.parsed;
  if (c.after.score <= c.before.score) return null;
  for (const force of [false, true]) {
    const edits = planEdits(g, c.document, force);
    if (!edits || edits.length === 0) return null;
    // Edits must stay inside stop arguments.
    if (!edits.every((e) => g.stopRanges.some((r) => e.start >= r.start && e.end <= r.end))) return null;
    const newGradientText = verify(text, item, edits, c.after.score);
    if (newGradientText === null) continue;
    const gain = c.after.score - c.before.score;
    return {
      kind: c.kind,
      code: c.code,
      label: c.label,
      title: c.kind === "refine" ? `Refine whole gradient (+${gain})` : `Apply fix: ${c.label} (+${gain})`,
      gain,
      scoreBefore: c.before.score,
      scoreAfter: c.after.score,
      edits,
      changedStops: g.stopRanges.flatMap((r, i) => (edits.some((e) => e.start >= r.start && e.end <= r.end) ? [i] : [])),
      document: c.document,
      newGradientText,
    };
  }
  return null;
}

/**
 * Verified edits for one scored gradient: one per targeted fix of the core's
 * `proposeFixes`, then the whole-gradient refinement. Each rewrite was
 * re-parsed and re-scored from the rewritten text. Empty for gradients that
 * cannot be rewritten stop by stop (see `fixBlocked`). Never throws.
 */
export function computeFixes(text: string, item: AnalyzedGradient): FixAction[] {
  try {
    if (item.status !== "scored" || fixBlocked(item.parsed) !== null) return [];
    const doc = item.parsed.document as GradientDocument;
    const out: FixAction[] = [];
    const seen = new Set<string>();
    const push = (a: FixAction | null) => {
      if (!a || seen.has(a.newGradientText)) return;
      seen.add(a.newGradientText);
      out.push(a);
    };
    for (const f of proposeFixes(tagged(doc))) {
      if (f.before.status !== "ok" || f.after.status !== "ok") continue;
      push(
        toAction(text, item, {
          kind: "fix",
          code: f.code,
          label: f.label,
          gain: f.gain,
          before: f.before,
          after: f.after,
          document: f.document,
          changedStops: f.changedStops,
        }),
      );
    }
    const r = refine(tagged(doc));
    if (r.refined && r.before.status === "ok" && r.after.status === "ok") {
      const changed = r.document.stops.map((_, i) => i);
      push(
        toAction(text, item, {
          kind: "refine",
          label: "Refine whole gradient",
          gain: r.after.score - r.before.score,
          before: r.before,
          after: r.after,
          document: r.document,
          changedStops: changed,
        }),
      );
    }
    return out;
  } catch {
    return [];
  }
}

/** The fix with the largest gain (ties: fewer edits), or undefined. */
export function bestFix(fixes: readonly FixAction[]): FixAction | undefined {
  return [...fixes].sort((a, b) => b.gain - a.gain || a.edits.length - b.edits.length)[0];
}

export type { SkipCode };
