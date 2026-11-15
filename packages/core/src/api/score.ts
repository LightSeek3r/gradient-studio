// ── score / scoreParsed / refine: the v1 engine behind the document API ────────
// No scoring logic lives here. These functions validate a GradientDocument,
// convert units (positions 0-1 → 0-100), call the frozen v1 engine and
// translate its findings. A gradient outside the v1 domain is `unscorable`,
// never a number.

import { isValidStopColor, refineGradient, scoreGradient, type GradientTick } from "../gradient-engine";
import { V1_MODEL } from "../scoring-model-v1";
import { isDocumentLike, resolveStops, stopAlpha } from "./document";
import type {
  GradientDocument,
  Issue,
  ParsedGradient,
  RefineOutcome,
  ResolvedStop,
  ScoreOptions,
  ScoreResult,
  SourceRange,
  Stop,
  UnscorableCode,
} from "./types";

const unscorable = (code: UnscorableCode, reason: string): ScoreResult => ({ status: "unscorable", code, reason });

/**
 * Position 0-1 → the engine's 0-100, with the binary noise of the round trip
 * through /100 removed (0.3 * 100 is 30.000000000000004), so that a document
 * parsed from `30%` scores exactly like the engine's own `30`.
 */
function toPercent(position: number): number {
  return Math.round(position * 1e12) / 1e10;
}

type Prepared = { ticks: GradientTick[]; resolved: ResolvedStop[] } | { error: ScoreResult };

/** Engine input for a document, or why it is outside the v1 domain. */
function prepare(doc: GradientDocument): Prepared {
  if (!isDocumentLike(doc)) return { error: unscorable("invalid-document", "not a gradient document") };
  if (doc.kind !== "linear") {
    return { error: unscorable("unsupported-kind", `only linear gradients are scored (kind: ${String(doc.kind)})`) };
  }
  if (doc.repeating) return { error: unscorable("repeating", "repeating gradients are outside the v1 model") };
  const min = V1_MODEL.domain.minStops;
  if (doc.stops.length < min) return { error: unscorable("too-few-stops", `needs at least ${min} stops`) };
  for (let i = 0; i < doc.stops.length; i++) {
    const s = doc.stops[i];
    if (!isValidStopColor(s.color)) {
      return { error: unscorable("invalid-color", `stop ${i}: colour is not an opaque #rrggbb hex colour`) };
    }
    const alpha = stopAlpha(s);
    if (alpha === null) return { error: unscorable("invalid-alpha", `stop ${i}: alpha is not a number in 0-1`) };
    if (alpha < 1) {
      return { error: unscorable("alpha", `stop ${i} is translucent (alpha ${alpha}); the v1 model only judges opaque stops`) };
    }
    if (s.position !== undefined && (typeof s.position !== "number" || !Number.isFinite(s.position))) {
      return { error: unscorable("invalid-position", `stop ${i}: position is not a finite number`) };
    }
  }
  const resolved = resolveStops(doc);
  const ticks: GradientTick[] = [];
  for (let i = 0; i < resolved.length; i++) {
    const p = resolved[i].position;
    if (p < 0 || p > 1) return { error: unscorable("position-range", `stop ${i}: position ${p} is outside 0-1`) };
    ticks.push({ id: i, color: resolved[i].color, position: toPercent(p) });
  }
  return { ticks, resolved };
}

function hasHardStops(resolved: ResolvedStop[]): boolean {
  for (let i = 1; i < resolved.length; i++) {
    if (
      Math.abs(resolved[i].position - resolved[i - 1].position) <= 1e-9 &&
      resolved[i].color.toLowerCase() !== resolved[i - 1].color.toLowerCase()
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Score a gradient document under scoring model v1 (spec/scoring-v1.md).
 * Missing positions are resolved by the CSS rules first. Never throws and
 * never returns NaN: anything the model cannot judge is `unscorable`.
 */
export function score(doc: GradientDocument, opts?: ScoreOptions): ScoreResult {
  const model = opts?.scoringModel;
  if (model !== undefined && model !== "v1") {
    return unscorable("unsupported-model", `scoring model ${JSON.stringify(model)} is not available (only "v1")`);
  }
  const prepared = prepare(doc);
  if ("error" in prepared) return prepared.error;
  const result = scoreGradient(prepared.ticks);
  if (result.status !== "ok" || !Number.isFinite(result.score)) {
    return unscorable("engine", result.reason ?? "the v1 engine could not score this gradient");
  }
  // Resolved positions are non-decreasing, so the engine's stable sort keeps
  // document order: its stop indices are indices into `doc.stops`.
  const issues: Issue[] = result.findings.map((f) => {
    const issue = {
      code: f.code,
      severity: f.severity,
      dimension: f.dimension === "rhythm" ? "spacing" : f.dimension,
      pointsLost: f.pointsLost,
    } as Issue;
    if (f.stops) issue.stopIndices = [...f.stops];
    if (f.segment) issue.segment = { start: f.segment[0] / 100, end: f.segment[1] / 100 };
    issue.message = f.message;
    return issue;
  });
  return {
    status: "ok",
    score: result.score,
    dimensions: {
      lightness: result.details.lightness,
      chroma: result.details.chroma,
      hue: result.details.hue,
      spacing: result.details.spacing,
    },
    issues,
    scoringModel: "v1",
    analysis: { hasHardStops: hasHardStops(prepared.resolved) },
  };
}

/**
 * Score one result of `parseGradient`. A skipped gradient is `unscorable` with
 * the parser's skip code. Each issue carries `range`: the source text from the
 * first to the last offending stop, or the whole gradient when the issue is
 * not tied to particular stops.
 */
export function scoreParsed(parsed: ParsedGradient, opts?: ScoreOptions): ScoreResult {
  if (typeof parsed !== "object" || parsed === null) return unscorable("invalid-document", "not a parsed gradient");
  if (!parsed.document) {
    return parsed.skipped
      ? unscorable(parsed.skipped.code, parsed.skipped.reason)
      : unscorable("invalid-document", "the parsed gradient has no document");
  }
  const result = score(parsed.document, opts);
  if (result.status !== "ok") return result;
  const ranges: SourceRange[] = Array.isArray(parsed.stopRanges) ? parsed.stopRanges : [];
  for (const issue of result.issues) {
    let start = Infinity;
    let end = -Infinity;
    for (const i of issue.stopIndices ?? []) {
      const r = ranges[i];
      if (!r) continue;
      if (r.start < start) start = r.start;
      if (r.end > end) end = r.end;
    }
    if (start <= end) issue.range = { start, end };
    else if (parsed.range) issue.range = { start: parsed.range.start, end: parsed.range.end };
  }
  return result;
}

const DECLINED_REASONS = {
  "single-position": "every stop sits within one hard-stop group; there is nothing to redistribute",
  "would-lower-score": "the refinement would score lower than the input",
} as const;

/**
 * One-click refinement under model v1 (`refineGradient`). Guarantees: never
 * lowers the score, keeps hard stops together, keeps achromatic stops
 * achromatic. When it declines (or the document is unscorable) the input
 * document is returned as is, with `declined` saying why.
 */
export function refine(doc: GradientDocument): RefineOutcome {
  const before = score(doc);
  if (before.status !== "ok") {
    return { document: doc, refined: false, before, after: before, declined: { code: "unscorable", reason: before.reason } };
  }
  const prepared = prepare(doc);
  if ("error" in prepared) {
    return { document: doc, refined: false, before, after: before, declined: { code: "unscorable", reason: "unscorable" } };
  }
  const r = refineGradient(prepared.ticks);
  if (!r.refined) {
    const code = r.declined === "single-position" || r.declined === "would-lower-score" ? r.declined : "would-lower-score";
    return { document: doc, refined: false, before, after: before, declined: { code, reason: DECLINED_REASONS[code] } };
  }
  const stops: Stop[] = r.stops.map((t) => {
    const source = doc.stops[t.id];
    const stop: Stop = { color: t.color, position: t.position / 100 };
    if (source && source.id !== undefined) stop.id = source.id;
    return stop;
  });
  const document: GradientDocument = { ...doc, stops };
  const after = score(document);
  if (after.status !== "ok" || after.score < before.score) {
    return { document: doc, refined: false, before, after: before, declined: { code: "would-lower-score", reason: DECLINED_REASONS["would-lower-score"] } };
  }
  return { document, refined: true, before, after };
}
