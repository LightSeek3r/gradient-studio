// ── Document helpers: validation, stop resolution, sampling, baking ────────────

import { gamutFitOklch } from "../color-formats";
import { hexToRgb, lchToOklab, oklabToLch, oklabToRgb, rgbToHex, rgbToOklab, isValidStopColor } from "../gradient-engine";
import { quantize } from "../tolerance";
import type {
  GradientDocument,
  HueInterpolation,
  Interpolation,
  ResolvedStop,
  SampledColor,
  SampleOptions,
  Stop,
} from "./types";

/** True for a finite number. */
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A stop's alpha as a number in 0-1, or null when it is not one. */
export function stopAlpha(stop: Stop): number | null {
  if (stop.alpha === undefined) return 1;
  return finite(stop.alpha) && stop.alpha >= 0 && stop.alpha <= 1 ? stop.alpha : null;
}

/** Shape check shared by every entry point: an object with a `stops` array of objects. */
export function isDocumentLike(doc: unknown): doc is GradientDocument {
  if (typeof doc !== "object" || doc === null) return false;
  const stops = (doc as { stops?: unknown }).stops;
  return Array.isArray(stops) && stops.every((s) => typeof s === "object" && s !== null);
}

/**
 * Resolve missing stop positions exactly as CSS does (css-images-3 §3.4.3):
 *   1. a missing first position is 0, a missing last position is 1;
 *   2. a position smaller than any position before it is raised to that maximum;
 *   3. each run of missing positions is spaced evenly between its neighbours.
 * Order is kept (CSS paints in source order). A non-finite position counts as
 * missing. Returns new stops; the input is not modified.
 */
export function resolveStops(doc: GradientDocument): ResolvedStop[] {
  if (!isDocumentLike(doc)) return [];
  const stops = doc.stops;
  const n = stops.length;
  if (n === 0) return [];
  const pos: (number | undefined)[] = stops.map((s) => (finite(s.position) ? s.position : undefined));
  if (pos[0] === undefined) pos[0] = 0;
  if (pos[n - 1] === undefined) pos[n - 1] = n === 1 ? pos[0] : 1;

  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = pos[i];
    if (p === undefined) continue;
    if (p < max) pos[i] = max;
    else max = p;
  }

  let i = 1;
  while (i < n) {
    if (pos[i] !== undefined) {
      i++;
      continue;
    }
    let j = i;
    while (pos[j] === undefined) j++;
    const a = pos[i - 1] as number;
    const b = pos[j] as number;
    const steps = j - i + 1;
    for (let k = i; k < j; k++) pos[k] = a + ((b - a) * (k - i + 1)) / steps;
    i = j + 1;
  }
  return stops.map((s, k) => ({ ...s, position: pos[k] as number }));
}

// ── Interpolation ─────────────────────────────────────────────────────────────

interface Prepared {
  position: number;
  color: string;
  alpha: number;
}

/** Resolved, validated stops, or null when any colour or alpha is invalid. */
function prepare(doc: GradientDocument): Prepared[] | null {
  if (!isDocumentLike(doc) || doc.stops.length === 0) return null;
  const out: Prepared[] = [];
  for (const s of resolveStops(doc)) {
    const alpha = stopAlpha(s);
    if (!isValidStopColor(s.color) || alpha === null) return null;
    out.push({ position: s.position, color: s.color.toLowerCase(), alpha });
  }
  return out;
}

const POWERLESS_CHROMA = 1e-5;

function hueDelta(from: number, to: number, method: HueInterpolation): number {
  let d = (((to - from) % 360) + 360) % 360; // 0..360, increasing
  switch (method) {
    case "increasing":
      return d;
    case "decreasing":
      return d === 0 ? 0 : d - 360;
    case "longer":
      if (d > 0 && d < 180) d -= 360;
      else if (d === 0) d = 360;
      return d;
    default:
      return d > 180 ? d - 360 : d;
  }
}

/** Mix two stops at `t` (0-1) in `space`, alpha-premultiplied as CSS Color 4 specifies. */
function mix(a: Prepared, b: Prepared, t: number, interpolation: Interpolation): SampledColor {
  if (t <= 0) return { color: a.color, alpha: a.alpha };
  if (t >= 1) return { color: b.color, alpha: b.alpha };
  const alpha = a.alpha + (b.alpha - a.alpha) * t;
  // Premultiplied weights; with a fully transparent result fall back to plain weights.
  let wa = (1 - t) * a.alpha;
  let wb = t * b.alpha;
  if (alpha <= 0) {
    wa = 1 - t;
    wb = t;
  } else {
    wa /= alpha;
    wb /= alpha;
  }
  const ra = hexToRgb(a.color);
  const rb = hexToRgb(b.color);
  if (interpolation.space === "srgb") {
    return {
      color: rgbToHex({ r: ra.r * wa + rb.r * wb, g: ra.g * wa + rb.g * wb, b: ra.b * wa + rb.b * wb }),
      alpha,
    };
  }
  const la = rgbToOklab(ra);
  const lb = rgbToOklab(rb);
  let lch;
  if (interpolation.space === "oklab") {
    lch = oklabToLch({ L: la.L * wa + lb.L * wb, a: la.a * wa + lb.a * wb, b: la.b * wa + lb.b * wb });
  } else {
    const ca = oklabToLch(la);
    const cb = oklabToLch(lb);
    // A powerless (achromatic) hue takes the other colour's hue. Hue is not premultiplied.
    const ha = ca.C < POWERLESS_CHROMA ? cb.h : ca.h;
    const hb = cb.C < POWERLESS_CHROMA ? ca.h : cb.h;
    const h = ha + hueDelta(ha, hb, interpolation.hue ?? "shorter") * t;
    lch = { L: ca.L * wa + cb.L * wb, C: ca.C * wa + cb.C * wb, h: ((h % 360) + 360) % 360 };
  }
  lch.L = lch.L < 0 ? 0 : lch.L > 1 ? 1 : lch.L;
  return { color: rgbToHex(oklabToRgb(lchToOklab(gamutFitOklch(lch)))), alpha };
}

function sampleAt(stops: Prepared[], t: number, interpolation: Interpolation): SampledColor {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!(t > first.position)) {
    // At a hard stop on the first position CSS shows the later colour.
    let k = 0;
    if (t === first.position) while (k + 1 < stops.length && stops[k + 1].position === t) k++;
    return { color: stops[k].color, alpha: stops[k].alpha };
  }
  if (t >= last.position) return { color: last.color, alpha: last.alpha };
  // Last stop at or before t (binary search; positions are non-decreasing).
  let lo = 0;
  let hi = stops.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (stops[mid].position <= t) lo = mid;
    else hi = mid;
  }
  const a = stops[lo];
  const b = stops[lo + 1];
  const width = b.position - a.position;
  return mix(a, b, width > 0 ? (t - a.position) / width : 0, interpolation);
}

const OKLAB: Interpolation = { space: "oklab" };

function interpolationOf(opts: SampleOptions | undefined): Interpolation {
  const i = opts?.interpolation;
  if (i && (i.space === "srgb" || i.space === "oklab" || i.space === "oklch")) return i;
  return OKLAB;
}

/**
 * The colour of the gradient at `t` (0-1 along the gradient line), interpolated
 * in OKLAB unless `opts.interpolation` says otherwise, alpha-premultiplied and
 * gamut-mapped. Outside the stop range the end stops extend, as in CSS; at a
 * hard stop the later stop wins. Null for an invalid document or `t`.
 */
export function sampleGradient(doc: GradientDocument, t: number, opts?: SampleOptions): SampledColor | null {
  const stops = prepare(doc);
  if (!stops || !finite(t)) return null;
  return sampleAt(stops, t, interpolationOf(opts));
}

/**
 * Pre-sample the gradient into about `n` stops that reproduce the OKLAB
 * rendering in an engine that only interpolates in sRGB (Figma, SVG, native
 * toolkits). Every original stop is kept exactly (so hard stops survive); the
 * `n - stops.length` extra samples are shared between the segments in
 * proportion to their length. Returns [] for an invalid document.
 */
export function bakeStops(doc: GradientDocument, n: number, opts?: SampleOptions): Stop[] {
  const stops = prepare(doc);
  if (!stops) return [];
  const interpolation = interpolationOf(opts);
  const k = stops.length;
  const want = finite(n) ? Math.min(Math.floor(n), 4096) : k;
  const total = stops[k - 1].position - stops[0].position;
  const extra: number[] = new Array(Math.max(0, k - 1)).fill(0);
  if (want > k && total > 0) {
    // Largest-remainder apportionment, ties to the earlier segment. Remainders
    // equal within EPS (e.g. equal-length segments whose exact share differs in
    // the last bit) are ties (D8): the key is quantized so the sort is a strict order.
    const budget = want - k;
    const exact = extra.map((_, i) => ((stops[i + 1].position - stops[i].position) / total) * budget);
    let given = 0;
    for (let i = 0; i < exact.length; i++) {
      extra[i] = Math.floor(exact[i]);
      given += extra[i];
    }
    const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => quantize(b.r) - quantize(a.r) || a.i - b.i);
    for (let j = 0; given < budget && j < order.length; j++) {
      if (stops[order[j].i + 1].position > stops[order[j].i].position) {
        extra[order[j].i]++;
        given++;
      }
    }
  }
  const make = (position: number, c: SampledColor): Stop => {
    const s: Stop = { color: c.color, position };
    if (c.alpha < 1) s.alpha = c.alpha;
    return s;
  };
  const out: Stop[] = [];
  for (let i = 0; i < k; i++) {
    out.push(make(stops[i].position, stops[i]));
    if (i === k - 1) break;
    for (let j = 1; j <= extra[i]; j++) {
      const f = j / (extra[i] + 1);
      const position = stops[i].position + (stops[i + 1].position - stops[i].position) * f;
      out.push(make(position, mix(stops[i], stops[i + 1], f, interpolation)));
    }
  }
  return out;
}
