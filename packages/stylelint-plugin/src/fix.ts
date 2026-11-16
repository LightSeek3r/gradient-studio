// Autofix planning. Pure text-to-text: given the raw value of a declaration
// that holds exactly one gradient, compute the value with the gradient's stop
// arguments rewritten, or null when no safe rewrite exists.
//
// Safety rules (docs/stylelint.md):
//  - the value holds exactly one gradient function, it is scorable under v1,
//    has no translucent stops, no hard stops, no colour hints and no
//    double-position stops;
//  - only the stop arguments are replaced (direction, `in oklch`, whitespace,
//    comments and everything outside the gradient stay byte for byte);
//  - every step is re-parsed and re-scored from the *rewritten text* and must
//    strictly raise the smoothness score;
//  - skipped, legacy, var()/calc()/preprocessor, repeating and non-linear
//    gradients are never touched (they have no document).
// The fixes can change colours: they are the same edits the web app's Suggest
// button makes (`refine`) or the targeted ones of `proposeFixes`.

import {
  parseGradient,
  proposeFixes,
  refine,
  resolveStops,
  scoreParsed,
  type GradientDocument,
  type ParsedGradient,
  type ScoreResult,
} from "@opal42/gradient";

const MAX_ROUNDS = 12;

export type FixGoal =
  | { kind: "min"; min: number }
  | { kind: "codes"; codes: ReadonlySet<string> };

export interface FixPlan {
  /** The value text the plan was computed from. */
  before: string;
  /** The rewritten value text. */
  text: string;
  scoreBefore: number;
  scoreAfter: number;
  /** For a `codes` goal: the forbidden codes the rewrite removes. */
  resolvedCodes: string[];
}

type Ok = Extract<ScoreResult, { status: "ok" }>;

interface State {
  text: string;
  parsed: ParsedGradient;
  doc: GradientDocument;
  result: Ok;
}

const SCALE = 1e4;
/** A percentage with at most 4 decimals and no trailing zeros. */
function pct(position: number): string {
  const v = Math.round(position * 100 * SCALE) / SCALE;
  return `${Object.is(v, -0) ? 0 : v}%`;
}

/** Why a gradient cannot be rewritten stop by stop, or null when it can. */
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

/** Parse `text` as exactly one gradient and require it to be rewritable and scored without hard stops. */
function state(text: string): State | null {
  const { gradients } = parseGradient(text);
  if (gradients.length !== 1) return null;
  const parsed = gradients[0];
  if (fixBlocked(parsed) !== null) return null;
  const result = scoreParsed(parsed);
  if (result.status !== "ok" || result.analysis.hasHardStops) return null;
  return { text, parsed, doc: parsed.document as GradientDocument, result };
}

const tagged = (doc: GradientDocument): GradientDocument => ({ ...doc, stops: doc.stops.map((s, i) => ({ ...s, id: String(i) })) });

/** Replace the stop arguments that differ between `cur` and `next` (matched by id). */
function rewrite(cur: State, next: GradientDocument): string | null {
  const doc = cur.doc;
  if (next.stops.length !== doc.stops.length) return null;
  const byId = new Map<string, GradientDocument["stops"][number]>();
  for (const s of next.stops) if (s.id !== undefined) byId.set(s.id, s);
  const resolved = resolveStops(doc);
  let out = cur.text;
  for (let i = doc.stops.length - 1; i >= 0; i--) {
    const n = byId.get(String(i));
    if (!n || typeof n.color !== "string" || /[^#0-9a-f]/.test(n.color)) return null;
    const old = doc.stops[i];
    const position = n.position ?? old.position;
    const moved = n.position !== undefined && Math.abs(n.position - resolved[i].position) >= 1e-9;
    if (n.color === old.color && !moved) continue;
    const explicit = old.position !== undefined || moved;
    if (explicit && position === undefined) return null;
    const r = cur.parsed.stopRanges[i];
    out = out.slice(0, r.start) + (explicit ? `${n.color} ${pct(position as number)}` : n.color) + out.slice(r.end);
  }
  return out;
}

/** The re-parsed, re-scored candidate when it is a strict improvement with the same shape; else null. */
function accept(cur: State, candidate: string | null): State | null {
  if (candidate === null || candidate === cur.text) return null;
  const s = state(candidate);
  if (!s || s.doc.stops.length !== cur.doc.stops.length) return null;
  if (s.parsed.range.start !== cur.parsed.range.start) return null;
  if (s.result.score <= cur.result.score) return null;
  return s;
}

const byGain = <T extends { gain: number; changedStops: number[] }>(a: T, b: T) =>
  b.gain - a.gain || a.changedStops.length - b.changedStops.length;

function finish(from: State, to: State, resolvedCodes: string[]): FixPlan {
  return { before: from.text, text: to.text, scoreBefore: from.result.score, scoreAfter: to.result.score, resolvedCodes };
}

/** Greedy targeted fixes until the score reaches `min`. */
function planMinTargeted(start: State, min: number): State | null {
  let cur = start;
  for (let round = 0; round < MAX_ROUNDS && cur.result.score < min; round++) {
    const fixes = proposeFixes(tagged(cur.doc)).sort(byGain);
    let next: State | null = null;
    for (const f of fixes) {
      next = accept(cur, rewrite(cur, f.document));
      if (next) break;
    }
    if (!next) break;
    cur = next;
  }
  return cur !== start && cur.result.score >= min ? cur : null;
}

/** The one-click refinement, repeated while it improves, until the score reaches `min`. */
function planMinRefine(start: State, min: number): State | null {
  let cur = start;
  for (let round = 0; round < MAX_ROUNDS && cur.result.score < min; round++) {
    const out = refine(tagged(cur.doc));
    if (!out.refined) break;
    const next = accept(cur, rewrite(cur, out.document));
    if (!next) break;
    cur = next;
  }
  return cur !== start && cur.result.score >= min ? cur : null;
}

const forbiddenIn = (r: Ok, codes: ReadonlySet<string>): string[] => [...new Set(r.issues.map((i) => i.code).filter((c) => codes.has(c)))];

/** Targeted fixes for specific finding codes. */
function planCodes(start: State, codes: ReadonlySet<string>): FixPlan | null {
  const present0 = new Set(forbiddenIn(start.result, codes));
  if (present0.size === 0) return null;
  let cur = start;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const present = forbiddenIn(cur.result, codes);
    if (present.length === 0) break;
    const fixes = proposeFixes(tagged(cur.doc)).sort(byGain);
    let next: State | null = null;
    for (const code of present) {
      for (const f of fixes) {
        if (f.code !== code) continue;
        const cand = accept(cur, rewrite(cur, f.document));
        if (!cand) continue;
        const after = forbiddenIn(cand.result, codes);
        // The targeted finding must be gone and no forbidden finding may be new.
        if (after.includes(code) || after.some((c) => !present0.has(c))) continue;
        next = cand;
        break;
      }
      if (next) break;
    }
    if (!next) break;
    cur = next;
  }
  if (cur === start) return null;
  const after = new Set(forbiddenIn(cur.result, codes));
  if ([...after].some((c) => !present0.has(c))) return null;
  const resolved = [...present0].filter((c) => !after.has(c));
  return resolved.length > 0 ? finish(start, cur, resolved) : null;
}

/**
 * Plan a rewrite of the value `text` for a goal, or null when none is safe.
 * `text` must hold exactly one gradient (the caller also checks that).
 */
export function planFix(text: string, goal: FixGoal): FixPlan | null {
  const start = state(text);
  if (!start) return null;
  if (goal.kind === "codes") return planCodes(start, goal.codes);
  if (start.result.score >= goal.min) return null;
  const to = planMinTargeted(start, goal.min) ?? planMinRefine(start, goal.min);
  return to ? finish(start, to, []) : null;
}
