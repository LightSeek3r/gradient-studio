// ── Gradient Engine ────────────────────────────────────────────────────────────
// Pure functions for gradient color math, quality scoring, and suggestion.
// Zero dependencies — no React, no DOM, no side effects.

// Every scoring threshold, weight and message lives in ./scoring-model-v1.ts.

import {
  V1_MODEL,
  type Dimension,
  type ScoreMeasurements,
  type Severity,
  type Tier,
} from "./scoring-model-v1";

export { V1_MODEL };
export type { Dimension as FindingDimension, ScoreMeasurements, Severity };

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface OklabColor {
  L: number;
  a: number;
  b: number;
}

export interface LchColor {
  L: number;
  C: number;
  h: number;
}

export interface GradientTick {
  id: number;
  color: string;
  position: number;
}

export interface ScoreDetails {
  lightness: number;
  hue: number;
  chroma: number;
  /** The "rhythm" dimension of findings. */
  spacing: number;
  /** What the thresholds were compared against (absent when unscorable). */
  measurements?: ScoreMeasurements;
}

/**
 * One deduction, coded and located. Every point `scoreGradient` takes off is
 * represented by exactly one finding (see `GradientScore.findings`).
 */
export interface Finding {
  /** Stable kebab-case `dimension/rule`, e.g. `lightness/reversal`. */
  code: string;
  severity: Severity;
  /** `rhythm` is the dimension reported as `ScoreDetails.spacing`. */
  dimension: Dimension;
  /** The rule's nominal penalty (before any per-dimension clamp at 0). */
  pointsLost: number;
  /** Indices into the POSITION-SORTED stops (stable sort). */
  stops?: number[];
  /** A span of the gradient, positions 0-100, `[start, end]`. */
  segment?: [number, number];
  /** Identical to the corresponding entry of `GradientScore.issues`. */
  message: string;
}

export interface GradientScore {
  /** "unscorable" when the input is outside the v1 domain (see scoring-model-v1.ts). */
  status: "ok" | "unscorable";
  /** Why the input is unscorable. */
  reason?: string;
  score: number;
  /** `findings.map(f => f.message)`, kept for display. */
  issues: string[];
  details: ScoreDetails;
  /**
   * Coded, located deductions, in rule order. Per dimension d with budget W_d:
   * `W_d - details[d] === min(W_d, sum of pointsLost in d)`. The min is the
   * clamp at 0: when a dimension's nominal penalties exceed its budget, the
   * excess is absorbed and the dimension scores 0. Without clamping,
   * `sum(pointsLost) === 100 - score`.
   */
  findings: Finding[];
}

// ── OKLAB color math ──────────────────────────────────────────────────────────

export function srgbToLinear(c: number): number {
  c = c / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  const clamped = clamp(c, 0, 1);
  return Math.round(
    255 *
      (clamped <= 0.0031308
        ? 12.92 * clamped
        : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055),
  );
}

export function hexToRgb(hex: string): RGB {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

export function rgbToHex({ r, g, b }: RGB): string {
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

export function rgbToOklab({ r, g, b }: RGB): OklabColor {
  const lr = srgbToLinear(r),
    lg = srgbToLinear(g),
    lb = srgbToLinear(b);

  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );

  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}

/**
 * OKLAB → *linear* sRGB, without clamping or gamma encoding.
 * Values outside 0..1 mean the color falls outside the sRGB gamut, so this is
 * the primitive gamut-mapping code needs (see `gamutFitOklch`).
 */
export function oklabToLinearRgb({ L, a, b }: OklabColor): RGB {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_,
    m = m_ * m_ * m_,
    s = s_ * s_ * s_;

  return {
    r: +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

export function oklabToRgb(lab: OklabColor): RGB {
  const { r, g, b } = oklabToLinearRgb(lab);
  return { r: linearToSrgb(r), g: linearToSrgb(g), b: linearToSrgb(b) };
}

// ── Convenience conversions ───────────────────────────────────────────────────

/** Hex string → OKLCH in one step. */
export function hexToOklch(hex: string): LchColor {
  return oklabToLch(rgbToOklab(hexToRgb(hex)));
}

/** OKLCH → hex string in one step. */
export function oklchToHex(lch: LchColor): string {
  return rgbToHex(oklabToRgb(lchToOklab(lch)));
}

export function oklabToLch({ L, a, b }: OklabColor): LchColor {
  const C = Math.sqrt(a * a + b * b);
  const h = Math.atan2(b, a) * (180 / Math.PI);
  return { L, C, h: ((h % 360) + 360) % 360 };
}

export function lchToOklab({ L, C, h }: LchColor): OklabColor {
  const hr = h * (Math.PI / 180);
  return { L, a: C * Math.cos(hr), b: C * Math.sin(hr) };
}

// ── Gradient quality scoring ──────────────────────────────────────────────────

/** Euclidean distance in OKLAB — perceptually uniform. */
function oklabDeltaE(a: OklabColor, b: OklabColor): number {
  return Math.sqrt(
    (a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2,
  );
}

const HEX_COLOR = new RegExp(V1_MODEL.domain.colorPattern);

/** True for an opaque `#rrggbb` colour (either case) — the only colour v1 accepts. */
export function isValidStopColor(color: unknown): color is string {
  return typeof color === "string" && HEX_COLOR.test(color);
}

/** A stop the CSS/interpolation helpers can use: valid colour and a finite position. */
function isRenderable(t: GradientTick): boolean {
  return isValidStopColor(t.color) && typeof t.position === "number" && Number.isFinite(t.position);
}

/**
 * Why `ticks` is outside the v1 input domain, or null when it is scorable.
 * Domain: at least two stops, each an opaque `#rrggbb` colour at a finite
 * position in 0..100. The reason names the first offending stop by its index
 * in the INPUT array (so, unlike scores, it can depend on array order).
 */
export function unscorableReason(ticks: readonly GradientTick[]): string | null {
  const { minStops, minPosition, maxPosition } = V1_MODEL.domain;
  if (!Array.isArray(ticks) || ticks.length < minStops) {
    return `needs at least ${minStops} stops`;
  }
  for (let i = 0; i < ticks.length; i++) {
    const t = ticks[i];
    if (!t || !isValidStopColor(t.color)) {
      return `stop ${i}: colour ${JSON.stringify(t?.color)} is not an opaque #rrggbb hex colour`;
    }
    if (typeof t.position !== "number" || !Number.isFinite(t.position)) {
      return `stop ${i}: position is not a finite number`;
    }
    if (t.position < minPosition || t.position > maxPosition) {
      return `stop ${i}: position ${t.position} is outside ${minPosition}..${maxPosition}`;
    }
  }
  return null;
}

/** Stable sort by position (array order breaks ties, as CSS paints them). */
function sortByPosition<T extends { position: number }>(ticks: readonly T[]): T[] {
  return [...ticks].sort((a, b) => a.position - b.position);
}

/** Indices of interior local extrema of `values`. */
function interiorExtrema(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length - 1; i++) {
    const prev = values[i - 1],
      cur = values[i],
      next = values[i + 1];
    if ((cur < prev && cur < next) || (cur > prev && cur > next)) out.push(i);
  }
  return out;
}

/** Index of the value deviating most from `mean` (first on ties). */
function mostDeviant(values: number[], mean: number): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (Math.abs(values[i] - mean) > Math.abs(values[best] - mean)) best = i;
  }
  return best;
}

const UNSCORABLE_DETAILS = (): ScoreDetails => ({ lightness: 0, hue: 0, chroma: 0, spacing: 0 });

/**
 * Score a gradient 0-100 under scoring model v1 (`V1_MODEL`, spec/scoring-v1.md).
 *
 * The stops are stable-sorted by position first, so the result does not depend
 * on the order of the input array (except among stops sharing a position,
 * whose array order is what CSS paints and is therefore kept). Input outside
 * the v1 domain returns `status: "unscorable"` with a reason and score 0.
 */
export function scoreGradient(ticks: GradientTick[]): GradientScore {
  const reason = unscorableReason(ticks);
  if (reason !== null) {
    return { status: "unscorable", reason, score: 0, issues: [], details: UNSCORABLE_DETAILS(), findings: [] };
  }

  const M = V1_MODEL;
  const sorted = sortByPosition(ticks);
  const n = sorted.length;
  const positions = sorted.map((t) => t.position);
  const oklabs = sorted.map((t) => rgbToOklab(hexToRgb(t.color)));
  const lchs = oklabs.map((lab) => oklabToLch(lab));
  const rgbs = sorted.map((t) => hexToRgb(t.color));
  const all = sorted.map((_, i) => i);
  const seg = (i: number): Pick<Finding, "stops" | "segment"> => ({
    stops: [i, i + 1],
    segment: [positions[i], positions[i + 1]],
  });

  const findings: Finding[] = [];
  const add = (
    code: string,
    dimension: Dimension,
    tier: Pick<Tier, "penalty" | "severity" | "message">,
    where: Pick<Finding, "stops" | "segment">,
  ): number => {
    // Key order matters for the vectors: code, severity, dimension, pointsLost, stops, segment, message.
    const f = { code, severity: tier.severity, dimension, pointsLost: tier.penalty } as Finding;
    if (where.stops) f.stops = [...new Set(where.stops)].sort((a, b) => a - b);
    if (where.segment) f.segment = [where.segment[0], where.segment[1]];
    f.message = tier.message;
    findings.push(f);
    return tier.penalty;
  };

  // Per-segment quantities (position-neighbours).
  const segmentGaps: number[] = [];
  const segmentDeltaE: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    segmentGaps.push(positions[i + 1] - positions[i]);
    segmentDeltaE.push(oklabDeltaE(oklabs[i], oklabs[i + 1]));
  }

  // ── 1. Lightness flow ──────────────────────────────────────────────────
  //    - Monotonicity: penalise reversals (interior local extrema)
  //    - Helmholtz–Kohlrausch: perceived brightness ≠ measured L for vivid stops
  //    - Perceptual contrast: penalise near-identical stops (gradient = solid)
  //    - Transition abruptness: penalise big color jumps squeezed into tiny %
  //    - Velocity uniformity: ΔE per position-% should be roughly constant
  const ML = M.lightness;
  let lightnessScore: number = M.weights.lightness;

  // 1a. Monotonicity (only meaningful for 3+ stops; 2 stops are trivially monotonic)
  const reversals = interiorExtrema(lchs.map((l) => l.L));
  const dips = reversals.length;
  if (dips > 0) {
    const message = ML.reversal.messageTemplate
      .replace("{count}", String(dips))
      .replace("{plural}", dips > 1 ? "s" : "");
    lightnessScore -= add(
      ML.reversal.code,
      "lightness",
      { penalty: dips * ML.reversal.penaltyPerReversal, severity: ML.reversal.severity, message },
      { stops: reversals },
    );
  }

  // 1a′. Helmholtz–Kohlrausch perceived-brightness check.
  //      Saturated colors appear brighter than their measured OKLAB L.
  //      First-order model: L_apparent ≈ L + k·C
  const hkReversals = interiorExtrema(lchs.map((l) => l.L + ML.perceivedReversal.chromaWeight * l.C));
  if (dips === 0 && hkReversals.length > 0) {
    lightnessScore -= add(ML.perceivedReversal.code, "lightness", ML.perceivedReversal.tier, {
      stops: hkReversals,
    });
  }

  // 1b. Perceptual contrast — max OKLAB ΔE between any two stops.
  let maxDeltaE = 0;
  for (let i = 0; i < oklabs.length; i++) {
    for (let j = i + 1; j < oklabs.length; j++) {
      maxDeltaE = Math.max(maxDeltaE, oklabDeltaE(oklabs[i], oklabs[j]));
    }
  }
  const whole = { stops: all, segment: [positions[0], positions[n - 1]] as [number, number] };
  if (maxDeltaE < ML.contrast.invisibleBelow) {
    lightnessScore -= add(ML.contrast.code, "lightness", ML.contrast.invisible, whole);
  } else if (maxDeltaE < ML.contrast.lowBelow) {
    lightnessScore -= add(ML.contrast.code, "lightness", ML.contrast.low, whole);
  }

  // 1c. Transition abruptness — first neighbour pair with a big ΔE in a small gap.
  let maxCloseJumpDeltaE = 0;
  let abruptAt = -1;
  for (let i = 0; i < n - 1; i++) {
    const gap = segmentGaps[i];
    if (gap > 0 && gap <= ML.abruptJump.maxGap) {
      maxCloseJumpDeltaE = Math.max(maxCloseJumpDeltaE, segmentDeltaE[i]);
      if (abruptAt < 0 && segmentDeltaE[i] > ML.abruptJump.deltaEAbove) abruptAt = i;
    }
  }
  if (abruptAt >= 0) {
    lightnessScore -= add(ML.abruptJump.code, "lightness", ML.abruptJump.tier, seg(abruptAt));
  }

  // 1d. Perceptual velocity uniformity — CV of ΔE per position-% over segments.
  let velocityCv: number | null = null;
  if (n >= ML.velocity.minStops) {
    const velocities: number[] = [];
    const velocitySegments: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const posGap = segmentGaps[i];
      if (posGap > 0) {
        velocities.push(segmentDeltaE[i] / posGap);
        velocitySegments.push(i);
      }
    }
    if (velocities.length >= ML.velocity.minSegments) {
      const avgV = velocities.reduce((a, v) => a + v, 0) / velocities.length;
      if (avgV > 0) {
        const variance =
          velocities.reduce((a, v) => a + (v - avgV) ** 2, 0) /
          velocities.length;
        const cv = Math.sqrt(variance) / avgV;
        velocityCv = cv;
        const where = seg(velocitySegments[mostDeviant(velocities, avgV)]);
        if (cv > ML.velocity.strongAbove) {
          lightnessScore -= add(ML.velocity.code, "lightness", ML.velocity.strong, where);
        } else if (cv > ML.velocity.mildAbove) {
          lightnessScore -= add(ML.velocity.code, "lightness", ML.velocity.mild, where);
        }
      }
    }
  }

  // ── 2. Hue harmony ─────────────────────────────────────────────────────
  //    - Enclosing arc: minimum arc spanning all chromatic hues
  //    - Direction consistency: hue should progress CW or CCW, not zigzag
  const MH = M.hue;
  const chromatic = all.filter((i) => lchs[i].C > MH.chromaticAbove);
  let hueScore: number = M.weights.hue;
  let enclosingArc: number | null = null;
  if (chromatic.length >= 2) {
    const byHue = chromatic.map((i) => ({ h: lchs[i].h, i })).sort((a, b) => a.h - b.h);
    const last = byHue.length - 1;
    let maxGap = byHue[0].h + 360 - byHue[last].h;
    // The arc runs from the hue after the largest gap round to the hue before it.
    let arcEnds = [byHue[0].i, byHue[last].i];
    for (let k = 1; k < byHue.length; k++) {
      const gap = byHue[k].h - byHue[k - 1].h;
      if (gap > maxGap) {
        maxGap = gap;
        arcEnds = [byHue[k].i, byHue[k - 1].i];
      }
    }
    enclosingArc = 360 - maxGap;
    const where = { stops: arcEnds };

    if (enclosingArc > MH.arc.clashAbove) {
      hueScore -= add(MH.arc.wideCode, "hue", MH.arc.clash, where);
    } else if (enclosingArc > MH.arc.wideAbove) {
      hueScore -= add(MH.arc.wideCode, "hue", MH.arc.wide, where);
    } else if (enclosingArc < MH.arc.narrowBelow) {
      hueScore -= add(MH.arc.narrowCode, "hue", MH.arc.narrow, where);
    }
  }

  // 2b. Hue direction consistency over chromatic stops in position order.
  //     Reversals in hue direction cause the browser's sRGB interpolation to
  //     cross through muddy intermediate tones.
  const hueSteps: number[] = [];
  if (chromatic.length >= 2) {
    for (let k = 0; k < chromatic.length - 1; k++) {
      let delta = lchs[chromatic[k + 1]].h - lchs[chromatic[k]].h;
      delta = (((delta + 180) % 360) + 360) % 360 - 180; // shortest arc
      hueSteps.push(delta);
    }
  }
  if (chromatic.length >= MH.direction.minChromaticStops) {
    let cwCount = 0,
      ccwCount = 0;
    const turns: number[] = [];
    let lastSign = 0;
    for (let k = 0; k < hueSteps.length; k++) {
      const delta = hueSteps[k];
      const sign = delta > MH.direction.minStep ? 1 : delta < -MH.direction.minStep ? -1 : 0;
      if (sign > 0) cwCount++;
      else if (sign < 0) ccwCount++;
      if (sign !== 0) {
        // The stop where the new direction starts.
        if (lastSign !== 0 && sign !== lastSign) turns.push(chromatic[k]);
        lastSign = sign;
      }
    }
    if (cwCount > 0 && ccwCount > 0) {
      hueScore -= add(MH.direction.code, "hue", MH.direction.tier, { stops: turns });
    }
  }

  // ── 3. Saturation balance ──────────────────────────────────────────────
  //    - Stop-level chroma consistency
  //    - Chroma coherence (achromatic stops among chromatic ones)
  //    - sRGB midpoint desaturation
  //    - Banding risk: 8-bit quantization with low colour resolution
  const MC = M.chroma;
  const chromas = lchs.map((l) => l.C);
  const maxC = Math.max(...chromas),
    minC = Math.min(...chromas);
  const chromaRange = maxC - minC;
  let chromaScore: number = M.weights.chroma;

  // 3a. Stop-level chroma consistency
  const rangeWhere = { stops: [chromas.indexOf(maxC), chromas.indexOf(minC)] };
  if (chromaRange > MC.range.spikeAbove) {
    chromaScore -= add(MC.range.code, "chroma", MC.range.spike, rangeWhere);
  } else if (chromaRange > MC.range.unevenAbove) {
    chromaScore -= add(MC.range.code, "chroma", MC.range.uneven, rangeWhere);
  }

  // 3b. Chroma coherence — a near-achromatic stop among vivid chromatic
  //     stops creates a desaturated "hole" that looks off.
  let coherenceRatio: number | null = null;
  if (n >= MC.coherence.minStops) {
    const achromatic = all.filter((i) => chromas[i] < MC.coherence.achromaticBelow);
    const vivid = all.filter((i) => chromas[i] >= MC.coherence.vividAtLeast);
    if (achromatic.length > 0 && vivid.length > 0) {
      const maxChromatic = Math.max(...vivid.map((i) => chromas[i]));
      const minAchromatic = Math.min(...achromatic.map((i) => chromas[i]));
      const ratio = minAchromatic / maxChromatic; // 0 = total mismatch
      coherenceRatio = ratio;
      if (ratio < MC.coherence.deadZoneBelow) {
        chromaScore -= add(MC.coherence.code, "chroma", MC.coherence.deadZone, { stops: achromatic });
      } else if (ratio < MC.coherence.gapBelow) {
        chromaScore -= add(MC.coherence.code, "chroma", MC.coherence.gap, { stops: achromatic });
      }
    }
  }

  // 3c. Midpoint desaturation — browsers interpolate in sRGB, which can
  //     produce a muddy grey/brown between two vivid stops.
  let worstDip = 0;
  let worstDipAt = -1;
  const segmentEndpointChroma: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const rgb1 = rgbs[i];
    const rgb2 = rgbs[i + 1];
    const midRgb: RGB = {
      r: Math.round((rgb1.r + rgb2.r) / 2),
      g: Math.round((rgb1.g + rgb2.g) / 2),
      b: Math.round((rgb1.b + rgb2.b) / 2),
    };
    const midLch = oklabToLch(rgbToOklab(midRgb));
    const avgEndpointChroma = (lchs[i].C + lchs[i + 1].C) / 2;
    segmentEndpointChroma.push(avgEndpointChroma);
    if (avgEndpointChroma > MC.midpoint.endpointChromaAbove) {
      const dip = 1 - midLch.C / avgEndpointChroma;
      if (dip > worstDip) {
        worstDip = dip;
        worstDipAt = i;
      }
    }
  }
  if (worstDip > MC.midpoint.muddyAbove) {
    chromaScore -= add(MC.midpoint.code, "chroma", MC.midpoint.muddy, seg(worstDipAt));
  } else if (worstDip > MC.midpoint.slightAbove) {
    chromaScore -= add(MC.midpoint.code, "chroma", MC.midpoint.slight, seg(worstDipAt));
  }

  // 3d. Banding risk — max(|ΔR|, |ΔG|, |ΔB|) ≈ number of distinct output
  //     colors in a span; few levels over a long span show as bands.
  const segmentRgbSteps: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const c1 = rgbs[i];
    const c2 = rgbs[i + 1];
    segmentRgbSteps.push(Math.max(Math.abs(c1.r - c2.r), Math.abs(c1.g - c2.g), Math.abs(c1.b - c2.b)));
  }
  for (let i = 0; i < n - 1; i++) {
    const rgbSteps = segmentRgbSteps[i];
    const posSpan = segmentGaps[i];
    if (rgbSteps < MC.banding.strongStepsBelow && posSpan > MC.banding.strongSpanAbove) {
      chromaScore -= add(MC.banding.code, "chroma", MC.banding.strong, seg(i));
      break;
    } else if (rgbSteps < MC.banding.subtleStepsBelow && posSpan > MC.banding.subtleSpanAbove) {
      chromaScore -= add(MC.banding.code, "chroma", MC.banding.subtle, seg(i));
      break;
    }
  }

  // ── 4. Stop rhythm (ScoreDetails.spacing) ──────────────────────────────
  //    - Edge coverage: first stop near 0%, last stop near 100%
  //    - Transition span: stops should cover a wide range
  //    - Rhythm: gaps between stops should be fairly even (3+ stops)
  const MR = M.rhythm;
  const firstPos = positions[0];
  const lastPos = positions[n - 1];
  let spacingScore: number = M.weights.rhythm;
  const ends = { stops: [0, n - 1] };

  // 4a. Edge coverage — stops far from the edges create solid-color "dead zones".
  const edgeGap = firstPos + (100 - lastPos); // total uncovered %
  if (edgeGap > MR.edge.bunchedAbove) {
    spacingScore -= add(MR.edge.code, "rhythm", MR.edge.bunched, ends);
  } else if (edgeGap > MR.edge.shortAbove) {
    spacingScore -= add(MR.edge.code, "rhythm", MR.edge.short, ends);
  } else if (edgeGap > MR.edge.slightAbove) {
    spacingScore -= add(MR.edge.code, "rhythm", MR.edge.slight, ends);
  }

  // 4b. Transition span — a very short span is a thin stripe in the gradient.
  const span = lastPos - firstPos;
  const spanWhere = { stops: [0, n - 1], segment: [firstPos, lastPos] as [number, number] };
  if (span < MR.span.squeezedBelow) {
    spacingScore -= add(MR.span.code, "rhythm", MR.span.squeezed, spanWhere);
  } else if (span < MR.span.narrowBelow) {
    spacingScore -= add(MR.span.code, "rhythm", MR.span.narrow, spanWhere);
  }

  // 4c. Rhythm — gap evenness via coefficient of variation.
  let gapCv: number | null = null;
  if (n >= MR.gaps.minStops) {
    const gaps = segmentGaps;
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avgGap > 0) {
      const variance =
        gaps.reduce((a, g) => a + Math.pow(g - avgGap, 2), 0) / gaps.length;
      const cv = Math.sqrt(variance) / avgGap;
      gapCv = cv;
      const where = seg(mostDeviant(gaps, avgGap));
      if (cv > MR.gaps.clusteredAbove) {
        spacingScore -= add(MR.gaps.code, "rhythm", MR.gaps.clustered, where);
      } else if (cv > MR.gaps.unevenAbove) {
        spacingScore -= add(MR.gaps.code, "rhythm", MR.gaps.uneven, where);
      }
    }
  }

  const measurements: ScoreMeasurements = {
    lightnessReversals: dips,
    perceivedReversals: hkReversals.length,
    maxDeltaE,
    maxCloseJumpDeltaE,
    velocityCv,
    stopChroma: chromas,
    enclosingArc,
    hueSteps,
    chromaRange,
    coherenceRatio,
    segmentEndpointChroma,
    worstDip,
    segmentRgbSteps,
    segmentGaps,
    edgeGap,
    span,
    gapCv,
  };

  const details: ScoreDetails = {
    lightness: Math.max(0, lightnessScore),
    hue: Math.max(0, hueScore),
    chroma: Math.max(0, chromaScore),
    spacing: Math.max(0, spacingScore),
    measurements,
  };
  const total = details.lightness + details.hue + details.chroma + details.spacing;
  return {
    status: "ok",
    score: total,
    issues: findings.map((f) => f.message),
    details,
    findings,
  };
}

// ── Gradient suggestion engine ("refine") ─────────────────────────────────────

export interface RefineResult {
  /** The refined stops, or (when declined) the input, position-sorted. */
  stops: GradientTick[];
  /** False when refine declined and `stops` is the input unchanged. */
  refined: boolean;
  /** Why refine declined. */
  declined?: "unscorable" | "single-position" | "would-lower-score";
  /** Score of the input and of `stops` (0 / 0 when unscorable). */
  before: number;
  after: number;
}

/**
 * Refine a gradient under model v1 and say whether it did.
 *
 * Guarantees (PLAN §3.5):
 *   1. never lowers the score: if the refinement would score below the input,
 *      the input is returned unchanged (same colours, positions and ids, in
 *      position order) with `declined: "would-lower-score"`;
 *   2. keeps achromatic stops achromatic (OKLCH C <= refine.achromaticAtMost):
 *      they keep their own chroma and hue (only L is smoothed), are left out of
 *      the circular hue mean and of the mean chroma;
 *   3. keeps hard stops: position-neighbours at most refine.hardStopGap apart
 *      move together as one group and keep their offsets; if every stop is in
 *      one group there is nothing to redistribute and refine declines;
 *   4. is invariant under permutations of the input array (it sorts first).
 * Input outside the v1 domain is returned as is (declined: "unscorable").
 */
export function refineGradient(ticks: GradientTick[]): RefineResult {
  if (unscorableReason(ticks) !== null) {
    return { stops: ticks, refined: false, declined: "unscorable", before: 0, after: 0 };
  }
  const R = V1_MODEL.refine;
  const byPos = sortByPosition(ticks);
  const n = byPos.length;
  const before = scoreGradient(ticks).score;
  const unchanged = (declined: RefineResult["declined"]): RefineResult => ({
    stops: byPos.map((t) => ({ id: t.id, color: t.color, position: t.position })),
    refined: false,
    declined,
    before,
    after: before,
  });

  // Hard-stop groups: runs of position-neighbours at most hardStopGap apart.
  const group: number[] = [0];
  for (let i = 1; i < n; i++) {
    const sameGroup = byPos[i].position - byPos[i - 1].position <= R.hardStopGap;
    group.push(sameGroup ? group[i - 1] : group[i - 1] + 1);
  }
  const groups = group[n - 1] + 1;
  if (groups < 2) return unchanged("single-position");

  let lchs = byPos.map((t) => oklabToLch(rgbToOklab(hexToRgb(t.color))));
  const achromatic = lchs.map((c) => c.C <= R.achromaticAtMost);

  // Step 1: Smooth lightness monotonically along the existing direction.
  const firstL = lchs[0].L;
  const lastL = lchs[lchs.length - 1].L;
  lchs = lchs.map((c, i) => {
    const t = i / (lchs.length - 1);
    const targetL = firstL + t * (lastL - firstL);
    return { ...c, L: c.L * R.lightnessKeep + targetL * (1 - R.lightnessKeep) };
  });

  // Step 2: Compress the hue arc of the chromatic stops to <= maxHueArc around
  //   their circular mean. Achromatic stops have no meaningful hue and are
  //   neither counted nor moved. When the hues nearly cancel out (mean
  //   resultant length below degenerateResultantBelow, e.g. opposed hues) the
  //   mean is noise, so the centre is the midpoint of the shorter arc from the
  //   first to the last chromatic stop by position (at exactly 180°, towards
  //   increasing hue).
  const chromatic = lchs.filter((_, i) => !achromatic[i]);
  if (chromatic.length >= 2) {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const toDeg = (rad: number) => (rad * 180) / Math.PI;
    const meanX = chromatic.reduce((a, c) => a + Math.cos(toRad(c.h)), 0) / chromatic.length;
    const meanY = chromatic.reduce((a, c) => a + Math.sin(toRad(c.h)), 0) / chromatic.length;
    let meanHue: number;
    if (Math.sqrt(meanX * meanX + meanY * meanY) < R.degenerateResultantBelow) {
      const h1 = chromatic[0].h;
      const d = ((chromatic[chromatic.length - 1].h - h1) % 360 + 360) % 360;
      meanHue = ((d <= 180 ? h1 + d / 2 : h1 - (360 - d) / 2) + 360) % 360;
    } else {
      meanHue = (toDeg(Math.atan2(meanY, meanX)) + 360) % 360;
    }

    // Measure enclosing arc
    const sortedH = chromatic.map((c) => c.h).sort((a, b) => a - b);
    let maxGap = sortedH[0] + 360 - sortedH[sortedH.length - 1];
    for (let i = 1; i < sortedH.length; i++) {
      maxGap = Math.max(maxGap, sortedH[i] - sortedH[i - 1]);
    }
    const arc = 360 - maxGap;

    if (arc > R.maxHueArc) {
      const scale = R.maxHueArc / arc;
      lchs = lchs.map((c, i) => {
        if (achromatic[i]) return c;
        // Signed shortest-path delta from the centre
        let delta = c.h - meanHue;
        delta = ((delta + 180) % 360 + 360) % 360 - 180;
        return { ...c, h: ((meanHue + delta * scale) + 360) % 360 };
      });
    }
  }

  // Step 3: Smooth chroma of the chromatic stops — a gentle envelope peaking
  //   in the middle around their mean chroma. Achromatic stops keep theirs.
  if (chromatic.length > 0) {
    const avgC = chromatic.reduce((a, c) => a + c.C, 0) / chromatic.length;
    lchs = lchs.map((c, i) => {
      if (achromatic[i]) return c;
      const t = i / (lchs.length - 1);
      const envelope = 1 + R.chromaEnvelope * Math.sin(Math.PI * t);
      return { ...c, C: Math.min(R.maxChroma, avgC * envelope) };
    });
  }

  // Step 4: Redistribute evenly — one slot per hard-stop group; members keep
  //   their offset from the group's first stop, the last group ends at 100.
  const groupStart: number[] = [];
  const groupWidth: number[] = [];
  for (let i = 0; i < n; i++) {
    const g = group[i];
    if (groupStart[g] === undefined) groupStart[g] = byPos[i].position;
    groupWidth[g] = byPos[i].position - groupStart[g];
  }
  const newPositions: number[] = [];
  for (let i = 0; i < n; i++) {
    const g = group[i];
    const anchor =
      g === groups - 1 && groups > 1
        ? 100 - groupWidth[g]
        : Math.round((g / (groups - 1)) * 100);
    const p = anchor + (byPos[i].position - groupStart[g]);
    newPositions.push(i > 0 ? Math.max(newPositions[i - 1], p) : p);
  }

  const stops = lchs.map((lch, i) => {
    let color = rgbToHex(oklabToRgb(lchToOklab(lch)));
    // 8-bit rounding must not push an achromatic stop over the line.
    if (achromatic[i] && hexToOklch(color).C > R.achromaticAtMost) {
      color = rgbToHex(oklabToRgb(lchToOklab({ ...lch, C: 0 })));
    }
    return { id: byPos[i].id, position: newPositions[i], color };
  });

  const after = scoreGradient(stops).score;
  if (after < before) return unchanged("would-lower-score");
  return { stops, refined: true, before, after };
}

/**
 * One-click refinement (see `refineGradient` for the guarantees). Returns the
 * input itself when it has fewer than two stops or is outside the v1 domain.
 */
export function suggestGradient(ticks: GradientTick[]): GradientTick[] {
  if (ticks.length < 2) return ticks;
  return refineGradient(ticks).stops;
}

// ── Gradient CSS builder ──────────────────────────────────────────────────────

/**
 * `linear-gradient(…)` for the stops, sorted by position. Stops with an
 * invalid colour or a non-finite position are skipped (never `NaN` in CSS);
 * with no usable stop the result is the neutral fallback `#ccc`.
 */
export function buildGradientCSS(ticks: GradientTick[], angle: number): string {
  ticks = ticks.filter(isRenderable);
  if (ticks.length === 0) return "#ccc";
  const sorted = [...ticks].sort((a, b) => a.position - b.position);
  const stops = sorted.map((t) => `${t.color} ${t.position}%`).join(", ");
  return `linear-gradient(${angle}deg, ${stops})`;
}

// ── Multi-angle gradients ─────────────────────────────────────────────────────

/** Hard ceiling on simultaneous gradient directions. */
export const MAX_DIRECTIONS = 7;

export interface GradientDirection {
  id: number;
  /** CSS angle in degrees: 0 = to top, increasing clockwise. */
  angle: number;
  /** Relative influence of this direction, 1-100. */
  weight: number;
  enabled: boolean;
}

export type GradientBlendMode =
  | "normal"
  | "screen"
  | "multiply"
  | "overlay"
  | "soft-light"
  | "hard-light"
  | "difference"
  | "lighten"
  | "darken";

export interface GradientStyle {
  background: string;
  backgroundBlendMode: string;
}

/** `#rrggbb` + alpha → `rgba(r, g, b, a)`. */
function rgbaString(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(clamp(alpha, 0, 1) * 1000) / 1000})`;
}

/**
 * Compose the same stop list into up to `MAX_DIRECTIONS` stacked linear-gradient
 * layers, one per direction, producing a single multi-angle field.
 *
 * With `blend: "normal"` the layers are alpha-composited so the result is the
 * exact weighted average of every direction. Painting bottom-to-top with
 * `alpha_k = w_k / (w_1 + … + w_k)` makes layer k contribute exactly
 * `w_k / Σw` — the standard progressive-average trick. Other blend modes hand
 * the layers to `background-blend-mode` instead, with alpha scaled against the
 * heaviest direction so weights still read as intensity.
 *
 * Note that CSS lists background layers top-first, so the emitted lists are
 * reversed relative to the paint order reasoned about above.
 */
export function buildMultiGradientStyle(
  ticks: GradientTick[],
  directions: GradientDirection[],
  blend: GradientBlendMode = "normal",
): GradientStyle {
  // Invalid stops are skipped, as in buildGradientCSS.
  ticks = ticks.filter(isRenderable);
  if (ticks.length === 0) return { background: "#ccc", backgroundBlendMode: "normal" };

  const active = directions.filter((d) => d.enabled && d.weight > 0);
  if (active.length === 0) {
    // Nothing to project — fall back to a flat wash of the first stop.
    const sorted = [...ticks].sort((a, b) => a.position - b.position);
    return { background: sorted[0].color, backgroundBlendMode: "normal" };
  }

  const sorted = [...ticks].sort((a, b) => a.position - b.position);
  const maxWeight = Math.max(...active.map((d) => d.weight));

  let cumulative = 0;
  const layers = active.map((d) => {
    cumulative += d.weight;
    const alpha = blend === "normal" ? d.weight / cumulative : d.weight / maxWeight;
    const stops = sorted
      .map((t) => `${rgbaString(t.color, alpha)} ${t.position}%`)
      .join(", ");
    return `linear-gradient(${d.angle}deg, ${stops})`;
  });

  // The bottom layer has nothing beneath it to blend with, so it stays normal.
  const modes = active.map((_, i) => (i === 0 ? "normal" : blend));

  return {
    background: layers.reverse().join(", "),
    backgroundBlendMode: modes.reverse().join(", "),
  };
}

/** `n` directions spread evenly around the circle, starting at `start`. */
export function spreadDirectionAngles(n: number, start = 135): number[] {
  const count = Math.max(1, Math.min(MAX_DIRECTIONS, n));
  return Array.from({ length: count }, (_, i) =>
    Math.round((start + (i * 360) / count) % 360),
  );
}

// ── Gradient interpolation ────────────────────────────────────────────────────

interface SampleStop {
  pos: number;
  color: string;
  lab: OklabColor;
}

/**
 * The one bracket search shared by `interpolateGradient` and
 * `colorAtPosition`. `stops` is non-empty and position-sorted; `x` is in the
 * same unit as `pos`. At or before the first stop the first stop's colour is
 * returned verbatim, at or after the last stop the last one's (as CSS paints
 * beyond the end stops); in between, OKLAB interpolation between the first
 * pair whose upper stop is at or past `x`.
 */
function sampleSorted(stops: SampleStop[], x: number): string {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!(x > first.pos)) return first.color; // also NaN
  if (x >= last.pos) return last.color;

  let lo = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    if (stops[i + 1].pos >= x) {
      lo = i;
      break;
    }
  }
  const a = stops[lo];
  const b = stops[lo + 1];
  const span = b.pos - a.pos;
  const frac = span === 0 ? 0 : (x - a.pos) / span;
  return rgbToHex(
    oklabToRgb({
      L: a.lab.L + (b.lab.L - a.lab.L) * frac,
      a: a.lab.a + (b.lab.a - a.lab.a) * frac,
      b: a.lab.b + (b.lab.b - a.lab.b) * frac,
    }),
  );
}

/** Usable stops, position-sorted, with `pos` in units of `scale` percent. */
function sampleStops(ticks: GradientTick[], scale: number): SampleStop[] {
  return sortByPosition(ticks.filter(isRenderable)).map((t) => ({
    pos: t.position / scale,
    color: t.color,
    lab: rgbToOklab(hexToRgb(t.color)),
  }));
}

/**
 * Sample `n` evenly-spaced colors from a gradient, interpolated in OKLAB space.
 * Returns an array of hex color strings. Samples before the first stop take
 * its colour and samples after the last stop take the last one's (clamped,
 * like CSS); stops with an invalid colour or position are skipped.
 */
export function interpolateGradient(ticks: GradientTick[], n: number): string[] {
  const valid = ticks.filter(isRenderable);
  if (valid.length === 0) return [];
  if (valid.length === 1 || n <= 1) return [valid[0].color];

  const stops = sampleStops(valid, 100);
  const result: string[] = [];
  for (let i = 0; i < n; i++) {
    result.push(sampleSorted(stops, i / (n - 1))); // t in 0..1
  }
  return result;
}

/**
 * The colour a gradient shows at `position` (0-100), interpolated in OKLAB
 * between the surrounding stops. Positions outside the stop range take the
 * nearest end stop's colour, matching how CSS paints beyond the first/last stop.
 * Invalid stops are skipped; with none left the result is `#000000`.
 */
export function colorAtPosition(ticks: GradientTick[], position: number): string {
  const stops = sampleStops(ticks, 1);
  if (stops.length === 0) return "#000000";
  return sampleSorted(stops, position);
}
