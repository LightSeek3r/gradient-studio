// ── Which findings a candidate edit provably cannot remove ─────────────────────
// proposeFixes keeps a candidate for finding F only if re-scoring it no longer
// reports F's code. Most candidates are single-stop edits, and most findings
// are about many stops (twenty lightness reversals, say); re-scoring such a
// candidate just to see F still there is the bulk of the search's work. This
// module decides some of those cases WITHOUT scoring, and only when the answer
// is certain: `persists(code, edits, facts)` returning true means the score of
// the edited gradient still contains a finding with `code`. It may say false
// for a candidate that does in fact keep F (then the candidate is simply
// scored, as before); it must never say true for one that removes F.
//
// Each rule below carries its argument. They all use one of two facts:
//   (locality) a rule that reads only some per-stop or per-segment values still
//              fires if the part of the gradient it fires on is not touched;
//   (monotone) adding stops to a set can only widen a range or an arc, and only
//              lower a minimum / raise a maximum, so a threshold crossed by the
//              untouched stops alone stays crossed once the edited stops are
//              added back (floating-point +, - and / are monotone, so this
//              holds for the computed values too, not just the real numbers).
// "Edited" means the candidate gives the stop a new colour (`colour`) or a new
// position (`position`); the stop order never changes (the search checks it),
// so indices into the base gradient stay valid.
//
// tests/perf-equivalence.test.ts audits every pruned (finding, candidate) pair
// of thousands of random gradients against a real re-score.

import { V1_MODEL } from "../scoring-model-v1";
import type { PreparedScore } from "../gradient-engine";

type Edits = ReadonlyMap<number, { color?: string; position?: number }>;

const ML = V1_MODEL.lightness;
const MH = V1_MODEL.hue;
const MC = V1_MODEL.chroma;
const MR = V1_MODEL.rhythm;

/** Rules whose inputs are colours only / positions only. Rules not listed read both (or are global). */
const COLOUR_ONLY: ReadonlySet<string> = new Set([
  ML.reversal.code,
  ML.perceivedReversal.code,
  ML.contrast.code,
  MH.arc.wideCode,
  MH.arc.narrowCode,
  MH.direction.code,
  MC.range.code,
  MC.coherence.code,
  MC.midpoint.code,
]);
const POSITION_ONLY: ReadonlySet<string> = new Set([MR.edge.code, MR.span.code, MR.gaps.code]);

export interface PersistFacts {
  n: number;
  C: number[];
  h: number[];
  /** Interior local extrema of L. */
  extrema: number[];
  /** Segments whose midpoint is muddy (a `chroma/muddy-midpoint` finding on their own). */
  muddy: number[];
  /** Segments that are an abrupt jump on their own. */
  abrupt: number[];
  /** Segments that show banding on their own. */
  banding: number[];
  /** Chromatic position-neighbours (a, b) with a clearly clockwise / counter-clockwise hue step. */
  cw: [number, number][];
  ccw: [number, number][];
  /** Stops by hue (then index), as in the prepared data. */
  hueOrder: number[];
}

/** Facts about the unedited gradient. `base` must already have been scored (that fills its midpoint chroma). */
export function persistFacts(base: PreparedScore): PersistFacts {
  const n = base.positions.length;
  const C = base.lchs.map((l) => l.C);
  const h = base.lchs.map((l) => l.h);
  const extrema: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    const prev = base.lchs[i - 1].L;
    const cur = base.lchs[i].L;
    const next = base.lchs[i + 1].L;
    if ((cur < prev && cur < next) || (cur > prev && cur > next)) extrema.push(i);
  }
  const muddy: number[] = [];
  const abrupt: number[] = [];
  const banding: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const avg = (C[i] + C[i + 1]) / 2;
    const mid = base.segmentMidpointChroma[i];
    // NaN (not computed) fails the comparison: the segment is just not listed.
    if (avg > MC.midpoint.endpointChromaAbove && 1 - mid / avg > MC.midpoint.slightAbove) muddy.push(i);
    const gap = base.segmentGaps[i];
    if (gap > 0 && gap <= ML.abruptJump.maxGap && base.segmentDeltaE[i] > ML.abruptJump.deltaEAbove) abrupt.push(i);
    const steps = base.segmentRgbSteps[i];
    if (
      (steps < MC.banding.strongStepsBelow && gap > MC.banding.strongSpanAbove) ||
      (steps < MC.banding.subtleStepsBelow && gap > MC.banding.subtleSpanAbove)
    ) {
      banding.push(i);
    }
  }
  const cw: [number, number][] = [];
  const ccw: [number, number][] = [];
  let prev = -1;
  for (let i = 0; i < n; i++) {
    if (!(C[i] > MH.chromaticAbove)) continue;
    if (prev >= 0) {
      // The scorer's own arithmetic for a signed shortest-arc hue step.
      let delta = h[i] - h[prev];
      delta = (((delta + 180) % 360) + 360) % 360 - 180;
      if (delta > MH.direction.minStep) cw.push([prev, i]);
      else if (delta < -MH.direction.minStep) ccw.push([prev, i]);
    }
    prev = i;
  }
  return { n, C, h, extrema, muddy, abrupt, banding, cw, ccw, hueOrder: base.hueOrder };
}

/** True when `code` is certainly still reported after `edits`. */
export function persists(code: string, edits: Edits, f: PersistFacts): boolean {
  let colours = false;
  let positions = false;
  for (const e of edits.values()) {
    if (e.color !== undefined) colours = true;
    if (e.position !== undefined) positions = true;
  }
  // Nothing the rule reads has changed.
  if (!colours && COLOUR_ONLY.has(code)) return true;
  if (!positions && POSITION_ONLY.has(code)) return true;
  const colourEdited = (i: number): boolean => edits.get(i)?.color !== undefined;
  const touched = (i: number): boolean => {
    const e = edits.get(i);
    return e !== undefined && (e.color !== undefined || e.position !== undefined);
  };

  switch (code) {
    case ML.reversal.code:
      // A stop is an extremum from its own L and its two neighbours' only.
      return f.extrema.some((j) => !colourEdited(j - 1) && !colourEdited(j) && !colourEdited(j + 1));

    case ML.abruptJump.code:
      // A segment's gap and ΔE come from its two stops alone.
      return f.abrupt.some((i) => !touched(i) && !touched(i + 1));

    case MC.midpoint.code:
      return f.muddy.some((i) => !colourEdited(i) && !colourEdited(i + 1));

    case MC.banding.code:
      return f.banding.some((i) => !touched(i) && !touched(i + 1));

    case MC.range.code: {
      // (monotone) range over all stops >= range over the colour-untouched ones.
      let max = -Infinity;
      let min = Infinity;
      for (let i = 0; i < f.n; i++) {
        if (colourEdited(i)) continue;
        if (f.C[i] > max) max = f.C[i];
        if (f.C[i] < min) min = f.C[i];
      }
      return max - min > MC.range.unevenAbove;
    }

    case MC.coherence.code: {
      // (monotone) minAchromatic / maxVivid over all stops <= the same over the untouched ones.
      if (f.n < MC.coherence.minStops) return false;
      let minAch = Infinity;
      let maxVivid = -Infinity;
      for (let i = 0; i < f.n; i++) {
        if (colourEdited(i)) continue;
        const c = f.C[i];
        if (c < MC.coherence.achromaticBelow && c < minAch) minAch = c;
        if (c >= MC.coherence.vividAtLeast && c > maxVivid) maxVivid = c;
      }
      return minAch !== Infinity && maxVivid !== -Infinity && minAch / maxVivid < MC.coherence.gapBelow;
    }

    case MH.arc.wideCode: {
      // (monotone) the enclosing arc of all chromatic hues >= that of the untouched chromatic ones.
      let count = 0;
      let first = 0;
      let lastH = 0;
      let prevH = 0;
      let maxGap = 0;
      for (const i of f.hueOrder) {
        if (colourEdited(i) || !(f.C[i] > MH.chromaticAbove)) continue;
        const hue = f.h[i];
        if (count === 0) first = hue;
        else {
          const gap = hue - prevH;
          if (gap > maxGap) maxGap = gap;
        }
        prevH = lastH = hue;
        count++;
      }
      if (count < 2) return false;
      const wrap = first + 360 - lastH;
      if (wrap > maxGap) maxGap = wrap;
      return 360 - maxGap > MH.arc.wideAbove;
    }

    case MH.direction.code: {
      // A hue step between two chromatic neighbours is unchanged when neither stop, nor any
      // stop between them (which could turn chromatic), is edited; the rule fires when a
      // clockwise and a counter-clockwise step both remain, over enough chromatic stops.
      const stable = (pair: [number, number]): boolean => {
        for (let i = pair[0]; i <= pair[1]; i++) if (colourEdited(i)) return false;
        return true;
      };
      const a = f.cw.find(stable);
      if (a === undefined) return false;
      const b = f.ccw.find(stable);
      if (b === undefined) return false;
      return new Set([a[0], a[1], b[0], b[1]]).size >= MH.direction.minChromaticStops;
    }

    default:
      return false;
  }
}
