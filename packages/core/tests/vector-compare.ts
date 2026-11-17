// Comparison used by the characterisation tests (PLAN §3.3).
//
// The v1 vectors are the contract, but floating-point *measurements* (maxDeltaE,
// worstDip, ...) are produced by Math.pow / Math.cbrt / Math.atan2, which the
// ECMAScript spec lets each engine approximate. Different V8 versions disagree
// in the last digits (Node 22 vs Node 24 gave 0.6492378126457399 vs
// 0.6492378126457392 for the same input), while every score stays the same.
// So: numbers that are not integers are compared with a small relative
// tolerance, and EVERYTHING else is compared exactly: integer scores, hex and
// CSS strings, finding codes, locations (stop indices, segments), booleans,
// array lengths and object keys. A real behaviour change still fails.
//
// One more rule: the hue of an (almost) achromatic colour is "powerless"
// (CSS Color 4): atan2 of two values around 1e-17 is numerical noise, so `h` is
// not compared when both chromas are below POWERLESS_CHROMA.

/** Relative tolerance for non-integer numbers. Far below any meaningful change, far above engine noise (~1e-15). */
export const FLOAT_TOLERANCE = 1e-9;

/** Below this chroma a colour is treated as achromatic and its hue is not compared. */
export const POWERLESS_CHROMA = 1e-6;

function sameNumber(a: number, b: number): boolean {
  if (Object.is(a, b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  // Integers (scores, positions, indices, counts) must match exactly.
  if (Number.isInteger(a) && Number.isInteger(b)) return false;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= FLOAT_TOLERANCE * scale;
}

/** The path of the first difference, or null when `actual` matches `expected`. */
export function firstDifference(actual: unknown, expected: unknown, path = "$"): string | null {
  if (typeof actual === "number" && typeof expected === "number") {
    return sameNumber(actual, expected) ? null : `${path}: ${actual} !== ${expected}`;
  }
  if (actual === null || expected === null || typeof actual !== "object" || typeof expected !== "object") {
    return Object.is(actual, expected) ? null : `${path}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`;
  }
  if (Array.isArray(actual) !== Array.isArray(expected)) return `${path}: array vs object`;
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return `${path}: length ${actual.length} !== ${expected.length}`;
    for (let i = 0; i < actual.length; i++) {
      const d = firstDifference(actual[i], expected[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const a = actual as Record<string, unknown>;
  const e = expected as Record<string, unknown>;
  const ak = Object.keys(a);
  const ek = Object.keys(e);
  if (ak.length !== ek.length || ak.some((k, i) => k !== ek[i])) {
    return `${path}: keys [${ak.join(",")}] !== [${ek.join(",")}]`;
  }
  const powerlessHue =
    typeof a.C === "number" && typeof e.C === "number" && Math.max(Math.abs(a.C), Math.abs(e.C)) < POWERLESS_CHROMA;
  for (const k of ek) {
    if (k === "h" && powerlessHue) continue;
    const d = firstDifference(a[k], e[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}
