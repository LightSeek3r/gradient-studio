// ── Lightness / chroma / hue curves along the gradient (pure) ─────────────────
// Samples the gradient the way the exported CSS is painted (browsers mix
// neighbouring stops in sRGB) and reads each sample in OKLCH, so a lightness
// reversal is a visible dip and a muddy midpoint a visible chroma trough.

import { hexToOklch, sampleGradient, V1_MODEL, type GradientTick } from "@opal42/gradient";
import type { I18n, Translate } from "../i18n/translator";
import { sortTicks } from "../state/document";

export type CurveKey = "lightness" | "chroma" | "hue";

export interface Curve {
  key: CurveKey;
  label: string;
  /** One value per sample; null where the value is undefined (hue of a grey). */
  values: (number | null)[];
  /** Smallest and largest defined value (hue: unwrapped degrees), or null when none is defined. */
  min: number | null;
  max: number | null;
  /** The y-axis range the values are drawn in. */
  domain: [number, number];
  /** "rises", "falls", "flat", "dips, then rises", … in the active language. */
  trend: string;
  /** One sentence for assistive tech and tooltips. */
  summary: string;
}

export interface Curves {
  /** Sample positions, 0-100. */
  xs: number[];
  curves: Curve[];
}

export const CURVE_SAMPLES = 65;
const SRGB = { space: "srgb" } as const;
/** Below this chroma a sample has no meaningful hue (the model's own line). */
const GREY = V1_MODEL.hue.chromaticAbove;

/** Hues as a continuous line: each step takes the shorter way round; nulls stay null. */
export function unwrapHues(hues: readonly (number | null)[]): (number | null)[] {
  const out: (number | null)[] = [];
  let last: number | null = null;
  for (const h of hues) {
    if (h === null || !Number.isFinite(h)) {
      out.push(null);
      continue;
    }
    if (last === null) last = h;
    else {
      const step = ((((h - last) % 360) + 540) % 360) - 180;
      last += step;
    }
    out.push(last);
  }
  return out;
}

/** Describes the shape of a series, ignoring wiggles smaller than `tolerance`. */
export function describeTrend(values: readonly (number | null)[], tolerance: number, t: Translate): string {
  const v = values.filter((x): x is number => x !== null);
  if (v.length < 2) return t("trend.undefined");
  // Turning points with hysteresis: a direction only counts once it has moved by `tolerance`.
  const dirs: number[] = [];
  let anchor = v[0];
  let dir = 0;
  for (const x of v) {
    if (dir >= 0 && x > anchor) anchor = dir === 1 ? x : anchor;
    if (dir <= 0 && x < anchor) anchor = dir === -1 ? x : anchor;
    if (dir !== 1 && x - anchor > tolerance) {
      dir = 1;
      dirs.push(1);
      anchor = x;
    } else if (dir !== -1 && anchor - x > tolerance) {
      dir = -1;
      dirs.push(-1);
      anchor = x;
    } else if (dir === 1 && x > anchor) anchor = x;
    else if (dir === -1 && x < anchor) anchor = x;
  }
  if (dirs.length === 0) return t("trend.flat");
  if (dirs.length === 1) return t(dirs[0] > 0 ? "trend.rises" : "trend.falls");
  if (dirs.length === 2) return t(dirs[0] < 0 ? "trend.dipsRises" : "trend.peaksFalls");
  return t("trend.changes", { count: dirs.length - 1 });
}

function curve(
  i18n: I18n,
  key: CurveKey,
  label: string,
  values: (number | null)[],
  domain: [number, number],
  tolerance: number,
  digits: number,
  unit: string,
): Curve {
  const { t } = i18n;
  const defined = values.filter((x): x is number => x !== null);
  const min = defined.length ? Math.min(...defined) : null;
  const max = defined.length ? Math.max(...defined) : null;
  const trend = describeTrend(values, tolerance, t);
  const summary =
    min === null || max === null
      ? t("curves.summaryUndefined", { label })
      : t("curves.summary", {
          label,
          trend,
          min: `${i18n.number(min, digits)}${unit}`,
          max: `${i18n.number(max, digits)}${unit}`,
        });
  return { key, label, values, min, max, domain, trend, summary };
}

/** The three curves of a gradient, or null when it cannot be sampled. */
export function sampleCurves(ticks: readonly GradientTick[], i18n: I18n, samples = CURVE_SAMPLES): Curves | null {
  const sorted = sortTicks(ticks);
  if (sorted.length < 2 || samples < 2) return null;
  const doc = {
    kind: "linear" as const,
    angle: 90,
    stops: sorted.map((t) => ({ color: t.color, position: t.position / 100 })),
  };
  const xs: number[] = [];
  const L: number[] = [];
  const C: number[] = [];
  const H: (number | null)[] = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const sample = sampleGradient(doc, t, { interpolation: SRGB });
    if (!sample) return null;
    const lch = hexToOklch(sample.color);
    xs.push(t * 100);
    L.push(lch.L);
    C.push(lch.C);
    H.push(lch.C > GREY ? lch.h : null);
  }
  const hue = unwrapHues(H);
  const definedHue = hue.filter((x): x is number => x !== null);
  // Keep a minimum 60° window so a single-hue gradient draws flat, not as amplified noise.
  let hueDomain: [number, number] = [0, 360];
  if (definedHue.length) {
    const lo = Math.min(...definedHue);
    const hi = Math.max(...definedHue);
    const pad = Math.max((60 - (hi - lo)) / 2, (hi - lo) * 0.08);
    hueDomain = [lo - pad, hi + pad];
  }
  const maxC = Math.max(...C);
  return {
    xs,
    curves: [
      curve(i18n, "lightness", i18n.t("curves.lightness"), L, [0, 1], 0.02, 2, ""),
      curve(i18n, "chroma", i18n.t("curves.chroma"), C, [0, Math.max(0.2, maxC * 1.1)], 0.01, 2, ""),
      curve(i18n, "hue", i18n.t("curves.hue"), hue, hueDomain, 5, 0, "°"),
    ],
  };
}

/** SVG path data for a series in a `width` × `height` box (y down); gaps where values are null. */
export function curvePath(xs: readonly number[], values: readonly (number | null)[], domain: readonly [number, number], width: number, height: number): string {
  const [lo, hi] = domain;
  const span = hi - lo || 1;
  let d = "";
  let pen = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) {
      pen = false;
      continue;
    }
    const x = (xs[i] / 100) * width;
    const y = height - ((v - lo) / span) * height;
    d += `${pen ? "L" : "M"}${x.toFixed(2)} ${Math.min(height, Math.max(0, y)).toFixed(2)}`;
    pen = true;
  }
  return d;
}
