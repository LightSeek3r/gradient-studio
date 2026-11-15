// ── Characterisation-vector library ────────────────────────────────────────────
// Shared by `gen-vectors.ts` (writes spec/vectors/*.json from the CURRENT engine)
// and `tests/characterisation.test.ts` (replays them with exact equality).
//
// Everything here is a thin, deterministic wrapper around the public engine and
// colour-format API, plus a small PRNG and a `measure()` helper that recomputes
// the intermediate quantities `scoreGradient` thresholds on (PLAN §3.3), so a
// port can be checked against them with a tolerance and so that cases sitting on
// a threshold can be flagged `boundary: true`.

import {
  buildGradientCSS,
  buildMultiGradientStyle,
  colorAtPosition,
  hexToOklch,
  hexToRgb,
  interpolateGradient,
  linearToSrgb,
  oklabToLch,
  oklabToLinearRgb,
  oklabToRgb,
  oklchToHex,
  rgbToHex,
  rgbToOklab,
  scoreGradient,
  spreadDirectionAngles,
  srgbToLinear,
  suggestGradient,
  lchToOklab,
  refineGradient,
  type Finding,
  type GradientBlendMode,
  type GradientDirection,
  type GradientTick,
  type LchColor,
  type ScoreMeasurements,
} from "../src/gradient-engine";
import { boundaryHits, V1_MODEL } from "../src/scoring-model-v1";
import {
  complementHex,
  formatHex,
  formatHsl,
  formatName,
  formatNameDisplay,
  formatRgb,
  gamutFitOklch,
  hexToHsl,
  hexToHslPrecise,
  hslToHex,
  hslToRgb,
  nearestColorName,
  oklchToHexFitted,
  parseAnyColor,
  parseHex,
  parseHsl,
  parseName,
  parseRgb,
} from "../src/color-formats";

// ── Deterministic PRNG (mulberry32) ───────────────────────────────────────────

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Case shapes ───────────────────────────────────────────────────────────────

export interface Stop {
  id: number;
  color: string;
  position: number;
}

/**
 * Tags a case whose input lies in the region of a v1 defect that was fixed
 * before the freeze (see spec/vectors/CHANGES-v1.md):
 *   D1 invalid input / unscorable, D2 interpolate bracket (stops not spanning
 *   0-100 or several stops at the last position), D4 a formerly silent
 *   penalty fires, D5 refine guarantees (achromatic stop, hard stop, or refine
 *   declined).
 * D6 (array-order dependence) and D7 (opposed-hue mean) are deliberately not
 * tagged, so that no vector changes only because of an annotation; their
 * regions are the predicates `isUnsorted` / `hasDegenerateHueMean` below.
 */
export type DefectTag = "D1" | "D2" | "D4" | "D5";

export interface Measurements {
  maxDeltaE: number;
  /** Largest ΔE between position-neighbours whose gap is in (0, 10]; 0 if none. */
  maxCloseJumpDeltaE: number;
  velocityCv: number | null;
  enclosingArc: number | null;
  chromaRange: number;
  worstDip: number;
  edgeGap: number;
  span: number;
  gapCv: number | null;
}

export interface ScoreCase {
  name: string;
  stops: Stop[];
  score: number;
  details: { lightness: number; hue: number; chroma: number; spacing: number };
  issues: string[];
  /** Independent recomputation (`measure`); null when unscorable. */
  measurements: Measurements | null;
  boundary: boolean;
  defects: DefectTag[];
  /** Present only for unscorable input (D1). */
  status?: "unscorable";
  reason?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function de(
  a: { L: number; a: number; b: number },
  b: { L: number; a: number; b: number },
): number {
  return Math.sqrt((a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

function cv(values: number[]): number | null {
  if (values.length < 2) return null;
  const avg = values.reduce((a, v) => a + v, 0) / values.length;
  if (!(avg > 0)) return null;
  const variance = values.reduce((a, v) => a + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance) / avg;
}

/** Recompute the quantities scoreGradient thresholds on (valid input only). */
export function measure(stops: Stop[]): Measurements {
  const labs = stops.map((s) => rgbToOklab(hexToRgb(s.color)));
  const lchs = labs.map(oklabToLch);
  const sorted = stops
    .map((s, i) => ({ s, lab: labs[i] }))
    .sort((a, b) => a.s.position - b.s.position);

  let maxDeltaE = 0;
  for (let i = 0; i < labs.length; i++) {
    for (let j = i + 1; j < labs.length; j++) maxDeltaE = Math.max(maxDeltaE, de(labs[i], labs[j]));
  }

  let maxCloseJumpDeltaE = 0;
  const velocities: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].s.position - sorted[i].s.position;
    const d = de(sorted[i].lab, sorted[i + 1].lab);
    if (gap > 0 && gap <= 10) maxCloseJumpDeltaE = Math.max(maxCloseJumpDeltaE, d);
    if (gap > 0) velocities.push(d / gap);
  }

  const chromatic = lchs.filter((l) => l.C > 0.02);
  let enclosingArc: number | null = null;
  if (chromatic.length >= 2) {
    const hs = chromatic.map((l) => l.h).sort((a, b) => a - b);
    let maxGap = hs[0] + 360 - hs[hs.length - 1];
    for (let i = 1; i < hs.length; i++) maxGap = Math.max(maxGap, hs[i] - hs[i - 1]);
    enclosingArc = 360 - maxGap;
  }

  const cs = lchs.map((l) => l.C);
  const chromaRange = Math.max(...cs) - Math.min(...cs);

  let worstDip = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const c1 = hexToRgb(sorted[i].s.color);
    const c2 = hexToRgb(sorted[i + 1].s.color);
    const mid = oklabToLch(
      rgbToOklab({
        r: Math.round((c1.r + c2.r) / 2),
        g: Math.round((c1.g + c2.g) / 2),
        b: Math.round((c1.b + c2.b) / 2),
      }),
    );
    const avg = (oklabToLch(rgbToOklab(c1)).C + oklabToLch(rgbToOklab(c2)).C) / 2;
    if (avg > 0.04) worstDip = Math.max(worstDip, 1 - mid.C / avg);
  }

  const positions = stops.map((s) => s.position).sort((a, b) => a - b);
  const first = positions[0];
  const last = positions[positions.length - 1];
  const gaps: number[] = [];
  for (let i = 1; i < positions.length; i++) gaps.push(positions[i] - positions[i - 1]);

  return {
    maxDeltaE,
    maxCloseJumpDeltaE,
    velocityCv: sorted.length >= 3 ? cv(velocities) : null,
    enclosingArc,
    chromaRange,
    worstDip,
    edgeGap: first + (100 - last),
    span: last - first,
    gapCv: stops.length > 2 ? cv(gaps) : null,
  };
}

/** The measurements recorded in v1-score.json (the legacy set). */
export const LEGACY_MEASUREMENTS = [
  "maxDeltaE",
  "maxCloseJumpDeltaE",
  "velocityCv",
  "enclosingArc",
  "chromaRange",
  "worstDip",
  "edgeGap",
  "span",
  "gapCv",
] as const satisfies readonly (keyof Measurements & keyof ScoreMeasurements)[];

/**
 * True when any recorded measurement is within `eps` (relative to the
 * threshold, absolute below 1) of one of its V1_MODEL thresholds, using the
 * model's boundary table restricted to the measurements recorded here.
 */
export function isBoundary(m: Measurements, eps = 1e-6): boolean {
  return boundaryHits(m, eps, LEGACY_MEASUREMENTS).length > 0;
}

/** Whether one of the four formerly silent penalties (D4) fires for this input. */
export function silentPenalties(m: Measurements, stops: Stop[]): boolean {
  const { hue, rhythm } = V1_MODEL;
  return (
    (m.enclosingArc !== null && m.enclosingArc < hue.arc.narrowBelow) ||
    (m.edgeGap > rhythm.edge.slightAbove && m.edgeGap <= rhythm.edge.shortAbove) ||
    (m.span >= rhythm.span.squeezedBelow && m.span < rhythm.span.narrowBelow) ||
    (stops.length > 2 &&
      m.gapCv !== null &&
      m.gapCv > rhythm.gaps.unevenAbove &&
      m.gapCv <= rhythm.gaps.clusteredAbove)
  );
}

const toTicks = (stops: Stop[]): GradientTick[] => stops.map((s) => ({ ...s }));

// ── Input predicates for the defect regions (shared with vector-diff.ts) ──────

const chromaOf = (hex: string) => oklabToLch(rgbToOklab(hexToRgb(hex))).C;

/** D1: outside the v1 domain. */
export function isInvalidInput(stops: Stop[]): boolean {
  return scoreGradient(toTicks(stops)).status === "unscorable";
}

/** D6: the array is not already in (non-decreasing) position order. */
export function isUnsorted(stops: Stop[]): boolean {
  return stops.some((s, i) => i > 0 && s.position < stops[i - 1].position);
}

/** D5 (input part): an achromatic stop or a hard stop (neighbours <= 1% apart). */
export function hasGreyOrHardStop(stops: Stop[]): boolean {
  const R = V1_MODEL.refine;
  const ps = stops.map((s) => s.position).sort((a, b) => a - b);
  return (
    stops.some((s) => chromaOf(s.color) <= R.achromaticAtMost) ||
    ps.some((p, i) => i > 0 && p - ps[i - 1] <= R.hardStopGap)
  );
}

/** D7: refine compresses the hue arc around an ill-conditioned circular mean. */
export function hasDegenerateHueMean(stops: Stop[]): boolean {
  const R = V1_MODEL.refine;
  const hues = stops
    .map((s) => oklabToLch(rgbToOklab(hexToRgb(s.color))))
    .filter((l) => l.C > R.achromaticAtMost)
    .map((l) => l.h);
  if (hues.length < 2) return false;
  const x = hues.reduce((a, h) => a + Math.cos((h * Math.PI) / 180), 0) / hues.length;
  const y = hues.reduce((a, h) => a + Math.sin((h * Math.PI) / 180), 0) / hues.length;
  const s = [...hues].sort((a, b) => a - b);
  let maxGap = s[0] + 360 - s[s.length - 1];
  for (let i = 1; i < s.length; i++) maxGap = Math.max(maxGap, s[i] - s[i - 1]);
  return Math.sqrt(x * x + y * y) < R.degenerateResultantBelow && 360 - maxGap > R.maxHueArc;
}

/** D2: stops do not span 0-100, or several stops share the last position. */
export function isD2Region(stops: Stop[]): boolean {
  const ps = stops.map((s) => s.position);
  const max = Math.max(...ps);
  return Math.min(...ps) > 0 || max < 100 || ps.filter((p) => p === max).length > 1;
}

// ── Evaluators (used by the generator AND the replaying test) ─────────────────

export function evalScore(name: string, stops: Stop[]): ScoreCase {
  const r = scoreGradient(toTicks(stops));
  const details = {
    lightness: r.details.lightness,
    hue: r.details.hue,
    chroma: r.details.chroma,
    spacing: r.details.spacing,
  };
  if (r.status === "unscorable") {
    return {
      name,
      stops,
      score: r.score,
      details,
      issues: [...r.issues],
      measurements: null,
      boundary: false,
      defects: ["D1"],
      status: "unscorable",
      reason: r.reason,
    };
  }
  const m = measure(stops);
  const defects: DefectTag[] = [];
  if (silentPenalties(m, stops)) defects.push("D4");
  return {
    name,
    stops,
    score: r.score,
    details,
    issues: [...r.issues],
    measurements: m,
    boundary: isBoundary(m),
    defects,
  };
}

export interface SuggestCase {
  name: string;
  stops: Stop[];
  scoreBefore: number;
  suggested: Stop[];
  scoreAfter: number;
  defects: DefectTag[];
}

export function evalSuggest(name: string, stops: Stop[]): SuggestCase {
  const before = scoreGradient(toTicks(stops)).score;
  const suggested = suggestGradient(toTicks(stops)).map((s) => ({
    id: s.id,
    color: s.color,
    position: s.position,
  }));
  const after = scoreGradient(toTicks(suggested)).score;
  const defects: DefectTag[] = [];
  if (isInvalidInput(stops)) {
    defects.push("D1");
  } else {
    const declined = stops.length >= 2 && !refineGradient(toTicks(stops)).refined;
    if (hasGreyOrHardStop(stops) || declined) defects.push("D5");
  }
  return { name, stops, scoreBefore: before, suggested, scoreAfter: after, defects };
}

// ── Findings vectors (explained score, full measurements) ─────────────────────

export interface FindingsCase {
  name: string;
  stops: Stop[];
  status: "ok" | "unscorable";
  reason?: string;
  score: number;
  details: { lightness: number; hue: number; chroma: number; spacing: number };
  findings: Finding[];
  measurements: ScoreMeasurements | null;
  boundary: boolean;
  /** "measurement@threshold" for every measurement within epsilon of a threshold. */
  boundaryHits: string[];
}

export function evalFindings(name: string, stops: Stop[]): FindingsCase {
  const r = scoreGradient(toTicks(stops));
  const m = r.details.measurements ?? null;
  const hits = m ? boundaryHits(m) : [];
  return {
    name,
    stops,
    status: r.status,
    ...(r.reason !== undefined ? { reason: r.reason } : {}),
    score: r.score,
    details: {
      lightness: r.details.lightness,
      hue: r.details.hue,
      chroma: r.details.chroma,
      spacing: r.details.spacing,
    },
    findings: r.findings.map((f) => ({ ...f })),
    measurements: m,
    boundary: hits.length > 0,
    boundaryHits: hits,
  };
}

export interface CssCase {
  name: string;
  stops: Stop[];
  angle: number;
  directions: GradientDirection[];
  blend: GradientBlendMode;
  css: string;
  multi: { background: string; backgroundBlendMode: string };
}

export function evalCss(
  name: string,
  stops: Stop[],
  angle: number,
  directions: GradientDirection[],
  blend: GradientBlendMode,
): CssCase {
  const ticks = toTicks(stops);
  const multi = buildMultiGradientStyle(ticks, directions.map((d) => ({ ...d })), blend);
  return {
    name,
    stops,
    angle,
    directions,
    blend,
    css: buildGradientCSS(ticks, angle),
    multi: { background: multi.background, backgroundBlendMode: multi.backgroundBlendMode },
  };
}

export const INTERPOLATE_COUNTS = [2, 3, 5, 8, 16] as const;
export const POSITION_SAMPLES = [0, 10, 25, 50, 75, 90, 100] as const;

export interface InterpolateCase {
  name: string;
  stops: Stop[];
  samples: Record<string, string[]>;
  colorAt: string[];
  defects: DefectTag[];
}

export function evalInterpolate(name: string, stops: Stop[]): InterpolateCase {
  const ticks = toTicks(stops);
  const samples: Record<string, string[]> = {};
  for (const n of INTERPOLATE_COUNTS) samples[String(n)] = interpolateGradient(ticks, n);
  const defects: DefectTag[] = [];
  if (stops.length > 0 && isD2Region(stops)) defects.push("D2");
  if (stops.some((s) => !/^#[0-9a-fA-F]{6}$/.test(s.color))) defects.push("D1");
  return {
    name,
    stops,
    samples,
    colorAt: POSITION_SAMPLES.map((p) => colorAtPosition(ticks, p)),
    defects,
  };
}

// ── Colour vectors ────────────────────────────────────────────────────────────

export type ColorCase =
  | { kind: "hex"; input: string; out: Record<string, unknown> }
  | { kind: "parse"; input: string; out: Record<string, unknown> }
  | { kind: "lch"; input: LchColor; out: Record<string, unknown> }
  | { kind: "scalar"; input: number; out: Record<string, unknown> }
  | { kind: "hsl"; input: { h: number; s: number; l: number }; out: Record<string, unknown> };

export function evalColor(c: { kind: ColorCase["kind"]; input: unknown }): ColorCase {
  switch (c.kind) {
    case "hex": {
      const hex = c.input as string;
      const rgb = hexToRgb(hex);
      const lab = rgbToOklab(rgb);
      const lch = hexToOklch(hex);
      return {
        kind: "hex",
        input: hex,
        out: {
          rgb,
          oklab: lab,
          oklch: lch,
          oklchToHex: oklchToHex(lch),
          hslPrecise: hexToHslPrecise(hex),
          hsl: hexToHsl(hex),
          formatHex: formatHex(hex),
          formatRgb: formatRgb(hex),
          formatHsl: formatHsl(hex),
          formatName: formatName(hex),
          formatNameDisplay: formatNameDisplay(hex),
          nearestName: nearestColorName(hex),
          complement: complementHex(hex),
        },
      };
    }
    case "parse": {
      const s = c.input as string;
      return {
        kind: "parse",
        input: s,
        out: {
          hex: parseHex(s),
          rgb: parseRgb(s),
          hsl: parseHsl(s),
          name: parseName(s),
          any: parseAnyColor(s),
        },
      };
    }
    case "lch": {
      const lch = c.input as LchColor;
      return {
        kind: "lch",
        input: lch,
        out: {
          toOklab: lchToOklab(lch),
          linearRgb: oklabToLinearRgb(lchToOklab(lch)),
          rgb: oklabToRgb(lchToOklab(lch)),
          hex: oklchToHex(lch),
          gamutFit: gamutFitOklch(lch),
          fittedHex: oklchToHexFitted(lch),
        },
      };
    }
    case "scalar": {
      const v = c.input as number;
      return {
        kind: "scalar",
        input: v,
        out: { srgbToLinear: srgbToLinear(v), linearToSrgb: linearToSrgb(v) },
      };
    }
    case "hsl": {
      const hsl = c.input as { h: number; s: number; l: number };
      return {
        kind: "hsl",
        input: hsl,
        out: { rgb: hslToRgb(hsl), hex: hslToHex(hsl), rgbToHex: rgbToHex(hslToRgb(hsl)) },
      };
    }
  }
}

export { spreadDirectionAngles };
