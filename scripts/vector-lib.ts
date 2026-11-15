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
  type GradientBlendMode,
  type GradientDirection,
  type GradientTick,
  type LchColor,
} from "../src/gradient-engine";
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

/** Tags a case that currently encodes behaviour the plan calls a defect. */
export type DefectTag = "D2" | "D4" | "D5";

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
  measurements: Measurements;
  boundary: boolean;
  defects: DefectTag[];
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

/** True when any thresholded measurement is within `eps` of its threshold. */
export function isBoundary(m: Measurements, eps = 1e-6): boolean {
  const checks: [number | null, number[]][] = [
    [m.maxDeltaE, [0.02, 0.05]],
    [m.maxCloseJumpDeltaE, [0.15]],
    [m.velocityCv, [0.5, 0.8]],
    [m.enclosingArc, [15, 120, 180]],
    [m.chromaRange, [0.12, 0.2]],
    [m.worstDip, [0.3, 0.5]],
    [m.edgeGap, [10, 20, 40]],
    [m.span, [20, 40]],
    [m.gapCv, [0.25, 0.5]],
  ];
  return checks.some(([v, ts]) => v !== null && ts.some((t) => Math.abs(v - t) < eps));
}

/** Which of the four silent penalties (D4) fire for this input. */
function silentPenalties(m: Measurements, stops: Stop[]): boolean {
  return (
    (m.enclosingArc !== null && m.enclosingArc < 15) ||
    (m.edgeGap > 10 && m.edgeGap <= 20) ||
    (m.span >= 20 && m.span < 40) ||
    (stops.length > 2 && m.gapCv !== null && m.gapCv > 0.25 && m.gapCv <= 0.5)
  );
}

// ── Evaluators (used by the generator AND the replaying test) ─────────────────

const toTicks = (stops: Stop[]): GradientTick[] => stops.map((s) => ({ ...s }));

export function evalScore(name: string, stops: Stop[]): ScoreCase {
  const r = scoreGradient(toTicks(stops));
  const m = measure(stops);
  const defects: DefectTag[] = silentPenalties(m, stops) ? ["D4"] : [];
  return {
    name,
    stops,
    score: r.score,
    details: { ...r.details },
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
  const hasGrey = stops.some((s) => oklabToLch(rgbToOklab(hexToRgb(s.color))).C <= 0.02);
  const defects: DefectTag[] = hasGrey || after < before ? ["D5"] : [];
  return { name, stops, scoreBefore: before, suggested, scoreAfter: after, defects };
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
  const ps = stops.map((s) => s.position);
  const defects: DefectTag[] =
    Math.min(...ps) > 0 || Math.max(...ps) < 100 ? ["D2"] : [];
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
