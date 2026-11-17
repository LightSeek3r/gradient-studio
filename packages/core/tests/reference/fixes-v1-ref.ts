// FROZEN COPY of the original (pre-optimisation) implementation at 0584db9, kept ONLY as the
// slow reference for the differential tests (tests/perf-equivalence.test.ts). Do not edit. It shares only constants, types, document helpers and gamutFitOklch with src/.
// ── proposeFixes: one targeted, verified change per finding ───────────────────
// A fix answers "what is the smallest edit that makes THIS deduction go away?".
// For every finding of the v1 score a small, fixed set of candidate edits is
// generated on the stops the finding names (lightness, hue, chroma or
// position; one stop, or all the named stops together) and every candidate is
// re-scored with the frozen engine. Only candidates that satisfy the contract
// below survive; the cheapest one that recovers the most points is returned.
// Nothing here is a scoring rule: the engine is the only judge.
//
// Contract of every returned fix (tests/fixes.test.ts checks it over the whole
// vector corpus):
//   - the total score strictly increases (`gain > 0`);
//   - the targeted finding is gone;
//   - no finding gets a higher severity than it had, and a finding that was
//     not there before is never more severe than the one that was fixed;
//   - only stops the finding names are edited; all others are untouched;
//   - the number and order of the stops do not change;
//   - hard stops stay hard: a stop within `refine.hardStopGap` of a neighbour
//     never moves, and a moved stop never lands that close to a neighbour;
//   - achromatic stops (C <= refine.achromaticAtMost) stay achromatic.
// Pure, deterministic, never throws.

import { gamutFitOklch } from "../../src/color-formats";
import {
  hexToRgb,
  lchToOklab,
  oklabToLch,
  oklabToRgb,
  refineGradient,
  rgbToHex,
  rgbToOklab,
  scoreGradient,
  unscorableReason,
  type Finding,
  type GradientTick,
  type LchColor,
} from "./gradient-engine-v1-ref";
import { V1_MODEL } from "../../src/scoring-model-v1";
import { isDocumentLike, resolveStops } from "../../src/api/document";
import { score } from "./score-v1-ref";
import type { GradientDocument, ScoreResult, Stop } from "../../src/api/types";

/** What a fix edits. `mixed` is a subset of the one-click refinement. */
export type FixKind = "lightness" | "hue" | "chroma" | "position" | "mixed";

/**
 * A targeted change for one finding. `T` is the shape that was passed in: a
 * `GradientDocument`, or an array of engine stops (`GradientTick[]`).
 */
export interface Fix<T = GradientDocument> {
  /** The finding this fix removes, e.g. `lightness/reversal`. */
  code: string;
  /** Short imperative description, e.g. `Adjust the lightness of stop 2`. */
  label: string;
  kind: FixKind;
  /** `after.score − before.score`; always > 0. */
  gain: number;
  before: ScoreResult;
  after: ScoreResult;
  /** The input with the fix applied. Same stop count and order; untouched stops are the input's own. */
  document: T;
  /** Indices (into the input's stops) of the stops the fix edits, ascending. */
  changedStops: number[];
}

interface Edit {
  color?: string;
  position?: number;
}

interface Candidate {
  kind: FixKind;
  edits: Map<number, Edit>;
}

interface Working {
  n: number;
  pos: number[];
  color: string[];
  lch: LchColor[];
  achromatic: boolean[];
  /** Position may not change (hard-stop member, or the caller locked it). */
  locked: boolean[];
}

interface RawFix {
  code: string;
  kind: FixKind;
  label: string;
  gain: number;
  /** Sorted-stop index → edit. */
  edits: Map<number, Edit>;
}

const RANK = { info: 0, warning: 1, error: 2 } as const;
const R = V1_MODEL.refine;
const FRACTIONS = [0.25, 0.5, 0.75, 1];
const L_STEPS = [0.03, 0.06, 0.1, 0.15, 0.2, 0.3];
const HUE_STEPS = [10, 20, 30, 45, 60, 90, 120, 150];
const C_SCALES = [0.9, 0.75, 0.6, 0.5, 0.35, 1.25, 1.5];
const POS_STEPS = [5, 10, 15, 20, 30];
/** Aim this far inside a threshold, so 8-bit rounding cannot land on the wrong side. */
const INSIDE = 0.95;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const wrap = (h: number): number => ((h % 360) + 360) % 360;
/** Signed shortest arc from `from` to `to`, in (−180, 180]. */
const arcTo = (from: number, to: number): number => {
  const d = wrap(to - from);
  return d > 180 ? d - 360 : d;
};
const toLch = (hex: string): LchColor => oklabToLch(rgbToOklab(hexToRgb(hex)));

function encode(lch: LchColor, mustStayAchromatic: boolean): string {
  const fitted = gamutFitOklch({ L: clamp(lch.L, 0, 1), C: Math.max(0, lch.C), h: wrap(lch.h) });
  let hex = rgbToHex(oklabToRgb(lchToOklab(fitted))).toLowerCase();
  if (mustStayAchromatic && toLch(hex).C > R.achromaticAtMost) {
    hex = rgbToHex(oklabToRgb(lchToOklab({ ...fitted, C: 0 }))).toLowerCase();
  }
  return hex;
}

function working(sorted: readonly GradientTick[], lockAll: boolean): Working {
  const n = sorted.length;
  const pos = sorted.map((t) => t.position);
  const lch = sorted.map((t) => toLch(t.color));
  const locked = pos.map(
    (p, i) =>
      lockAll ||
      (i > 0 && p - pos[i - 1] <= R.hardStopGap) ||
      (i < n - 1 && pos[i + 1] - p <= R.hardStopGap),
  );
  return { n, pos, color: sorted.map((t) => t.color), lch, achromatic: lch.map((c) => c.C <= R.achromaticAtMost), locked };
}

/** Sorted indices a fix for `f` may edit: its stops, plus the stops on its segment. */
function allowedStops(f: Finding, w: Working): number[] {
  const set = new Set<number>();
  for (const i of f.stops ?? []) if (Number.isInteger(i) && i >= 0 && i < w.n) set.add(i);
  if (f.segment) {
    for (let i = 0; i < w.n; i++) if (w.pos[i] >= f.segment[0] && w.pos[i] <= f.segment[1]) set.add(i);
  }
  return [...set].sort((a, b) => a - b);
}

function candidatesFor(w: Working, A: number[], refined: GradientTick[] | null): Candidate[] {
  const out: Candidate[] = [];
  const push = (kind: FixKind, entries: [number, Edit][]) => {
    const edits = new Map<number, Edit>();
    for (const [i, e] of entries) {
      const edit: Edit = {};
      if (e.color !== undefined && e.color !== w.color[i].toLowerCase()) edit.color = e.color;
      if (e.position !== undefined && e.position !== w.pos[i]) edit.position = e.position;
      if (edit.color !== undefined || edit.position !== undefined) edits.set(i, edit);
    }
    if (edits.size > 0) out.push({ kind, edits });
  };
  const withL = (i: number, L: number): Edit => ({ color: encode({ ...w.lch[i], L }, w.achromatic[i]) });
  const withC = (i: number, C: number): Edit => ({ color: encode({ ...w.lch[i], C }, false) });
  const withH = (i: number, h: number): Edit => ({ color: encode({ ...w.lch[i], h }, false) });
  /** Linear interpolation of a per-stop value between i's neighbours, by position. */
  const between = (i: number, value: (k: number) => number): number | null => {
    if (i <= 0 || i >= w.n - 1) return null;
    const span = w.pos[i + 1] - w.pos[i - 1];
    const t = span > 0 ? (w.pos[i] - w.pos[i - 1]) / span : 0.5;
    return value(i - 1) + (value(i + 1) - value(i - 1)) * t;
  };
  const chromatic = (i: number) => !w.achromatic[i];
  const hkWeight = V1_MODEL.lightness.perceivedReversal.chromaWeight;

  // ── Lightness ───────────────────────────────────────────────────────────────
  for (const i of A) {
    const L = w.lch[i].L;
    const targets: number[] = [];
    const mid = between(i, (k) => w.lch[k].L);
    if (mid !== null) targets.push(mid);
    const apparent = between(i, (k) => w.lch[k].L + hkWeight * w.lch[k].C);
    if (apparent !== null) targets.push(apparent - hkWeight * w.lch[i].C);
    for (const target of targets) for (const fr of FRACTIONS) push("lightness", [[i, withL(i, L + (target - L) * fr)]]);
    for (const d of L_STEPS) {
      push("lightness", [[i, withL(i, L + d)]]);
      push("lightness", [[i, withL(i, L - d)]]);
    }
  }
  if (A.length >= 2) {
    // Push the two ends of the named stops apart (low contrast, banding).
    const a = A[0];
    const b = A[A.length - 1];
    const dir = w.lch[b].L >= w.lch[a].L ? 1 : -1;
    for (const d of L_STEPS) {
      push("lightness", [
        [a, withL(a, w.lch[a].L - (dir * d) / 2)],
        [b, withL(b, w.lch[b].L + (dir * d) / 2)],
      ]);
    }
  }

  /**
   * For several named stops at once: each one's value on the straight line
   * between the nearest stops (either side) that `keep` and are not named.
   */
  const ramp = (value: (k: number) => number, keep: (k: number) => boolean, delta: (a: number, b: number) => number) => {
    const inA = new Set(A);
    return (i: number): number | null => {
      let a = i - 1;
      while (a >= 0 && (inA.has(a) || !keep(a))) a--;
      let b = i + 1;
      while (b < w.n && (inA.has(b) || !keep(b))) b++;
      if (a < 0 && b >= w.n) return null;
      if (a < 0) return value(b);
      if (b >= w.n) return value(a);
      const span = w.pos[b] - w.pos[a];
      const t = span > 0 ? (w.pos[i] - w.pos[a]) / span : 0.5;
      return value(a) + delta(value(a), value(b)) * t;
    };
  };
  if (A.length >= 2) {
    const target = ramp((k) => w.lch[k].L, () => true, (a, b) => b - a);
    for (const fr of FRACTIONS) {
      const entries: [number, Edit][] = [];
      for (const i of A) {
        const t = target(i);
        if (t !== null) entries.push([i, withL(i, w.lch[i].L + (t - w.lch[i].L) * fr)]);
      }
      push("lightness", entries);
    }
  }

  // ── Hue ─────────────────────────────────────────────────────────────────────
  const chromaticA = A.filter(chromatic);
  for (const i of chromaticA) {
    const h = w.lch[i].h;
    let prev = i - 1;
    while (prev >= 0 && !chromatic(prev)) prev--;
    let next = i + 1;
    while (next < w.n && !chromatic(next)) next++;
    const targets: number[] = [];
    if (prev >= 0 && next < w.n) {
      targets.push(w.lch[prev].h + arcTo(w.lch[prev].h, w.lch[next].h) / 2);
    }
    if (prev >= 0) targets.push(w.lch[prev].h);
    if (next < w.n) targets.push(w.lch[next].h);
    for (const target of targets) for (const fr of FRACTIONS) push("hue", [[i, withH(i, h + arcTo(h, target) * fr)]]);
    for (const d of HUE_STEPS) {
      push("hue", [[i, withH(i, h + d)]]);
      push("hue", [[i, withH(i, h - d)]]);
    }
  }
  if (chromaticA.length >= 2) {
    // Bring the two named hues towards each other, half the way each.
    const a = chromaticA[0];
    const b = chromaticA[chromaticA.length - 1];
    const gap = arcTo(w.lch[a].h, w.lch[b].h);
    for (const d of HUE_STEPS) {
      if (d >= Math.abs(gap)) break;
      const s = Math.sign(gap) * (d / 2);
      push("hue", [
        [a, withH(a, w.lch[a].h + s)],
        [b, withH(b, w.lch[b].h - s)],
      ]);
    }
  }

  if (chromaticA.length >= 2) {
    const target = ramp((k) => w.lch[k].h, chromatic, arcTo);
    for (const fr of FRACTIONS) {
      const entries: [number, Edit][] = [];
      for (const i of chromaticA) {
        const t = target(i);
        if (t !== null) entries.push([i, withH(i, w.lch[i].h + arcTo(w.lch[i].h, t) * fr)]);
      }
      push("hue", entries);
    }
  }

  // ── Chroma ──────────────────────────────────────────────────────────────────
  const allC = w.lch.map((c) => c.C);
  const range = V1_MODEL.chroma.range;
  const coherence = V1_MODEL.chroma.coherence;
  for (const i of chromaticA) {
    const C = w.lch[i].C;
    const others = allC.filter((_, k) => k !== i);
    const minOther = Math.min(...others);
    const maxOther = Math.max(...others);
    const targets: number[] = [
      minOther + range.spikeAbove * INSIDE,
      minOther + range.unevenAbove * INSIDE,
      maxOther - range.spikeAbove * INSIDE,
      maxOther - range.unevenAbove * INSIDE,
      maxOther * coherence.gapBelow * (2 - INSIDE),
      Math.max(coherence.achromaticBelow / INSIDE, maxOther * coherence.gapBelow * (2 - INSIDE)),
    ];
    const mid = between(i, (k) => w.lch[k].C);
    if (mid !== null) targets.push(mid);
    for (const target of targets) if (target > 0) push("chroma", [[i, withC(i, target)]]);
    for (const s of C_SCALES) push("chroma", [[i, withC(i, C * s)]]);
  }

  if (chromaticA.length >= 2) {
    const mean = chromaticA.reduce((sum, i) => sum + w.lch[i].C, 0) / chromaticA.length;
    for (const fr of FRACTIONS) {
      push("chroma", chromaticA.map((i): [number, Edit] => [i, withC(i, w.lch[i].C + (mean - w.lch[i].C) * fr)]));
    }
  }

  // ── Position ────────────────────────────────────────────────────────────────
  const gapMin = R.hardStopGap;
  /** A legal position for stop i near `target`, given (possibly moved) neighbours, or null. */
  const place = (i: number, target: number, lo: number | null, hi: number | null): number | null => {
    if (w.locked[i]) return null;
    let p = Math.round(clamp(target, 0, 100));
    if (lo !== null && p <= lo + gapMin) p = Math.floor(lo + gapMin) + 1;
    if (hi !== null && p >= hi - gapMin) p = Math.ceil(hi - gapMin) - 1;
    if (lo !== null && p <= lo + gapMin) return null;
    if (p < 0 || p > 100) return null;
    return p;
  };
  const lower = (i: number) => (i > 0 ? w.pos[i - 1] : null);
  const upper = (i: number) => (i < w.n - 1 ? w.pos[i + 1] : null);
  const move = (i: number, target: number) => {
    const p = place(i, target, lower(i), upper(i));
    if (p !== null) push("position", [[i, { position: p }]]);
  };
  const labOf = (k: number) => lchToOklab(w.lch[k]);
  const dE = (a: number, b: number) => {
    const x = labOf(a);
    const y = labOf(b);
    return Math.sqrt((x.L - y.L) ** 2 + (x.a - y.a) ** 2 + (x.b - y.b) ** 2);
  };
  for (const i of A) {
    const p = w.pos[i];
    const targets: number[] = [];
    if (i === 0) targets.push(0);
    if (i === w.n - 1) targets.push(100);
    if (i > 0 && i < w.n - 1) {
      const a = w.pos[i - 1];
      const b = w.pos[i + 1];
      targets.push((a + b) / 2);
      // Where the colour change either side has the same speed.
      const d1 = dE(i - 1, i);
      const d2 = dE(i, i + 1);
      if (d1 + d2 > 0) targets.push(a + ((b - a) * d1) / (d1 + d2));
      // Its slot if all stops were evenly spread.
      targets.push((i / (w.n - 1)) * 100);
    }
    for (const target of targets) for (const fr of [0.5, 1]) move(i, p + (target - p) * fr);
    for (const d of POS_STEPS) {
      move(i, p + d);
      move(i, p - d);
    }
  }
  if (A.length >= 2) {
    // All named stops at once: ends to the edges, the rest evenly between
    // the nearest stops that stay put.
    const first = A[0];
    const last = A[A.length - 1];
    const contiguous = last - first === A.length - 1;
    if (contiguous && A.every((i) => !w.locked[i])) {
      const start = first === 0 ? 0 : w.pos[first - 1];
      const end = last === w.n - 1 ? 100 : w.pos[last + 1];
      const slots = A.length + (first === 0 ? 0 : 1) + (last === w.n - 1 ? 0 : 1) - 1;
      if (slots > 0) {
        const entries: [number, Edit][] = [];
        let ok = true;
        let prevPos: number | null = first === 0 ? null : w.pos[first - 1];
        A.forEach((i, k) => {
          const slot = k + (first === 0 ? 0 : 1);
          const p = place(i, start + ((end - start) * slot) / slots, prevPos, i === last ? upper(i) : null);
          if (p === null) ok = false;
          else {
            entries.push([i, { position: p }]);
            prevPos = p;
          }
        });
        if (ok) push("position", entries);
      }
    }
    if (first === 0 && last === w.n - 1 && A.length > 2) {
      const p0 = place(0, 0, null, upper(0));
      const p1 = place(last, 100, lower(last), null);
      if (p0 !== null && p1 !== null) push("position", [[0, { position: p0 }], [last, { position: p1 }]]);
    }
  }

  // ── The one-click refinement, restricted to the named stops ──────────────────
  if (refined) {
    const colours: [number, Edit][] = A.map((i) => [
      i,
      { color: w.achromatic[i] ? encode({ ...w.lch[i], L: toLch(refined[i].color).L }, true) : refined[i].color.toLowerCase() },
    ]);
    push("mixed", colours);
    for (const entry of colours) push("mixed", [entry]);
  }
  return out;
}

const STABLE = (a: { p: number; i: number }, b: { p: number; i: number }) => a.p - b.p || a.i - b.i;

/** Apply edits to the sorted stops. Null when the stop order would change. */
function applyEdits(sorted: readonly GradientTick[], edits: Map<number, Edit>): GradientTick[] | null {
  const next = sorted.map((t, i) => {
    const e = edits.get(i);
    return e ? { id: t.id, color: e.color ?? t.color, position: e.position ?? t.position } : t;
  });
  const order = next.map((t, i) => ({ p: t.position, i })).sort(STABLE);
  for (let i = 0; i < order.length; i++) if (order[i].i !== i) return null;
  return next;
}

function cost(w: Working, edits: Map<number, Edit>): number {
  let total = 0;
  for (const [i, e] of edits) {
    if (e.color !== undefined) {
      const a = lchToOklab(w.lch[i]);
      const b = rgbToOklab(hexToRgb(e.color));
      total += Math.sqrt((a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
    }
    if (e.position !== undefined) total += Math.abs(e.position - w.pos[i]) / 100;
  }
  return total;
}

function list(indices: number[]): string {
  const names = indices.map((i) => String(i + 1));
  if (names.length === 1) return `stop ${names[0]}`;
  return `stops ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function describe(kind: FixKind, w: Working, edits: Map<number, Edit>): string {
  const indices = [...edits.keys()].sort((a, b) => a - b);
  const who = list(indices);
  const one = indices.length === 1 ? indices[0] : -1;
  switch (kind) {
    case "lightness": {
      if (one < 0) return `Adjust the lightness of ${who}`;
      const lighter = toLch(edits.get(one)!.color!).L > w.lch[one].L;
      return `Make ${who} ${lighter ? "lighter" : "darker"}`;
    }
    case "hue":
      return one < 0 ? `Bring the hues of ${who} closer` : `Shift the hue of ${who}`;
    case "chroma": {
      if (one < 0) return `Even out the saturation of ${who}`;
      const more = toLch(edits.get(one)!.color!).C > w.lch[one].C;
      return `${more ? "Raise" : "Lower"} the saturation of ${who}`;
    }
    case "position":
      return one < 0 ? `Respace ${who}` : `Move ${who} to ${edits.get(one)!.position}%`;
    default:
      return `Refine ${who}`;
  }
}

/** The engine-level search. `sorted` must be scorable and in position order. */
function search(sorted: GradientTick[], lockPositions: boolean): RawFix[] {
  const before = scoreGradient(sorted);
  if (before.status !== "ok" || before.findings.length === 0) return [];
  const w = working(sorted, lockPositions);
  const r = refineGradient(sorted);
  const refined = r.refined && r.stops.length === w.n && r.stops.every((t, i) => t.id === sorted[i].id) ? r.stops : null;
  const severityBefore = new Map(before.findings.map((f) => [f.code, RANK[f.severity]]));
  const fixes: RawFix[] = [];

  for (const finding of before.findings) {
    const A = allowedStops(finding, w);
    if (A.length === 0) continue;
    const targetRank = RANK[finding.severity];
    let best: { c: Candidate; gain: number; cost: number }[] = [];
    let bestGain = 0;
    const seen = new Set<string>();
    for (const c of candidatesFor(w, A, refined)) {
      const key = [...c.edits].map(([i, e]) => `${i}:${e.color ?? ""}:${e.position ?? ""}`).join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      // Achromatic stops stay achromatic.
      let ok = true;
      for (const [i, e] of c.edits) {
        if (e.color !== undefined && w.achromatic[i] && toLch(e.color).C > R.achromaticAtMost) ok = false;
        if (e.position !== undefined && w.locked[i]) ok = false;
      }
      if (!ok) continue;
      const next = applyEdits(sorted, c.edits);
      if (!next) continue;
      // A moved stop must not form a new hard stop with a neighbour.
      for (const [i, e] of c.edits) {
        if (e.position === undefined) continue;
        if (i > 0 && next[i].position - next[i - 1].position <= R.hardStopGap) ok = false;
        if (i < w.n - 1 && next[i + 1].position - next[i].position <= R.hardStopGap) ok = false;
      }
      if (!ok) continue;
      const after = scoreGradient(next);
      if (after.status !== "ok" || !(after.score > before.score)) continue;
      for (const g of after.findings) {
        if (g.code === finding.code) ok = false;
        const was = severityBefore.get(g.code);
        if (was === undefined ? RANK[g.severity] > targetRank : RANK[g.severity] > was) ok = false;
      }
      if (!ok) continue;
      const gain = after.score - before.score;
      if (gain > bestGain) bestGain = gain;
      best.push({ c, gain, cost: cost(w, c.edits) });
    }
    if (best.length === 0) continue;
    // The cheapest edit that recovers this finding's points (or, when none
    // does, the most any candidate recovers).
    const want = Math.min(bestGain, finding.pointsLost);
    best = best.filter((b) => b.gain >= want);
    let pick = best[0];
    for (const b of best) if (b.cost < pick.cost - 1e-12) pick = b;
    fixes.push({
      code: finding.code,
      kind: pick.c.kind,
      label: describe(pick.c.kind, w, pick.c.edits),
      gain: pick.gain,
      edits: pick.c.edits,
    });
  }
  return fixes;
}

const toPercent = (position: number): number => Math.round(position * 1e12) / 1e10;

function fixesForTicks(ticks: readonly GradientTick[]): Fix<GradientTick[]>[] {
  if (unscorableReason(ticks) !== null) return [];
  const order = ticks.map((t, i) => ({ p: t.position, i })).sort(STABLE).map((o) => o.i);
  const sorted = order.map((i) => ({ id: ticks[i].id, color: ticks[i].color, position: ticks[i].position }));
  const asDoc = (stops: readonly GradientTick[]): GradientDocument => ({
    kind: "linear",
    angle: 90,
    stops: stops.map((t) => ({ color: t.color, position: t.position / 100 })),
  });
  const before = score(asDoc(sorted));
  if (before.status !== "ok") return [];
  const out: Fix<GradientTick[]>[] = [];
  for (const raw of search(sorted, false)) {
    const next = applyEdits(sorted, raw.edits);
    if (!next) continue;
    const after = score(asDoc(next));
    if (after.status !== "ok" || after.score - before.score !== raw.gain || raw.gain <= 0) continue;
    const document = ticks.slice();
    const changed: number[] = [];
    for (const [k, e] of raw.edits) {
      const i = order[k];
      document[i] = { ...ticks[i], ...(e.color !== undefined ? { color: e.color } : {}), ...(e.position !== undefined ? { position: e.position } : {}) };
      changed.push(i);
    }
    out.push({ code: raw.code, label: raw.label, kind: raw.kind, gain: raw.gain, before, after, document, changedStops: changed.sort((a, b) => a - b) });
  }
  return out;
}

function fixesForDocument(doc: GradientDocument): Fix[] {
  const before = score(doc);
  if (before.status !== "ok") return [];
  const resolved = resolveStops(doc);
  // With automatic positions, moving one stop would silently move the stops
  // spaced from it, so positions are left alone.
  const lockPositions = doc.stops.some((s) => typeof s.position !== "number" || !Number.isFinite(s.position));
  // Resolved positions are non-decreasing, so document order is engine order.
  const sorted: GradientTick[] = resolved.map((s, i) => ({ id: i, color: s.color, position: toPercent(s.position) }));
  const out: Fix[] = [];
  for (const raw of search(sorted, lockPositions)) {
    const stops: Stop[] = doc.stops.slice();
    for (const [i, e] of raw.edits) {
      const stop: Stop = { ...doc.stops[i] };
      if (e.color !== undefined) stop.color = e.color;
      if (e.position !== undefined) stop.position = e.position / 100;
      stops[i] = stop;
    }
    const document: GradientDocument = { ...doc, stops };
    const after = score(document);
    if (after.status !== "ok" || !(after.score > before.score)) continue;
    if (after.issues.some((issue) => issue.code === raw.code)) continue;
    out.push({
      code: raw.code,
      label: raw.label,
      kind: raw.kind,
      gain: after.score - before.score,
      before,
      after,
      document,
      changedStops: [...raw.edits.keys()].sort((a, b) => a - b),
    });
  }
  return out;
}

/**
 * Targeted fixes for a gradient: at most one per finding of its v1 score, in
 * the order of the findings. Each fix edits only the stops its finding names
 * and is verified by re-scoring (see the contract at the top of this file).
 * A finding with no edit that satisfies the contract simply has no fix.
 *
 * Accepts a `GradientDocument` (positions 0-1) or the engine's `GradientTick[]`
 * (positions 0-100, any array order); `fix.document` has the same shape. For
 * ticks, `before`/`after` describe the position-sorted stops, and the stop
 * numbers in `label` are 1-based in position order.
 *
 * Unscorable input, or a gradient without findings, gives `[]`. Never throws.
 */
export function proposeFixes(doc: GradientDocument): Fix[];
export function proposeFixes(ticks: readonly GradientTick[]): Fix<GradientTick[]>[];
export function proposeFixes(input: GradientDocument | readonly GradientTick[]): Fix[] | Fix<GradientTick[]>[] {
  try {
    if (Array.isArray(input)) return fixesForTicks(input as readonly GradientTick[]);
    if (!isDocumentLike(input)) return [];
    return fixesForDocument(input as GradientDocument);
  } catch {
    return [];
  }
}
