// ── Tolerance-aware selection (defect D8) ──────────────────────────────────────
// The ONE mechanism the engine uses wherever a floating-point comparison
// chooses WHICH stop, segment or candidate is reported or edited (argmin /
// argmax, tie-breaks, "is this exactly half / exactly 180°" decisions). See
// docs/DETERMINISM.md.
//
// Why: `Math.pow`, `Math.cbrt`, `Math.atan2`, `Math.sin`, `Math.cos` are not
// correctly rounded and their last bit differs between V8 versions (Node 22 vs
// Node 24), between JavaScript and Python, and between platform libms. Two
// quantities that are equal in exact arithmetic (two greens of the same hue,
// the two deviations from the mean of two velocities, a symmetric gradient's
// two midpoint dips) therefore compare `<` or `>` by noise, and an exact
// argmin/argmax names a different stop on a different engine. With a
// tolerance, values within `EPS` are TIES and every tie is broken by the
// lowest index (into the position-sorted stops, or into the candidate list),
// which is the same on every engine.
//
// What this does NOT change: measurements (the numbers compared with the v1
// thresholds are computed exactly as before) and threshold tests (`> 0.8`,
// `< 15°`...). A measurement within noise of a THRESHOLD is a documented
// `boundary` case of v1 and may legitimately flip a score; that is out of
// scope here. Only the choice of location among (near-)equal candidates is
// made deterministic.
//
// Why 1e-9: engine noise is a few ulp of values of order 1..360, i.e. below
// 1e-13 absolute; real, meaningful differences between 8-bit colours are far
// above 1e-7 (adjacent 8-bit colours differ by ~1e-3 in OKLab, ~1e-2° in hue).
// 1e-9 sits four orders of magnitude above the noise and two below anything
// a designer can produce, so a tie decision only moves when a value lands
// within noise of the 1e-9 band edge itself, which no structural input does.

/** Relative tolerance (absolute below magnitude 1) for degrees, L, C, ΔE, velocities, dips and costs. */
export const EPS = 1e-9;

/** The tolerance band for comparing `a` and `b`: `eps · max(1, |a|, |b|)`. */
export function tolerance(a: number, b: number, eps = EPS): number {
  return eps * Math.max(1, Math.abs(a), Math.abs(b));
}

/** `a` and `b` are equal within `tolerance(a, b)`. False if either is NaN. */
export function approxEq(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= tolerance(a, b, eps);
}

/** `a < b` by more than the tolerance (a tie is not less). */
export function definitelyLess(a: number, b: number, eps = EPS): boolean {
  return a < b && !approxEq(a, b, eps);
}

/** `a > b` by more than the tolerance (a tie is not greater). */
export function definitelyGreater(a: number, b: number, eps = EPS): boolean {
  return a > b && !approxEq(a, b, eps);
}

/**
 * Index of the best value: the smallest (`"min"`) or largest (`"max"`) one,
 * where values within `EPS` of the extreme are ties and the LOWEST index among
 * the ties wins. NaN values are ignored; -1 when there is no number.
 */
export function argBest(values: readonly number[], mode: "min" | "max", eps = EPS): number {
  let extreme = NaN;
  for (const v of values) {
    if (Number.isNaN(v)) continue;
    if (Number.isNaN(extreme) || (mode === "min" ? v < extreme : v > extreme)) extreme = v;
  }
  if (Number.isNaN(extreme)) return -1;
  for (let i = 0; i < values.length; i++) if (approxEq(values[i], extreme, eps)) return i;
  return -1; // unreachable: the extreme itself matches
}

/** `argBest` over `items` by `key`; ties to the lowest index. */
export function argBestBy<T>(items: readonly T[], key: (item: T, index: number) => number, mode: "min" | "max", eps = EPS): number {
  return argBest(items.map(key), mode, eps);
}

/**
 * `Math.round`, except that a value within `EPS` of a half (k + 0.5) is
 * treated as exactly that half and rounds up, as `Math.round` rounds exact
 * halves. A computed target such as `a + (b - a) · d1 / (d1 + d2)` that is a
 * half in exact arithmetic then rounds the same way on every engine.
 */
export function roundHalfUp(x: number, eps = EPS): number {
  const f = Math.floor(x);
  if (approxEq(x - f, 0.5, eps)) return f + 1;
  return Math.round(x);
}

/**
 * A sort key with ties collapsed: `x` snapped to the grid of `eps`. Sorting
 * by `quantize(key)` and then by index is a strict total order (a comparator
 * that says "equal within EPS" is not transitive, and `Array.prototype.sort`
 * with an inconsistent comparator is implementation-defined).
 */
export function quantize(x: number, eps = EPS): number {
  return Math.round(x / eps);
}
