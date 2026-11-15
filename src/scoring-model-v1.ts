// ── Scoring model v1 ───────────────────────────────────────────────────────────
// Every threshold, weight, penalty, severity and message that `scoreGradient`
// and `suggestGradient` use lives in this one frozen table. The engine reads
// from it and contains no scoring constant of its own, so this file plus
// spec/scoring-v1.md is the complete definition of the v1 model.
//
// Changing ANY value here changes the v1 contract: the characterisation vectors
// in spec/vectors/ will fail. v1 is frozen; improvements land in a v2 model.
//
// ── v1 input domain ────────────────────────────────────────────────────────────
// A gradient is scorable under v1 when it has at least `domain.minStops` (2)
// stops and every stop has
//   - an opaque `#rrggbb` colour (6 hex digits, either case; no alpha, no
//     shorthand, no names or functional notation), and
//   - a finite numeric position in 0..100 (percent along the gradient line).
// Anything else is `unscorable`: `scoreGradient` returns status "unscorable"
// with a reason and score 0, `suggestGradient` returns its input unchanged.
//
// ── Known v1 inconsistency (kept on purpose) ───────────────────────────────────
// "Achromatic" has two definitions in v1:
//   - hue rules (hue.chromaticAbove) and refine treat a stop as chromatic when
//     OKLCH C > 0.02, so its hue takes part in hue arcs / direction;
//   - the chroma-coherence rule (chroma.coherence) calls a stop achromatic when
//     C < 0.04 and vivid when C >= 0.08, ignoring 0.04 <= C < 0.08.
// A stop with 0.02 < C < 0.04 is therefore "chromatic" for hue but
// "achromatic" for coherence. This is v1 behaviour, frozen by the vectors; a
// future model may unify it.

export type Severity = "info" | "warning" | "error";
export type Dimension = "lightness" | "hue" | "chroma" | "rhythm";

/** One penalty level of a rule: the points it costs and the message it emits. */
export interface Tier {
  readonly penalty: number;
  readonly severity: Severity;
  readonly message: string;
}

export type DeepReadonly<T> = T extends (infer U)[]
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

/**
 * The v1 scoring and refinement model.
 *
 * Comparison direction is part of each name: `…Above` means "fires when the
 * measurement is strictly greater", `…Below` strictly less, `…AtMost` <=,
 * `…AtLeast` >=. Severity convention: penalty >= 12 → error, 6-10 → warning,
 * <= 5 → info (the four previously silent penalties are all info).
 */
export const V1_MODEL = deepFreeze({
  version: "v1",

  domain: {
    minStops: 2,
    /** Opaque #rrggbb, case-insensitive. */
    colorPattern: "^#[0-9a-fA-F]{6}$",
    minPosition: 0,
    maxPosition: 100,
  },

  /** Points available per dimension; they sum to 100. `rhythm` is ScoreDetails.spacing. */
  weights: { lightness: 30, hue: 30, chroma: 20, rhythm: 20 },

  lightness: {
    /** 1a. Interior local extrema of OKLAB L along position order. */
    reversal: {
      code: "lightness/reversal",
      penaltyPerReversal: 12,
      severity: "error" as Severity,
      /** `{count}` = number of reversals, `{plural}` = "s" when count > 1. */
      messageTemplate: "Lightness fluctuates ({count} reversal{plural}) — creates visual noise",
    },
    /** 1a'. Same test on Helmholtz–Kohlrausch apparent lightness L + k·C; only when 1a found none. */
    perceivedReversal: {
      code: "lightness/perceived-reversal",
      chromaWeight: 0.25,
      tier: {
        penalty: 6,
        severity: "warning",
        message: "Saturated stops create perceived brightness reversals (Helmholtz–Kohlrausch effect)",
      } as Tier,
    },
    /** 1b. Largest OKLAB ΔE between any two stops. */
    contrast: {
      code: "lightness/low-contrast",
      invisibleBelow: 0.02,
      invisible: {
        penalty: 15,
        severity: "error",
        message: "Stops are nearly identical — gradient is invisible",
      } as Tier,
      lowBelow: 0.05,
      low: {
        penalty: 8,
        severity: "warning",
        message: "Very low contrast between stops — gradient barely visible",
      } as Tier,
    },
    /** 1c. A big ΔE between position-neighbours squeezed into a small gap (first hit only). */
    abruptJump: {
      code: "lightness/abrupt-jump",
      /** The gap must be > 0 and <= maxGap (percent). */
      maxGap: 10,
      deltaEAbove: 0.15,
      tier: {
        penalty: 8,
        severity: "warning",
        message: "Abrupt color jump between closely-spaced stops",
      } as Tier,
    },
    /** 1d. Coefficient of variation of ΔE-per-percent over segments with gap > 0. */
    velocity: {
      code: "lightness/uneven-speed",
      minStops: 3,
      minSegments: 2,
      strongAbove: 0.8,
      strong: {
        penalty: 8,
        severity: "warning",
        message: "Uneven perceptual speed — some transitions race while others crawl",
      } as Tier,
      mildAbove: 0.5,
      mild: {
        penalty: 4,
        severity: "info",
        message: "Slightly uneven transition speed across the gradient",
      } as Tier,
    },
  },

  hue: {
    /** Stops with OKLCH C above this take part in the hue rules. */
    chromaticAbove: 0.02,
    /** 2a. Minimum arc of the hue circle enclosing all chromatic hues (>= 2 chromatic stops). */
    arc: {
      wideCode: "hue/wide-arc",
      clashAbove: 180,
      clash: {
        penalty: 20,
        severity: "error",
        message: "Hue arc spans >180° — colors clash unexpectedly",
      } as Tier,
      wideAbove: 120,
      wide: {
        penalty: 8,
        severity: "warning",
        message: "Wide hue arc (>120°) risks muddy midpoints",
      } as Tier,
      narrowCode: "hue/narrow-arc",
      narrowBelow: 15,
      narrow: {
        penalty: 5,
        severity: "info",
        message: "Very narrow hue arc (<15°) — the gradient reads as a single hue",
      } as Tier,
    },
    /** 2b. Signed shortest-arc hue steps between chromatic position-neighbours. */
    direction: {
      code: "hue/direction-reversal",
      minChromaticStops: 3,
      /** Steps with |Δh| <= this many degrees are ignored. */
      minStep: 5,
      tier: {
        penalty: 10,
        severity: "warning",
        message: "Hue path reverses direction — risk of muddy in-between tones",
      } as Tier,
    },
  },

  chroma: {
    /** 3a. max(C) - min(C) over all stops. */
    range: {
      code: "chroma/saturation-range",
      spikeAbove: 0.2,
      spike: {
        penalty: 12,
        severity: "error",
        message: "Saturation spikes dramatically — looks unintentional",
      } as Tier,
      unevenAbove: 0.12,
      uneven: {
        penalty: 5,
        severity: "info",
        message: "Uneven saturation across stops",
      } as Tier,
    },
    /** 3b. min achromatic C / max vivid C, for >= 3 stops with both kinds present. */
    coherence: {
      code: "chroma/dead-zone",
      minStops: 3,
      achromaticBelow: 0.04,
      vividAtLeast: 0.08,
      deadZoneBelow: 0.15,
      deadZone: {
        penalty: 8,
        severity: "warning",
        message: "Grey/desaturated stop among vivid colors — creates a dead zone",
      } as Tier,
      gapBelow: 0.3,
      gap: {
        penalty: 4,
        severity: "info",
        message: "Noticeable saturation gap between some stops",
      } as Tier,
    },
    /** 3c. Chroma loss at the 8-bit sRGB midpoint of each segment, relative to the endpoints' mean C. */
    midpoint: {
      code: "chroma/muddy-midpoint",
      /** Segments whose endpoints' mean C is at or below this are skipped. */
      endpointChromaAbove: 0.04,
      muddyAbove: 0.5,
      muddy: {
        penalty: 10,
        severity: "warning",
        message: "Colors produce a muddy/grey midpoint when blended",
      } as Tier,
      slightAbove: 0.3,
      slight: {
        penalty: 5,
        severity: "info",
        message: "Slight desaturation in gradient midpoints",
      } as Tier,
    },
    /** 3d. Few 8-bit levels (max |Δchannel|) stretched over a long span (first hit only). */
    banding: {
      code: "chroma/banding",
      strongStepsBelow: 16,
      strongSpanAbove: 25,
      strong: {
        penalty: 6,
        severity: "warning",
        message: "Low color resolution between stops — visible banding likely",
      } as Tier,
      subtleStepsBelow: 8,
      subtleSpanAbove: 10,
      subtle: {
        penalty: 4,
        severity: "info",
        message: "Subtle transition may produce banding artifacts on screen",
      } as Tier,
    },
  },

  rhythm: {
    /** 4a. Uncovered percent at both ends: first + (100 - last). */
    edge: {
      code: "rhythm/edge-gap",
      bunchedAbove: 40,
      bunched: {
        penalty: 12,
        severity: "error",
        message: "Stops are bunched in the middle — large solid-color edges",
      } as Tier,
      shortAbove: 20,
      short: {
        penalty: 6,
        severity: "warning",
        message: "Stops don't reach the edges — visible solid-color zones",
      } as Tier,
      slightAbove: 10,
      slight: {
        penalty: 3,
        severity: "info",
        message: "Stops fall slightly short of the edges — small solid-color zones",
      } as Tier,
    },
    /** 4b. last - first position. */
    span: {
      code: "rhythm/narrow-span",
      squeezedBelow: 20,
      squeezed: {
        penalty: 8,
        severity: "warning",
        message: "Transition squeezed into a narrow band",
      } as Tier,
      narrowBelow: 40,
      narrow: {
        penalty: 4,
        severity: "info",
        message: "Transition covers less than 40% of the gradient",
      } as Tier,
    },
    /** 4c. Coefficient of variation of the gaps between sorted positions (>= 3 stops). */
    gaps: {
      code: "rhythm/uneven-gaps",
      minStops: 3,
      clusteredAbove: 0.5,
      clustered: {
        penalty: 10,
        severity: "warning",
        message: "Stop positions are unevenly clustered",
      } as Tier,
      unevenAbove: 0.25,
      uneven: {
        penalty: 4,
        severity: "info",
        message: "Stop spacing is slightly uneven",
      } as Tier,
    },
  },

  /** suggestGradient ("refine"). */
  refine: {
    /** Step 1: L' = keep·L + (1 - keep)·linear ramp between the end stops' L. */
    lightnessKeep: 0.3,
    /** Step 2: compress the chromatic hue arc to at most this many degrees. */
    maxHueArc: 80,
    /** Stops with C at or below this are achromatic: their hue is undefined and their chroma is kept. */
    achromaticAtMost: 0.02,
    /**
     * When the mean resultant length of the chromatic hues is below this, the
     * circular mean is ill-conditioned (opposed hues) and the centre falls back
     * to the midpoint of the shorter arc from the first to the last chromatic
     * stop by position (exactly 180°: towards increasing hue).
     */
    degenerateResultantBelow: 0.05,
    /** Step 3: C = min(maxChroma, mean chromatic C · (1 + envelope·sin(πt))). */
    chromaEnvelope: 0.3,
    maxChroma: 0.4,
    /** Position-neighbours at most this far apart (percent) form a hard stop and move together. */
    hardStopGap: 1,
  },
});

export type ScoringModel = typeof V1_MODEL;

// ── Measurements and the boundary table ───────────────────────────────────────

/**
 * The quantities v1 compares against its thresholds, as computed by
 * `scoreGradient` on the position-sorted stops. Arrays are per stop (sorted
 * order) or per segment (sorted neighbour pairs). `null` = rule not applicable.
 */
export interface ScoreMeasurements {
  /** 1a: number of interior OKLAB-L extrema. */
  lightnessReversals: number;
  /** 1a': number of interior extrema of L + 0.25·C. */
  perceivedReversals: number;
  /** 1b: largest ΔE between any two stops. */
  maxDeltaE: number;
  /** 1c: largest ΔE between position-neighbours whose gap is in (0, maxGap]; 0 if none. */
  maxCloseJumpDeltaE: number;
  /** 1d: CV of ΔE/gap over segments with gap > 0. */
  velocityCv: number | null;
  /** Per stop: OKLCH C. Compared with every chroma classification threshold. */
  stopChroma: number[];
  /** 2a: minimum enclosing arc of chromatic hues (degrees). */
  enclosingArc: number | null;
  /** 2b: signed shortest-arc steps between chromatic position-neighbours (degrees). */
  hueSteps: number[];
  /** 3a: max C - min C. */
  chromaRange: number;
  /** 3b: min achromatic C / max vivid C. */
  coherenceRatio: number | null;
  /** 3c: per segment, mean of the endpoints' C (8-bit sRGB endpoints). */
  segmentEndpointChroma: number[];
  /** 3c: largest relative chroma dip at an sRGB midpoint (0 if none applicable). */
  worstDip: number;
  /** 3d: per segment, max |Δchannel| in 8-bit sRGB. Integer-valued. */
  segmentRgbSteps: number[];
  /** Per segment: position gap (percent). */
  segmentGaps: number[];
  /** 4a: first + (100 - last). */
  edgeGap: number;
  /** 4b: last - first. */
  span: number;
  /** 4c: CV of the position gaps. */
  gapCv: number | null;
}

export interface BoundaryEntry {
  measurement: keyof ScoreMeasurements;
  thresholds: readonly number[];
  /** Compare |value| instead of value (signed hue steps). */
  absolute?: boolean;
}

const M = V1_MODEL;

/**
 * Which thresholds each measurement is compared against. Counts and
 * `segmentRgbSteps` are integer-valued and computed exactly, so they cannot be
 * precision-sensitive and are not listed.
 */
export const V1_BOUNDARY_TABLE: readonly BoundaryEntry[] = deepFreeze<BoundaryEntry[]>([
  { measurement: "maxDeltaE", thresholds: [M.lightness.contrast.invisibleBelow, M.lightness.contrast.lowBelow] },
  { measurement: "maxCloseJumpDeltaE", thresholds: [M.lightness.abruptJump.deltaEAbove] },
  { measurement: "velocityCv", thresholds: [M.lightness.velocity.mildAbove, M.lightness.velocity.strongAbove] },
  {
    measurement: "stopChroma",
    thresholds: [M.hue.chromaticAbove, M.chroma.coherence.achromaticBelow, M.chroma.coherence.vividAtLeast],
  },
  {
    measurement: "enclosingArc",
    thresholds: [M.hue.arc.narrowBelow, M.hue.arc.wideAbove, M.hue.arc.clashAbove],
  },
  { measurement: "hueSteps", thresholds: [M.hue.direction.minStep], absolute: true },
  { measurement: "chromaRange", thresholds: [M.chroma.range.unevenAbove, M.chroma.range.spikeAbove] },
  {
    measurement: "coherenceRatio",
    thresholds: [M.chroma.coherence.deadZoneBelow, M.chroma.coherence.gapBelow],
  },
  { measurement: "segmentEndpointChroma", thresholds: [M.chroma.midpoint.endpointChromaAbove] },
  { measurement: "worstDip", thresholds: [M.chroma.midpoint.slightAbove, M.chroma.midpoint.muddyAbove] },
  {
    measurement: "segmentGaps",
    thresholds: [M.lightness.abruptJump.maxGap, M.chroma.banding.subtleSpanAbove, M.chroma.banding.strongSpanAbove],
  },
  {
    measurement: "edgeGap",
    thresholds: [M.rhythm.edge.slightAbove, M.rhythm.edge.shortAbove, M.rhythm.edge.bunchedAbove],
  },
  { measurement: "span", thresholds: [M.rhythm.span.squeezedBelow, M.rhythm.span.narrowBelow] },
  { measurement: "gapCv", thresholds: [M.rhythm.gaps.unevenAbove, M.rhythm.gaps.clusteredAbove] },
]);

/** Default boundary tolerance: relative to the threshold, absolute below 1. */
export const BOUNDARY_EPSILON = 1e-6;

/**
 * Measurements lying within `eps · max(1, |threshold|)` of one of their
 * thresholds, as "measurement@threshold" strings (deduplicated, table order).
 * A case with any hit is a boundary case: ports must match its intermediate
 * measurements (with tolerance) but not necessarily its integer score.
 * Pass `only` to restrict the check to a subset of measurements.
 */
export function boundaryHits(
  m: Partial<Record<keyof ScoreMeasurements, number | number[] | null>>,
  eps = BOUNDARY_EPSILON,
  only?: readonly (keyof ScoreMeasurements)[],
): string[] {
  const hits: string[] = [];
  for (const entry of V1_BOUNDARY_TABLE) {
    if (only && !only.includes(entry.measurement)) continue;
    const raw = m[entry.measurement];
    if (raw === null || raw === undefined) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const t of entry.thresholds) {
      const tol = eps * Math.max(1, Math.abs(t));
      if (values.some((v) => Math.abs((entry.absolute ? Math.abs(v) : v) - t) < tol)) {
        hits.push(`${entry.measurement}@${t}`);
      }
    }
  }
  return hits;
}

// ── Finding codes ─────────────────────────────────────────────────────────────

/** Every finding code v1 can emit, with its dimension. spec/scoring-v1.md has one section per code. */
export const V1_FINDING_CODES = deepFreeze({
  [M.lightness.reversal.code]: "lightness",
  [M.lightness.perceivedReversal.code]: "lightness",
  [M.lightness.contrast.code]: "lightness",
  [M.lightness.abruptJump.code]: "lightness",
  [M.lightness.velocity.code]: "lightness",
  [M.hue.arc.wideCode]: "hue",
  [M.hue.arc.narrowCode]: "hue",
  [M.hue.direction.code]: "hue",
  [M.chroma.range.code]: "chroma",
  [M.chroma.coherence.code]: "chroma",
  [M.chroma.midpoint.code]: "chroma",
  [M.chroma.banding.code]: "chroma",
  [M.rhythm.edge.code]: "rhythm",
  [M.rhythm.span.code]: "rhythm",
  [M.rhythm.gaps.code]: "rhythm",
} as Record<string, Dimension>);
