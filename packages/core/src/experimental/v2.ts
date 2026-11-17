// ── EXPERIMENTAL: interpolation-aware scoring prototype ("v2-experimental") ────
// Research prototype for spec/scoring-v2.md. NOT the v1 model, NOT a default
// anywhere, NOT covered by the v1 vectors (PLAN §3.5, D8). Every number in
// V2_MODEL is a first guess: tuning not validated (no human data exists, D5).
//
// Model: sample the RENDERED path. For a linear gradient with interpolation
// {space: srgb | oklab | oklch, hue}, sample the colour along the gradient line
// in that space exactly as CSS Color 4 describes (missing/powerless hues, hue
// fix-up per path), gamut-map out-of-sRGB results (CSS Color 4 "CSS gamut
// mapping to an RGB destination" by default, or per-channel clipping), and compute each dimension on the
// samples. Rules that are properties of the stop set alone (positions, stop
// chroma classes, stop placement) are carried over from v1 unchanged.
//
// Cost: S <= sum over segments of (ceil(intervalsPerUnit * gap) +
// minIntervalsPerSegment) + 1 + n (hard stops) + 2 (edges) +
// refine.maxExtraSamples <= 516 + 10n samples for n stops. Each sample costs O(1) plus at most
// ~13 gamut-mapping iterations. Rules are O(S) except the path diameter
// (O(S^2)) and the visited-hue arc (O(S log S)). Pure, deterministic,
// allocation-bounded, never throws, zero dependencies.

import { hexToRgb, oklabToLinearRgb, rgbToOklab, type OklabColor } from "../gradient-engine";
import { isDocumentLike, resolveStops, stopAlpha } from "../api/document";
import type {
  GradientDocument,
  HueInterpolation,
  Interpolation,
  InterpolationSpace,
  Issue,
  IssueDimension,
  IssueSeverity,
  ResolvedStop,
  ScoreAnalysis,
  UnscorableCode,
} from "../api/types";

// ── Frozen model table ─────────────────────────────────────────────────────────

type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export type V2Dimension = "lightness" | "hue" | "chroma" | "rhythm";

export interface V2Tier {
  readonly penalty: number;
  readonly severity: IssueSeverity;
  readonly message: string;
}

/**
 * The v2-experimental model. TUNING NOT VALIDATED: every threshold below is
 * either copied from V1_MODEL (rules carried over unchanged; a test checks the
 * copies) or a first guess documented in spec/scoring-v2.md. Comparison
 * direction is part of each name, as in v1 (`…Above` strictly greater, etc.).
 */
export const V2_MODEL = /* @__PURE__ */ deepFreeze({
  version: "v2-experimental",
  validated: false,

  domain: { minStops: 2 },

  weights: { lightness: 30, hue: 30, chroma: 20, rhythm: 20 },

  sampling: {
    /** Base density: intervals per unit of gradient line (1/256 ≈ 3.9 px at 1000 px). */
    intervalsPerUnit: 256,
    /** Every segment with a positive gap gets at least this many intervals. */
    minIntervalsPerSegment: 8,
    refine: {
      /** Bisection passes; each pass splits every flagged interval once. */
      maxPasses: 4,
      /** Hard cap on samples added by refinement (whole gradient). */
      maxExtraSamples: 256,
      /** Split an interval whose displayed ΔE exceeds this (half a JND). */
      deltaEAbove: 0.01,
      /** Split where the path turns by more than this many degrees in OKLAB. */
      turnAboveDeg: 20,
    },
  },

  color: {
    /**
     * OKLCH chroma at or below which a hue is powerless (treated as missing
     * when interpolating in oklch). Value of the CSS Color 4 sample
     * OKLab→OKLCH conversion code as we recall it; browsers may differ.
     */
    powerlessChromaAtMost: 0.000004,
    /** Stops at or below this chroma have no meaningful hue (= V1 hue.chromaticAbove). */
    achromaticAtMost: 0.02,
    /** Samples above this displayed chroma show a visible hue (unexpected-hue rule). */
    visibleHueChromaAbove: 0.04,
    /** CSS Color 4 gamut-mapping constants (JND, epsilon). */
    gamut: { jnd: 0.02, epsilon: 0.0001, channelTolerance: 1e-6 },
  },

  lightness: {
    reversal: {
      code: "v2/lightness-reversal",
      /** A turn counts only when L retraces at least this much (one OKLAB JND, as CSS gamut mapping). */
      prominence: 0.02,
      penaltyPerReversal: 12,
      severity: "error" as IssueSeverity,
      messageTemplate: "Lightness along the rendered path reverses ({count} time{plural})",
    },
    perceivedReversal: {
      code: "v2/perceived-reversal",
      chromaWeight: 0.25,
      prominence: 0.02,
      tier: {
        penalty: 6,
        severity: "warning",
        message: "Apparent lightness (L + 0.25·C) reverses along the rendered path",
      } as V2Tier,
    },
    contrast: {
      code: "v2/low-contrast",
      invisibleBelow: 0.02,
      invisible: { penalty: 15, severity: "error", message: "The rendered path barely changes colour — gradient is invisible" } as V2Tier,
      lowBelow: 0.05,
      low: { penalty: 8, severity: "warning", message: "Very low contrast along the rendered path" } as V2Tier,
    },
    /** Carried over unchanged from v1 (stop placement). */
    abruptJump: {
      code: "lightness/abrupt-jump",
      maxGap: 10,
      deltaEAbove: 0.15,
      tier: { penalty: 8, severity: "warning", message: "Abrupt color jump between closely-spaced stops" } as V2Tier,
    },
    speed: {
      code: "v2/uneven-speed",
      /**
       * Speed is arc length per window of 1/windowsPerUnit of the line (≈16 px
       * at 1000 px), not per sample: OKLAB L = cbrt(Y) has an infinite slope at
       * black, so per-sample speed has unbounded variance as sampling refines.
       */
      windowsPerUnit: 64,
      strongAbove: 0.8,
      strong: { penalty: 8, severity: "warning", message: "Uneven perceptual speed along the rendered path" } as V2Tier,
      mildAbove: 0.5,
      mild: { penalty: 4, severity: "info", message: "Slightly uneven perceptual speed along the rendered path" } as V2Tier,
    },
  },

  hue: {
    /** Chromatic stops (C above this) and samples take part in the arc rules. */
    chromaticAbove: 0.02,
    /** Arc rules need at least this many chromatic stops (as v1). */
    minChromaticStops: 2,
    arc: {
      wideCode: "v2/hue-arc",
      clashAbove: 180,
      clash: { penalty: 20, severity: "error", message: "The rendered path visits a hue arc wider than 180°" } as V2Tier,
      wideAbove: 120,
      wide: { penalty: 8, severity: "warning", message: "The rendered path visits a wide hue arc (>120°)" } as V2Tier,
      narrowCode: "v2/narrow-hue-arc",
      narrowBelow: 15,
      narrow: { penalty: 5, severity: "info", message: "The rendered path stays within 15° of hue — reads as a single hue" } as V2Tier,
    },
    direction: {
      code: "v2/hue-direction-reversal",
      minStep: 5,
      tier: { penalty: 10, severity: "warning", message: "Hue travel along the rendered path reverses direction" } as V2Tier,
    },
    unexpected: {
      code: "v2/unexpected-hue",
      strongAbove: 35,
      strong: { penalty: 10, severity: "warning", message: "The rendered path shows hues far outside the stops' hue interval" } as V2Tier,
      mildAbove: 15,
      mild: { penalty: 4, severity: "info", message: "The rendered path drifts outside the stops' hue interval" } as V2Tier,
    },
    powerless: {
      code: "v2/powerless-hue",
      /** Near-grey stop whose (invisible) hue is this far from a chromatic neighbour's. */
      hueGapAbove: 30,
      tier: {
        penalty: 2,
        severity: "info",
        message: "A near-grey stop carries an invisible hue that steers the oklch path",
      } as V2Tier,
    },
  },

  chroma: {
    /** Carried over unchanged from v1 (stop chroma). */
    range: {
      code: "chroma/saturation-range",
      spikeAbove: 0.2,
      spike: { penalty: 12, severity: "error", message: "Saturation spikes dramatically — looks unintentional" } as V2Tier,
      unevenAbove: 0.12,
      uneven: { penalty: 5, severity: "info", message: "Uneven saturation across stops" } as V2Tier,
    },
    /** Carried over unchanged from v1 (stop chroma classes). */
    coherence: {
      code: "chroma/dead-zone",
      minStops: 3,
      achromaticBelow: 0.04,
      vividAtLeast: 0.08,
      deadZoneBelow: 0.15,
      deadZone: { penalty: 8, severity: "warning", message: "Grey/desaturated stop among vivid colors — creates a dead zone" } as V2Tier,
      gapBelow: 0.3,
      gap: { penalty: 4, severity: "info", message: "Noticeable saturation gap between some stops" } as V2Tier,
    },
    dip: {
      code: "v2/chroma-dip",
      endpointChromaAbove: 0.04,
      muddyAbove: 0.5,
      muddy: { penalty: 10, severity: "warning", message: "The interpolation path loses most of its chroma between stops (muddy)" } as V2Tier,
      slightAbove: 0.3,
      slight: { penalty: 5, severity: "info", message: "The interpolation path desaturates between stops" } as V2Tier,
    },
    banding: {
      code: "v2/banding",
      /** Reference gradient-line length in CSS px (overridable per call). */
      referenceLengthPx: 1000,
      strongBandPxAbove: 32,
      strong: { penalty: 6, severity: "warning", message: "Wide 8-bit bands at the reference length — visible banding likely" } as V2Tier,
      subtleBandPxAbove: 16,
      subtle: { penalty: 4, severity: "info", message: "8-bit bands at the reference length may be visible" } as V2Tier,
    },
    gamut: {
      code: "v2/gamut-excursion",
      strongAbove: 0.06,
      strong: { penalty: 8, severity: "warning", message: "The path leaves the sRGB gamut far — the display flattens or shifts it" } as V2Tier,
      mildAbove: 0.02,
      mild: { penalty: 4, severity: "info", message: "The path leaves the sRGB gamut — gamut mapping alters it slightly" } as V2Tier,
    },
  },

  /** Carried over unchanged from v1 (positions only). */
  rhythm: {
    edge: {
      code: "rhythm/edge-gap",
      bunchedAbove: 40,
      bunched: { penalty: 12, severity: "error", message: "Stops are bunched in the middle — large solid-color edges" } as V2Tier,
      shortAbove: 20,
      short: { penalty: 6, severity: "warning", message: "Stops don't reach the edges — visible solid-color zones" } as V2Tier,
      slightAbove: 10,
      slight: { penalty: 3, severity: "info", message: "Stops fall slightly short of the edges — small solid-color zones" } as V2Tier,
    },
    span: {
      code: "rhythm/narrow-span",
      squeezedBelow: 20,
      squeezed: { penalty: 8, severity: "warning", message: "Transition squeezed into a narrow band" } as V2Tier,
      narrowBelow: 40,
      narrow: { penalty: 4, severity: "info", message: "Transition covers less than 40% of the gradient" } as V2Tier,
    },
    gaps: {
      code: "rhythm/uneven-gaps",
      minStops: 3,
      clusteredAbove: 0.5,
      clustered: { penalty: 10, severity: "warning", message: "Stop positions are unevenly clustered" } as V2Tier,
      unevenAbove: 0.25,
      uneven: { penalty: 4, severity: "info", message: "Stop spacing is slightly uneven" } as V2Tier,
    },
  },
});

export type V2Origin = "v1-unchanged" | "redefined" | "new";

export interface V2CodeInfo {
  readonly dimension: V2Dimension;
  readonly origin: V2Origin;
  /** The v1 code this one replaces (redefined rules). */
  readonly replaces?: string;
}

const M = V2_MODEL;

/**
 * Every finding code v2-experimental can emit. Codes under `v2/` are new or
 * redefined (measured on the rendered path); the others keep their v1 code
 * because their definition is unchanged.
 */
export const V2_FINDING_CODES: Readonly<Record<string, V2CodeInfo>> = /* @__PURE__ */ (() =>
  deepFreeze({
    [M.lightness.reversal.code]: { dimension: "lightness", origin: "redefined", replaces: "lightness/reversal" },
    [M.lightness.perceivedReversal.code]: { dimension: "lightness", origin: "redefined", replaces: "lightness/perceived-reversal" },
    [M.lightness.contrast.code]: { dimension: "lightness", origin: "redefined", replaces: "lightness/low-contrast" },
    [M.lightness.abruptJump.code]: { dimension: "lightness", origin: "v1-unchanged" },
    [M.lightness.speed.code]: { dimension: "lightness", origin: "redefined", replaces: "lightness/uneven-speed" },
    [M.hue.arc.wideCode]: { dimension: "hue", origin: "redefined", replaces: "hue/wide-arc" },
    [M.hue.arc.narrowCode]: { dimension: "hue", origin: "redefined", replaces: "hue/narrow-arc" },
    [M.hue.direction.code]: { dimension: "hue", origin: "redefined", replaces: "hue/direction-reversal" },
    [M.hue.unexpected.code]: { dimension: "hue", origin: "new" },
    [M.hue.powerless.code]: { dimension: "hue", origin: "new" },
    [M.chroma.range.code]: { dimension: "chroma", origin: "v1-unchanged" },
    [M.chroma.coherence.code]: { dimension: "chroma", origin: "v1-unchanged" },
    [M.chroma.dip.code]: { dimension: "chroma", origin: "redefined", replaces: "chroma/muddy-midpoint" },
    [M.chroma.banding.code]: { dimension: "chroma", origin: "redefined", replaces: "chroma/banding" },
    [M.chroma.gamut.code]: { dimension: "chroma", origin: "new" },
    [M.rhythm.edge.code]: { dimension: "rhythm", origin: "v1-unchanged" },
    [M.rhythm.span.code]: { dimension: "rhythm", origin: "v1-unchanged" },
    [M.rhythm.gaps.code]: { dimension: "rhythm", origin: "v1-unchanged" },
  } as Record<string, V2CodeInfo>))();

// ── Public types ───────────────────────────────────────────────────────────────

export type GamutMappingMethod = "css4" | "clip";

export interface ScoreV2Options {
  /** Overrides `doc.interpolation`. Absent on both: srgb (the CSS default). */
  interpolation?: Interpolation;
  /** How out-of-sRGB samples reach the display. Default "css4" (CSS Color 4 gamut mapping). */
  gamutMapping?: GamutMappingMethod;
  /** Gradient-line length in px for the banding rule. Default 1000; 1..100000. */
  referenceLengthPx?: number;
}

/** Quantities the v2 thresholds are compared with (all on the resolved stops / samples). */
export interface V2Measurements {
  space: InterpolationSpace;
  hue: HueInterpolation;
  gamutMapping: GamutMappingMethod;
  referenceLengthPx: number;
  sampleCount: number;
  refinedSamples: number;
  lightnessReversals: number;
  perceivedReversals: number;
  /** Largest ΔE between any two displayed samples. */
  pathDeltaE: number;
  /** v1 1c, unchanged. */
  maxCloseJumpDeltaE: number;
  /** Time-weighted CV of ΔE/Δt over sample intervals (null: no motion). */
  speedCv: number | null;
  /** Smallest arc enclosing the hues of displayed samples with C > chromaticAbove. */
  visitedHueArc: number | null;
  /** Net signed hue travel per segment (degrees). */
  segmentHueTravel: number[];
  /** Sum of |segmentHueTravel|. */
  hueTravel: number;
  /** Largest angular distance (degrees) of a visible sample hue outside its segment's expected arc. */
  hueExcursion: number;
  /** Stops whose hue is powerless (treated as missing in oklch). */
  powerlessStops: number[];
  /** Stops with a defined but invisible hue (powerless < C <= achromatic). */
  noisyHueStops: number[];
  chromaRange: number;
  coherenceRatio: number | null;
  /** Largest relative chroma loss of the intended path vs linear chroma between the endpoints. */
  worstDip: number;
  /** Per segment: 8-bit levels traversed (Chebyshev path length of displayed sRGB, 0-255 units). */
  segmentLevels: number[];
  /** Widest average 8-bit band (px) at the reference length. */
  maxBandPx: number;
  /** Largest OKLAB ΔE between an intended sample and what is displayed. */
  gamutExcursion: number;
  /** Fraction of the stop span whose intended colour is outside sRGB. */
  outOfGamutFraction: number;
  edgeGap: number;
  span: number;
  gapCv: number | null;
}

export type ScoreResultV2 =
  | {
      status: "ok";
      score: number;
      dimensions: Record<IssueDimension, number>;
      issues: Issue[];
      scoringModel: "v2-experimental";
      analysis: ScoreAnalysis;
      measurements: V2Measurements;
    }
  | { status: "unscorable"; code: UnscorableCode; reason: string };

/** One sample of the rendered path. */
export interface PathSample {
  /** Position 0-1 along the gradient line. */
  t: number;
  /** Segment index (stops `seg` and `seg + 1` of the resolved stops). */
  seg: number;
  /** Local parameter 0-1 inside the segment. */
  u: number;
  /** Displayed colour (after gamut mapping), OKLAB / OKLCH. */
  L: number;
  a: number;
  b: number;
  C: number;
  h: number;
  /** Displayed gamma-encoded sRGB, 0-1. */
  rgb: [number, number, number];
  /** Intended (pre-mapping) chroma. */
  intendedC: number;
  /** ΔE between intended and displayed (0 when in gamut). */
  excursion: number;
  outOfGamut: boolean;
}

// ── Colour helpers (float, unrounded) ──────────────────────────────────────────

interface Lab {
  L: number;
  a: number;
  b: number;
}

const DEG = 180 / Math.PI;

const norm360 = (h: number): number => ((h % 360) + 360) % 360;

function chromaOf(l: Lab): number {
  return Math.sqrt(l.a * l.a + l.b * l.b);
}

function hueOf(l: Lab): number {
  return norm360(Math.atan2(l.b, l.a) * DEG);
}

function dE(p: Lab, q: Lab): number {
  const dl = p.L - q.L;
  const da = p.a - q.a;
  const db = p.b - q.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

function encode(c: number): number {
  const s = c < 0 ? -1 : 1;
  const x = Math.abs(c);
  return s * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
}

/** OKLAB → gamma-encoded sRGB 0-1, unclamped. */
function labToRgb(l: Lab): [number, number, number] {
  const lin = oklabToLinearRgb(l as OklabColor);
  return [encode(lin.r), encode(lin.g), encode(lin.b)];
}

function rgbToLab(rgb: readonly [number, number, number]): Lab {
  return rgbToOklab({ r: rgb[0] * 255, g: rgb[1] * 255, b: rgb[2] * 255 });
}

function inGamut(rgb: readonly number[]): boolean {
  const tol = M.color.gamut.channelTolerance;
  return rgb[0] >= -tol && rgb[0] <= 1 + tol && rgb[1] >= -tol && rgb[1] <= 1 + tol && rgb[2] >= -tol && rgb[2] <= 1 + tol;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function clip(rgb: readonly number[]): [number, number, number] {
  return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
}

interface Mapped {
  lab: Lab;
  rgb: [number, number, number];
  out: boolean;
}

/**
 * Bring an intended OKLAB colour onto an sRGB display. "css4" follows the
 * CSS Color 4 binary search on OKLCH chroma with a JND-bounded clip;
 * "clip" clamps each channel.
 */
function toDisplay(lab: Lab, method: GamutMappingMethod): Mapped {
  const rgb = labToRgb(lab);
  if (inGamut(rgb)) return { lab, rgb: clip(rgb), out: false };
  if (method === "clip") {
    const c = clip(rgb);
    return { lab: rgbToLab(c), rgb: c, out: true };
  }
  if (lab.L >= 1) return { lab: rgbToLab([1, 1, 1]), rgb: [1, 1, 1], out: true };
  if (lab.L <= 0) return { lab: { L: 0, a: 0, b: 0 }, rgb: [0, 0, 0], out: true };
  const { jnd, epsilon } = M.color.gamut;
  const C0 = chromaOf(lab);
  const h = Math.atan2(lab.b, lab.a);
  const at = (C: number): Lab => ({ L: lab.L, a: C * Math.cos(h), b: C * Math.sin(h) });
  let clipped = clip(rgb);
  if (dE(rgbToLab(clipped), lab) < jnd) return { lab: rgbToLab(clipped), rgb: clipped, out: true };
  let min = 0;
  let max = C0;
  let minInGamut = true;
  // At most ceil(log2(C0 / epsilon)) ≈ 13 iterations for C0 <= 0.5.
  while (max - min > epsilon) {
    const chroma = (min + max) / 2;
    const current = at(chroma);
    const cur = labToRgb(current);
    if (minInGamut && inGamut(cur)) {
      min = chroma;
      continue;
    }
    clipped = clip(cur);
    const E = dE(rgbToLab(clipped), current);
    if (E < jnd) {
      if (jnd - E < epsilon) break;
      minInGamut = false;
      min = chroma;
    } else {
      max = chroma;
    }
  }
  return { lab: rgbToLab(clipped), rgb: clipped, out: true };
}

/** CSS Color 4 hue interpolation fix-up: the two hues to interpolate linearly between. */
export function fixHues(h1: number, h2: number, method: HueInterpolation): [number, number] {
  let a = norm360(h1);
  let b = norm360(h2);
  const d = b - a;
  switch (method) {
    case "longer":
      if (d > 0 && d < 180) a += 360;
      else if (d > -180 && d <= 0) b += 360;
      break;
    case "increasing":
      if (b < a) b += 360;
      break;
    case "decreasing":
      if (a < b) a += 360;
      break;
    default:
      if (d > 180) a += 360;
      else if (d < -180) b += 360;
  }
  return [a, b];
}

// ── Stops and sampling ─────────────────────────────────────────────────────────

interface StopC {
  /** Position 0-1. */
  t: number;
  /** Position in percent, rounded like the v1 adapter (for the unchanged rules). */
  pct: number;
  rgb: [number, number, number];
  lab: Lab;
  C: number;
  h: number;
  powerless: boolean;
}

interface Segment {
  i: number;
  a: StopC;
  b: StopC;
  /** oklch only: fixed-up hues (NaN when both are missing). */
  h1: number;
  h2: number;
}

const toPercent = (p: number): number => Math.round(p * 1e12) / 1e10;

function intended(seg: Segment, u: number, space: InterpolationSpace): { lab: Lab; rgb?: [number, number, number] } {
  const { a, b } = seg;
  if (u <= 0) return { lab: a.lab, rgb: a.rgb };
  if (u >= 1) return { lab: b.lab, rgb: b.rgb };
  const v = 1 - u;
  if (space === "srgb") {
    const rgb: [number, number, number] = [v * a.rgb[0] + u * b.rgb[0], v * a.rgb[1] + u * b.rgb[1], v * a.rgb[2] + u * b.rgb[2]];
    return { lab: rgbToLab(rgb), rgb };
  }
  if (space === "oklab") {
    return { lab: { L: v * a.lab.L + u * b.lab.L, a: v * a.lab.a + u * b.lab.a, b: v * a.lab.b + u * b.lab.b } };
  }
  const L = v * a.lab.L + u * b.lab.L;
  const C = v * a.C + u * b.C;
  const h = Number.isNaN(seg.h1) ? 0 : (v * seg.h1 + u * seg.h2) * (Math.PI / 180);
  return { lab: { L, a: C * Math.cos(h), b: C * Math.sin(h) } };
}

function makeSample(seg: Segment, u: number, space: InterpolationSpace, method: GamutMappingMethod): PathSample {
  const t = u >= 1 ? seg.b.t : seg.a.t + (seg.b.t - seg.a.t) * u;
  const it = intended(seg, u, space);
  let lab: Lab;
  let rgb: [number, number, number];
  let out = false;
  let excursion = 0;
  if (it.rgb) {
    lab = it.lab;
    rgb = it.rgb;
  } else {
    const d = toDisplay(it.lab, method);
    lab = d.lab;
    rgb = d.rgb;
    out = d.out;
    if (out) excursion = dE(it.lab, lab);
  }
  return {
    t,
    seg: seg.i,
    u,
    L: lab.L,
    a: lab.a,
    b: lab.b,
    C: chromaOf(lab),
    h: hueOf(lab),
    rgb,
    intendedC: chromaOf(it.lab),
    excursion,
    outOfGamut: out,
  };
}

function turnDeg(p: PathSample, q: PathSample, r: PathSample): number {
  const x1 = q.L - p.L, y1 = q.a - p.a, z1 = q.b - p.b;
  const x2 = r.L - q.L, y2 = r.a - q.a, z2 = r.b - q.b;
  const n1 = Math.sqrt(x1 * x1 + y1 * y1 + z1 * z1);
  const n2 = Math.sqrt(x2 * x2 + y2 * y2 + z2 * z2);
  if (n1 < 1e-9 || n2 < 1e-9) return 0;
  const c = (x1 * x2 + y1 * y2 + z1 * z2) / (n1 * n2);
  return Math.acos(c > 1 ? 1 : c < -1 ? -1 : c) * DEG;
}

interface Prepared {
  stops: StopC[];
  segments: Segment[];
  space: InterpolationSpace;
  hue: HueInterpolation;
}

type PrepareResult = Prepared | { status: "unscorable"; code: UnscorableCode; reason: string };

/** Opaque `#rrggbb` (the v1 domain's colour pattern, kept local so V1_MODEL is not bundled). */
const HEX6 = /^#[0-9a-fA-F]{6}$/;
const isValidStopColor = (c: unknown): c is string => typeof c === "string" && HEX6.test(c);

const SPACES: readonly string[] = ["srgb", "oklab", "oklch"];
const HUES: readonly string[] = ["shorter", "longer", "increasing", "decreasing"];

function prepare(doc: GradientDocument, opts: ScoreV2Options | undefined): PrepareResult {
  const no = (code: UnscorableCode, reason: string) => ({ status: "unscorable" as const, code, reason });
  if (!isDocumentLike(doc)) return no("invalid-document", "not a gradient document");
  if (doc.kind !== "linear") return no("unsupported-kind", `only linear gradients are scored (kind: ${String(doc.kind)})`);
  if (doc.repeating) return no("repeating", "repeating gradients are outside the v2-experimental model");
  if (doc.stops.length < M.domain.minStops) return no("too-few-stops", `needs at least ${M.domain.minStops} stops`);
  const interp = opts?.interpolation ?? doc.interpolation ?? { space: "srgb" };
  if (typeof interp !== "object" || interp === null || !SPACES.includes(interp.space)) {
    return no("invalid-document", "interpolation space must be srgb, oklab or oklch");
  }
  const hue = interp.hue ?? "shorter";
  if (!HUES.includes(hue)) return no("invalid-document", "hue interpolation must be shorter, longer, increasing or decreasing");
  for (let i = 0; i < doc.stops.length; i++) {
    const s = doc.stops[i];
    if (!isValidStopColor(s.color)) return no("invalid-color", `stop ${i}: colour is not an opaque #rrggbb hex colour`);
    const alpha = stopAlpha(s);
    if (alpha === null) return no("invalid-alpha", `stop ${i}: alpha is not a number in 0-1`);
    if (alpha < 1) return no("alpha", `stop ${i} is translucent; the v2-experimental prototype only judges opaque stops`);
    if (s.position !== undefined && (typeof s.position !== "number" || !Number.isFinite(s.position))) {
      return no("invalid-position", `stop ${i}: position is not a finite number`);
    }
  }
  const resolved: ResolvedStop[] = resolveStops(doc);
  const stops: StopC[] = [];
  for (let i = 0; i < resolved.length; i++) {
    const p = resolved[i].position;
    if (p < 0 || p > 1) return no("position-range", `stop ${i}: position ${p} is outside 0-1`);
    const c = hexToRgb(resolved[i].color);
    const rgb: [number, number, number] = [c.r / 255, c.g / 255, c.b / 255];
    const lab = rgbToOklab(c);
    const C = chromaOf(lab);
    stops.push({ t: p, pct: toPercent(p), rgb, lab, C, h: hueOf(lab), powerless: C <= M.color.powerlessChromaAtMost });
  }
  const segments: Segment[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    let h1 = NaN;
    let h2 = NaN;
    if (interp.space === "oklch") {
      // Missing (powerless) hue takes the other colour's hue (CSS Color 4, missing components).
      if (!(a.powerless && b.powerless)) {
        const ha = a.powerless ? b.h : a.h;
        const hb = b.powerless ? a.h : b.h;
        [h1, h2] = fixHues(ha, hb, hue);
      }
    }
    segments.push({ i, a, b, h1, h2 });
  }
  return { stops, segments, space: interp.space, hue };
}

function isPrepared(p: PrepareResult): p is Prepared {
  return !("status" in p);
}

/** Sample the rendered path; returns the samples and how many refinement added. */
function sample(p: Prepared, method: GamutMappingMethod): { samples: PathSample[]; refined: number } {
  const S = M.sampling;
  const perSeg: PathSample[][] = [];
  for (const seg of p.segments) {
    const gap = seg.b.t - seg.a.t;
    if (!(gap > 0)) {
      perSeg.push([]);
      continue;
    }
    const m = Math.max(S.minIntervalsPerSegment, Math.ceil(S.intervalsPerUnit * gap));
    const list: PathSample[] = [];
    for (let k = 0; k <= m; k++) list.push(makeSample(seg, k / m, p.space, method));
    perSeg.push(list);
  }
  // Adaptive refinement: split intervals that jump (ΔE), cross the gamut
  // boundary, or sit at a sharp turn. Deterministic order, global cap.
  let budget = S.refine.maxExtraSamples;
  for (let pass = 0; pass < S.refine.maxPasses && budget > 0; pass++) {
    let added = 0;
    for (let si = 0; si < p.segments.length && budget > 0; si++) {
      const list = perSeg[si];
      if (list.length < 2) continue;
      const next: PathSample[] = [list[0]];
      for (let j = 0; j < list.length - 1; j++) {
        const x = list[j];
        const y = list[j + 1];
        const turn = Math.max(
          j > 0 ? turnDeg(list[j - 1], x, y) : 0,
          j + 2 < list.length ? turnDeg(x, y, list[j + 2]) : 0,
        );
        const split =
          budget > 0 &&
          (dE(x, y) > S.refine.deltaEAbove || x.outOfGamut !== y.outOfGamut || turn > S.refine.turnAboveDeg);
        if (split) {
          next.push(makeSample(p.segments[si], (x.u + y.u) / 2, p.space, method));
          budget--;
          added++;
        }
        next.push(y);
      }
      perSeg[si] = next;
    }
    if (added === 0) break;
  }
  const samples: PathSample[] = [];
  // The first and last stop colours are always displayed (they extend to the
  // edges), even when every segment touching them has zero width.
  const last = p.segments.length - 1;
  if (perSeg[0].length === 0) perSeg[0] = [makeSample(p.segments[0], 0, p.space, method)];
  if (perSeg[last].length === 0) perSeg[last] = [...(last === 0 ? perSeg[0] : []), makeSample(p.segments[last], 1, p.space, method)];
  for (const list of perSeg) {
    for (let k = 0; k < list.length; k++) {
      const s = list[k];
      const prev = samples[samples.length - 1];
      // A shared stop between two segments is one sample; a hard stop keeps both colours.
      if (k === 0 && prev && prev.t === s.t && prev.L === s.L && prev.a === s.a && prev.b === s.b) continue;
      samples.push(s);
    }
  }
  return { samples, refined: S.refine.maxExtraSamples - budget };
}

/**
 * The rendered path as v2-experimental samples it (displayed colours, after
 * gamut mapping), or null when the document is outside the prototype's domain.
 */
export function samplePathV2(doc: GradientDocument, opts?: ScoreV2Options): PathSample[] | null {
  try {
    const p = prepare(doc, opts);
    if (!isPrepared(p)) return null;
    return sample(p, opts?.gamutMapping === "clip" ? "clip" : "css4").samples;
  } catch {
    return null;
  }
}

// ── Rule helpers ───────────────────────────────────────────────────────────────

/** Indices (into `values`) of interior turns whose retracement is at least `prominence`. */
function turns(values: number[], prominence: number): number[] {
  const out: number[] = [];
  if (values.length < 3) return out;
  let dir = 0;
  let ext = values[0];
  let extI = 0;
  let lo = values[0];
  let hi = values[0];
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (dir === 0) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      if (v - lo >= prominence) {
        dir = 1;
        ext = v;
        extI = i;
      } else if (hi - v >= prominence) {
        dir = -1;
        ext = v;
        extI = i;
      }
    } else if (dir > 0) {
      if (v > ext) {
        ext = v;
        extI = i;
      } else if (ext - v >= prominence) {
        out.push(extI);
        dir = -1;
        ext = v;
        extI = i;
      }
    } else if (v < ext) {
      ext = v;
      extI = i;
    } else if (v - ext >= prominence) {
      out.push(extI);
      dir = 1;
      ext = v;
      extI = i;
    }
  }
  return out;
}

/** Signed hue difference in (-180, 180]. */
function wrap(d: number): number {
  const x = norm360(d);
  return x > 180 ? x - 360 : x;
}

/** Smallest arc enclosing `hues` and the two hues at its ends (sorted input copy). */
function enclosingArc(hues: number[]): { arc: number; from: number; to: number } | null {
  if (hues.length < 2) return null;
  const s = [...hues].sort((x, y) => x - y);
  let maxGap = s[0] + 360 - s[s.length - 1];
  let from = s[0];
  let to = s[s.length - 1];
  for (let k = 1; k < s.length; k++) {
    const g = s[k] - s[k - 1];
    if (g > maxGap) {
      maxGap = g;
      from = s[k];
      to = s[k - 1];
    }
  }
  return { arc: 360 - maxGap, from, to };
}

/** Angular distance (degrees) from `h` to the arc [lo, lo + span] (0 inside). */
function outsideArc(h: number, lo: number, span: number): number {
  if (span >= 360) return 0;
  const off = norm360(h - lo);
  if (off <= span) return 0;
  return Math.min(off - span, 360 - off);
}

function cv(values: number[], weights: number[]): { cv: number; mean: number } | null {
  let W = 0;
  let S = 0;
  for (let i = 0; i < values.length; i++) {
    W += weights[i];
    S += weights[i] * values[i];
  }
  if (!(W > 0)) return null;
  const mean = S / W;
  if (!(mean > 0)) return null;
  let V = 0;
  for (let i = 0; i < values.length; i++) V += weights[i] * (values[i] - mean) ** 2;
  return { cv: Math.sqrt(V / W) / mean, mean };
}

const round9 = (x: number): number => Math.round(x * 1e9) / 1e9;

/**
 * Samples are ordered by t and every interval with Δt > 0 lies inside the
 * segment of its END sample (a shared stop sample is stored once, with the
 * earlier segment). This is the start sample's parameter in that segment.
 */
function uIn(x: PathSample, y: PathSample): number {
  return x.seg === y.seg ? x.u : 0;
}

// ── Score ──────────────────────────────────────────────────────────────────────

function referenceLength(opts: ScoreV2Options | undefined): number {
  const v = opts?.referenceLengthPx;
  return typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 100000 ? v : M.chroma.banding.referenceLengthPx;
}

function hasHardStops(stops: StopC[]): boolean {
  for (let i = 1; i < stops.length; i++) {
    if (Math.abs(stops[i].t - stops[i - 1].t) <= 1e-9 && dE(stops[i].lab, stops[i - 1].lab) > 0) return true;
  }
  return false;
}

/**
 * EXPERIMENTAL. Score a linear gradient on its rendered path under the
 * v2-experimental model (spec/scoring-v2.md). Same result shape as `score`
 * plus `measurements`, with `scoringModel: "v2-experimental"`. Pure,
 * deterministic, never throws, never NaN. Not validated; not a default.
 */
export function scoreV2(doc: GradientDocument, opts?: ScoreV2Options): ScoreResultV2 {
  try {
    return scoreV2Unsafe(doc, opts);
  } catch (e) {
    return { status: "unscorable", code: "engine", reason: `v2-experimental failed: ${e instanceof Error ? e.message : "error"}` };
  }
}

function scoreV2Unsafe(doc: GradientDocument, opts: ScoreV2Options | undefined): ScoreResultV2 {
  const p = prepare(doc, opts);
  if (!isPrepared(p)) return p;
  const method: GamutMappingMethod = opts?.gamutMapping === "clip" ? "clip" : "css4";
  const refLen = referenceLength(opts);
  const { stops, segments } = p;
  const n = stops.length;
  const { samples, refined } = sample(p, method);
  const pos = stops.map((s) => s.t);

  type Where = { stops?: number[]; segment?: [number, number] };
  const issues: Issue[] = [];
  const kept: Record<V2Dimension, number> = { ...M.weights };
  const add = (code: string, tier: V2Tier, where: Where) => {
    const dim = V2_FINDING_CODES[code].dimension;
    const issue = {
      code,
      severity: tier.severity,
      dimension: dim === "rhythm" ? "spacing" : dim,
      pointsLost: tier.penalty,
    } as Issue;
    if (where.stops && where.stops.length) issue.stopIndices = [...new Set(where.stops)].sort((x, y) => x - y);
    if (where.segment) issue.segment = { start: where.segment[0], end: where.segment[1] };
    issue.message = tier.message;
    issues.push(issue);
    kept[dim] -= tier.penalty;
  };
  const segWhere = (i: number): Where => ({ stops: [i, i + 1], segment: [pos[i], pos[i + 1]] });
  const at = (list: PathSample[]): Where => {
    const st: number[] = [];
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of list) {
      if (s.u <= 0) st.push(s.seg);
      else if (s.u >= 1) st.push(s.seg + 1);
      else st.push(s.seg, s.seg + 1);
      lo = Math.min(lo, pos[s.seg]);
      hi = Math.max(hi, pos[s.seg + 1]);
    }
    return { stops: st, segment: [lo, hi] };
  };

  // ── Lightness ──────────────────────────────────────────────────────────────
  const ML = M.lightness;
  const Ls = samples.map((s) => s.L);
  const rev = turns(Ls, ML.reversal.prominence);
  if (rev.length > 0) {
    const message = ML.reversal.messageTemplate.replace("{count}", String(rev.length)).replace("{plural}", rev.length > 1 ? "s" : "");
    add(ML.reversal.code, { penalty: rev.length * ML.reversal.penaltyPerReversal, severity: ML.reversal.severity, message }, at(rev.map((i) => samples[i])));
  }
  const hk = turns(
    samples.map((s) => s.L + ML.perceivedReversal.chromaWeight * s.C),
    ML.perceivedReversal.prominence,
  );
  if (rev.length === 0 && hk.length > 0) add(ML.perceivedReversal.code, ML.perceivedReversal.tier, at(hk.map((i) => samples[i])));

  // Path diameter, O(S^2) on packed coordinates (squared distances).
  const S3 = new Float64Array(samples.length * 3);
  samples.forEach((s, i) => {
    S3[3 * i] = s.L;
    S3[3 * i + 1] = s.a;
    S3[3 * i + 2] = s.b;
  });
  let diam2 = 0;
  for (let i = 0; i < S3.length; i += 3) {
    const L = S3[i], A = S3[i + 1], B = S3[i + 2];
    for (let j = i + 3; j < S3.length; j += 3) {
      const dl = S3[j] - L, da = S3[j + 1] - A, db = S3[j + 2] - B;
      const d2 = dl * dl + da * da + db * db;
      if (d2 > diam2) diam2 = d2;
    }
  }
  const pathDeltaE = Math.sqrt(diam2);
  const whole: Where = { stops: stops.map((_, i) => i), segment: [pos[0], pos[n - 1]] };
  if (pathDeltaE < ML.contrast.invisibleBelow) add(ML.contrast.code, ML.contrast.invisible, whole);
  else if (pathDeltaE < ML.contrast.lowBelow) add(ML.contrast.code, ML.contrast.low, whole);

  // Unchanged v1 1c (percent positions, as the v1 adapter computes them).
  let maxCloseJumpDeltaE = 0;
  let abruptAt = -1;
  for (let i = 0; i < n - 1; i++) {
    const gap = stops[i + 1].pct - stops[i].pct;
    if (gap > 0 && gap <= ML.abruptJump.maxGap) {
      const d = dE(stops[i].lab, stops[i + 1].lab);
      maxCloseJumpDeltaE = Math.max(maxCloseJumpDeltaE, d);
      if (abruptAt < 0 && d > ML.abruptJump.deltaEAbove) abruptAt = i;
    }
  }
  if (abruptAt >= 0) add(ML.abruptJump.code, ML.abruptJump.tier, segWhere(abruptAt));

  // Speed: arc length per fixed window / window width, time-weighted CV.
  const segDist: number[] = new Array(n - 1).fill(0);
  const windows: { seg: number; k: number; m: number; len: number }[][] = segments.map((seg) => {
    const gap = seg.b.t - seg.a.t;
    if (!(gap > 0)) return [];
    const m = Math.max(1, Math.round(ML.speed.windowsPerUnit * gap));
    return Array.from({ length: m }, (_, k) => ({ seg: seg.i, k, m, len: 0 }));
  });
  for (let k = 0; k < samples.length - 1; k++) {
    const x = samples[k];
    const y = samples[k + 1];
    if (!(y.t > x.t)) continue;
    const d = dE(x, y);
    segDist[y.seg] += d;
    const w = windows[y.seg];
    const idx = Math.min(w.length - 1, Math.floor(((uIn(x, y) + y.u) / 2) * w.length));
    w[idx].len += d;
  }
  const speeds: number[] = [];
  const dts: number[] = [];
  for (const w of windows) {
    for (const win of w) {
      const dt = (pos[win.seg + 1] - pos[win.seg]) / win.m;
      speeds.push(win.len / dt);
      dts.push(dt);
    }
  }
  const sp = cv(speeds, dts);
  let speedCv: number | null = null;
  if (sp) {
    speedCv = round9(sp.cv);
    let worst = -1;
    let worstDev = -1;
    for (let i = 0; i < n - 1; i++) {
      const gap = pos[i + 1] - pos[i];
      if (!(gap > 0)) continue;
      const dev = Math.abs(segDist[i] / gap - sp.mean);
      if (dev > worstDev + 1e-12) {
        worstDev = dev;
        worst = i;
      }
    }
    const where = worst >= 0 ? segWhere(worst) : whole;
    if (speedCv > ML.speed.strongAbove) add(ML.speed.code, ML.speed.strong, where);
    else if (speedCv > ML.speed.mildAbove) add(ML.speed.code, ML.speed.mild, where);
  }

  // ── Hue ────────────────────────────────────────────────────────────────────
  const MH = M.hue;
  const chromaticStops = stops.filter((s) => s.C > MH.chromaticAbove).length;
  const visible = samples.filter((s) => s.C > MH.chromaticAbove);
  let visitedHueArc: number | null = null;
  if (chromaticStops >= MH.minChromaticStops) {
    const arc = enclosingArc(visible.map((s) => s.h));
    if (arc) {
      visitedHueArc = round9(arc.arc);
      const ends = visible.filter((s) => s.h === arc.from || s.h === arc.to);
      const where = at([ends[0], ends[ends.length - 1]]);
      if (visitedHueArc > MH.arc.clashAbove) add(MH.arc.wideCode, MH.arc.clash, where);
      else if (visitedHueArc > MH.arc.wideAbove) add(MH.arc.wideCode, MH.arc.wide, where);
      else if (visitedHueArc < MH.arc.narrowBelow) add(MH.arc.narrowCode, MH.arc.narrow, where);
    }
  }

  // Hue travel per segment, only between two chromatic stops: next to a grey
  // stop the sample hue drifts with chroma, not with the hue path.
  const segmentHueTravel: number[] = new Array(n - 1).fill(0);
  for (let k = 0; k < samples.length - 1; k++) {
    const x = samples[k];
    const y = samples[k + 1];
    const sg = segments[y.seg];
    if (sg.a.C <= MH.chromaticAbove || sg.b.C <= MH.chromaticAbove) continue;
    if (!(y.t > x.t) || x.C <= MH.chromaticAbove || y.C <= MH.chromaticAbove) continue;
    segmentHueTravel[y.seg] += wrap(y.h - x.h);
  }
  for (let i = 0; i < segmentHueTravel.length; i++) segmentHueTravel[i] = round9(segmentHueTravel[i]);
  const hueTravel = round9(segmentHueTravel.reduce((acc, v) => acc + Math.abs(v), 0));
  {
    let pos1 = 0;
    let neg1 = 0;
    let last = 0;
    const turnStops: number[] = [];
    for (let i = 0; i < segmentHueTravel.length; i++) {
      const d = segmentHueTravel[i];
      const sign = d > MH.direction.minStep ? 1 : d < -MH.direction.minStep ? -1 : 0;
      if (sign > 0) pos1++;
      else if (sign < 0) neg1++;
      if (sign !== 0) {
        if (last !== 0 && sign !== last) turnStops.push(i);
        last = sign;
      }
    }
    if (pos1 > 0 && neg1 > 0) add(MH.direction.code, MH.direction.tier, { stops: turnStops });
  }

  // Unexpected hue: visible sample hues outside their segment's expected arc.
  const ach = M.color.achromaticAtMost;
  let hueExcursion = 0;
  let hueExcursionAt: PathSample | null = null;
  const expected: ({ lo: number; span: number } | null)[] = segments.map((seg) => {
    const ca = seg.a.C > ach;
    const cb = seg.b.C > ach;
    if (!ca && !cb) return null;
    if (ca !== cb) return { lo: ca ? seg.a.h : seg.b.h, span: 0 };
    if (p.space === "oklch") {
      const [h1, h2] = fixHues(seg.a.h, seg.b.h, p.hue);
      return { lo: norm360(Math.min(h1, h2)), span: Math.abs(h2 - h1) };
    }
    const d = wrap(seg.b.h - seg.a.h);
    return { lo: norm360(d >= 0 ? seg.a.h : seg.b.h), span: Math.abs(d) };
  });
  for (const s of samples) {
    if (s.C <= M.color.visibleHueChromaAbove) continue;
    const e = expected[s.seg];
    if (!e) continue;
    const d = outsideArc(s.h, e.lo, e.span);
    if (d > hueExcursion) {
      hueExcursion = d;
      hueExcursionAt = s;
    }
  }
  hueExcursion = round9(hueExcursion);
  if (hueExcursionAt) {
    const where = segWhere(hueExcursionAt.seg);
    if (hueExcursion > MH.unexpected.strongAbove) add(MH.unexpected.code, MH.unexpected.strong, where);
    else if (hueExcursion > MH.unexpected.mildAbove) add(MH.unexpected.code, MH.unexpected.mild, where);
  }

  const powerlessStops: number[] = [];
  const noisyHueStops: number[] = [];
  stops.forEach((s, i) => {
    if (s.powerless) powerlessStops.push(i);
    else if (s.C <= ach) noisyHueStops.push(i);
  });
  if (p.space === "oklch") {
    const flagged: number[] = [];
    for (const i of noisyHueStops) {
      for (const j of [i - 1, i + 1]) {
        const nb = stops[j];
        if (nb && nb.C > ach && Math.abs(wrap(nb.h - stops[i].h)) > MH.powerless.hueGapAbove) flagged.push(i);
      }
    }
    if (flagged.length > 0) add(MH.powerless.code, MH.powerless.tier, { stops: flagged });
  }

  // ── Chroma ─────────────────────────────────────────────────────────────────
  const MC = M.chroma;
  const chromas = stops.map((s) => s.C);
  const maxC = Math.max(...chromas);
  const minC = Math.min(...chromas);
  const chromaRange = maxC - minC;
  const rangeWhere: Where = { stops: [chromas.indexOf(maxC), chromas.indexOf(minC)] };
  if (chromaRange > MC.range.spikeAbove) add(MC.range.code, MC.range.spike, rangeWhere);
  else if (chromaRange > MC.range.unevenAbove) add(MC.range.code, MC.range.uneven, rangeWhere);

  let coherenceRatio: number | null = null;
  if (n >= MC.coherence.minStops) {
    const achromatic = stops.map((_, i) => i).filter((i) => chromas[i] < MC.coherence.achromaticBelow);
    const vivid = stops.map((_, i) => i).filter((i) => chromas[i] >= MC.coherence.vividAtLeast);
    if (achromatic.length > 0 && vivid.length > 0) {
      const ratio = Math.min(...achromatic.map((i) => chromas[i])) / Math.max(...vivid.map((i) => chromas[i]));
      coherenceRatio = ratio;
      if (ratio < MC.coherence.deadZoneBelow) add(MC.coherence.code, MC.coherence.deadZone, { stops: achromatic });
      else if (ratio < MC.coherence.gapBelow) add(MC.coherence.code, MC.coherence.gap, { stops: achromatic });
    }
  }

  // Chroma dip of the INTENDED path (interpolation geometry, not gamut loss).
  let worstDip = 0;
  let worstDipSeg = -1;
  for (const s of samples) {
    const seg = segments[s.seg];
    const expectedC = (1 - s.u) * seg.a.C + s.u * seg.b.C;
    if (!(expectedC > MC.dip.endpointChromaAbove)) continue;
    const dip = 1 - s.intendedC / expectedC;
    if (dip > worstDip + 1e-12) {
      worstDip = dip;
      worstDipSeg = s.seg;
    }
  }
  worstDip = round9(worstDip);
  if (worstDipSeg >= 0) {
    if (worstDip > MC.dip.muddyAbove) add(MC.dip.code, MC.dip.muddy, segWhere(worstDipSeg));
    else if (worstDip > MC.dip.slightAbove) add(MC.dip.code, MC.dip.slight, segWhere(worstDipSeg));
  }

  // Banding: 8-bit levels traversed per segment and the average band width.
  const segmentLevels: number[] = new Array(n - 1).fill(0);
  for (let k = 0; k < samples.length - 1; k++) {
    const x = samples[k];
    const y = samples[k + 1];
    if (!(y.t > x.t)) continue;
    segmentLevels[y.seg] += 255 * Math.max(Math.abs(y.rgb[0] - x.rgb[0]), Math.abs(y.rgb[1] - x.rgb[1]), Math.abs(y.rgb[2] - x.rgb[2]));
  }
  let maxBandPx = 0;
  let bandAt = -1;
  for (let i = 0; i < n - 1; i++) {
    segmentLevels[i] = round9(segmentLevels[i]);
    const gap = pos[i + 1] - pos[i];
    if (!(gap > 0)) continue;
    const band = round9((refLen * gap) / Math.max(segmentLevels[i], 1));
    if (band > maxBandPx) {
      maxBandPx = band;
      bandAt = i;
    }
  }
  if (bandAt >= 0) {
    if (maxBandPx > MC.banding.strongBandPxAbove) add(MC.banding.code, MC.banding.strong, segWhere(bandAt));
    else if (maxBandPx > MC.banding.subtleBandPxAbove) add(MC.banding.code, MC.banding.subtle, segWhere(bandAt));
  }

  // Gamut excursion.
  let gamutExcursion = 0;
  let gamutAt: PathSample | null = null;
  let outT = 0;
  for (let k = 0; k < samples.length; k++) {
    const s = samples[k];
    if (s.excursion > gamutExcursion) {
      gamutExcursion = s.excursion;
      gamutAt = s;
    }
    const nx = samples[k + 1];
    if (nx && nx.t > s.t) outT += ((s.outOfGamut ? 1 : 0) + (nx.outOfGamut ? 1 : 0)) / 2 * (nx.t - s.t);
  }
  gamutExcursion = round9(gamutExcursion);
  const spanT = pos[n - 1] - pos[0];
  const outOfGamutFraction = spanT > 0 ? round9(outT / spanT) : 0;
  if (gamutAt) {
    if (gamutExcursion > MC.gamut.strongAbove) add(MC.gamut.code, MC.gamut.strong, segWhere(gamutAt.seg));
    else if (gamutExcursion > MC.gamut.mildAbove) add(MC.gamut.code, MC.gamut.mild, segWhere(gamutAt.seg));
  }

  // ── Rhythm (unchanged v1 rules, percent positions) ───────────────────────
  const MR = M.rhythm;
  const P = stops.map((s) => s.pct);
  const first = P[0];
  const lastP = P[n - 1];
  const ends: Where = { stops: [0, n - 1] };
  const edgeGap = first + (100 - lastP);
  if (edgeGap > MR.edge.bunchedAbove) add(MR.edge.code, MR.edge.bunched, ends);
  else if (edgeGap > MR.edge.shortAbove) add(MR.edge.code, MR.edge.short, ends);
  else if (edgeGap > MR.edge.slightAbove) add(MR.edge.code, MR.edge.slight, ends);
  const span = lastP - first;
  const spanWhere: Where = { stops: [0, n - 1], segment: [pos[0], pos[n - 1]] };
  if (span < MR.span.squeezedBelow) add(MR.span.code, MR.span.squeezed, spanWhere);
  else if (span < MR.span.narrowBelow) add(MR.span.code, MR.span.narrow, spanWhere);
  let gapCv: number | null = null;
  if (n >= MR.gaps.minStops) {
    const gaps: number[] = [];
    for (let i = 0; i < n - 1; i++) gaps.push(P[i + 1] - P[i]);
    const avg = gaps.reduce((x, y) => x + y, 0) / gaps.length;
    if (avg > 0) {
      const c = Math.sqrt(gaps.reduce((x, g) => x + (g - avg) ** 2, 0) / gaps.length) / avg;
      gapCv = c;
      let worst = 0;
      for (let i = 1; i < gaps.length; i++) if (Math.abs(gaps[i] - avg) > Math.abs(gaps[worst] - avg)) worst = i;
      if (c > MR.gaps.clusteredAbove) add(MR.gaps.code, MR.gaps.clustered, segWhere(worst));
      else if (c > MR.gaps.unevenAbove) add(MR.gaps.code, MR.gaps.uneven, segWhere(worst));
    }
  }

  const dims: Record<IssueDimension, number> = {
    lightness: Math.max(0, kept.lightness),
    chroma: Math.max(0, kept.chroma),
    hue: Math.max(0, kept.hue),
    spacing: Math.max(0, kept.rhythm),
  };
  return {
    status: "ok",
    score: dims.lightness + dims.chroma + dims.hue + dims.spacing,
    dimensions: dims,
    issues,
    scoringModel: "v2-experimental",
    analysis: { hasHardStops: hasHardStops(stops) },
    measurements: {
      space: p.space,
      hue: p.hue,
      gamutMapping: method,
      referenceLengthPx: refLen,
      sampleCount: samples.length,
      refinedSamples: refined,
      lightnessReversals: rev.length,
      perceivedReversals: hk.length,
      pathDeltaE: round9(pathDeltaE),
      maxCloseJumpDeltaE,
      speedCv,
      visitedHueArc,
      segmentHueTravel,
      hueTravel,
      hueExcursion,
      powerlessStops,
      noisyHueStops,
      chromaRange,
      coherenceRatio,
      worstDip,
      segmentLevels,
      maxBandPx,
      gamutExcursion,
      outOfGamutFraction,
      edgeGap,
      span,
      gapCv,
    },
  };
}
