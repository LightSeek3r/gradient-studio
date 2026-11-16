// Rewrite one gradient's stops with the refined colours and positions.
//
// Only the stop arguments are replaced; the direction, interpolation clause,
// whitespace, newlines and comments between stops stay byte for byte. A stop
// whose colour and resolved position did not change keeps its original text
// (`red` stays `red`). The loop repeats until refine no longer improves the
// score of the *rewritten text*, so a second run finds nothing to do.

import { parseGradient, refine, resolveStops, scoreParsed, type GradientDocument, type ParsedGradient } from "@opal42/gradient";
import { MAX_FILE_BYTES } from "./limits";

const MAX_ROUNDS = 10;

export interface FixResult {
  /** The rewritten gradient function text. */
  text: string;
  before: number;
  after: number;
}

/** Why a scorable gradient is left alone by --fix / refine. */
export type FixBlock = "hints" | "double-position" | "hard-stops" | "unparseable";

function parseOne(text: string): ParsedGradient | null {
  const { gradients } = parseGradient(text, { maxInputLength: MAX_FILE_BYTES });
  if (gradients.length !== 1) return null;
  const g = gradients[0];
  if (g.range.start !== 0 || g.range.end !== text.length) return null;
  return g;
}

/** null when the gradient can be rewritten stop by stop, else the reason it cannot. */
export function fixBlock(g: ParsedGradient): FixBlock | null {
  const doc = g.document;
  if (!doc || g.skipped) return "unparseable";
  if (g.warnings.some((w) => w.code === "color-hint-ignored")) return "hints";
  if (g.stopRanges.length !== doc.stops.length) return "unparseable";
  for (let i = 1; i < g.stopRanges.length; i++) {
    if (g.stopRanges[i].start <= g.stopRanges[i - 1].start) return "double-position";
  }
  return null;
}

const SCALE = 1e4;
/** A percentage with at most 4 decimals and no trailing zeros. */
function pct(position: number): string {
  const v = Math.round(position * 100 * SCALE) / SCALE;
  return `${Object.is(v, -0) ? 0 : v}%`;
}

function rewrite(text: string, g: ParsedGradient, refined: GradientDocument): string | null {
  const doc = g.document!;
  if (refined.stops.length !== doc.stops.length) return null;
  const byId = new Map<string, (typeof refined.stops)[number]>();
  for (const s of refined.stops) if (s.id !== undefined) byId.set(s.id, s);
  const resolved = resolveStops(doc);
  let out = text;
  for (let i = doc.stops.length - 1; i >= 0; i--) {
    const next = byId.get(String(i));
    if (!next || next.position === undefined) return null;
    const old = doc.stops[i];
    const unchanged = next.color === old.color && Math.abs(next.position - resolved[i].position) < 1e-9;
    if (unchanged) continue;
    const r = g.stopRanges[i];
    out = out.slice(0, r.start) + `${next.color} ${pct(next.position)}` + out.slice(r.end);
  }
  return out;
}

/**
 * Refine the gradient whose exact source text is `src`. Null when nothing
 * improves (including every case in `fixBlock`).
 */
export function fixGradientText(src: string): FixResult | null {
  let text = src;
  let cur = parseOne(text);
  if (!cur || fixBlock(cur) !== null) return null;
  const first = scoreParsed(cur);
  if (first.status !== "ok" || first.analysis.hasHardStops) return null;
  const initial = first.score;
  let curScore = initial;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const base = cur.document!;
    const tagged: GradientDocument = { ...base, stops: base.stops.map((s, i) => ({ ...s, id: String(i) })) };
    const out = refine(tagged);
    if (!out.refined || out.after.status !== "ok" || out.after.score <= curScore) break;
    const candidate = rewrite(text, cur, out.document);
    if (candidate === null || candidate === text) break;
    const next = parseOne(candidate);
    if (!next || fixBlock(next) !== null) break;
    const s = scoreParsed(next);
    if (s.status !== "ok" || s.analysis.hasHardStops || s.score <= curScore) break;
    text = candidate;
    cur = next;
    curScore = s.score;
  }
  if (text === src) return null;
  return { text, before: initial, after: curScore };
}
