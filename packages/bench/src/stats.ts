// Statistics, implemented here so the package has no runtime dependency and the
// output is reproducible bit for bit. Reference values are in tests/stats.test.ts.

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Quantile by linear interpolation between order statistics (R type 7, NumPy default). */
export function quantileSorted(sorted: readonly number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0]!;
  const h = (n - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

export function quantile(xs: readonly number[], q: number): number {
  return quantileSorted([...xs].sort((a, b) => a - b), q);
}

export function median(xs: readonly number[]): number {
  return quantile(xs, 0.5);
}

/** Sample standard deviation (n - 1). NaN for fewer than two values. */
export function sd(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (n - 1));
}

/** mulberry32: a small 32-bit PRNG (public domain, Tommy Ettinger). Returns floats in [0, 1). */
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

/** The mean of `resamples` bootstrap resamples (with replacement) of `xs`. */
export function bootstrapMeans(xs: readonly number[], resamples: number, seed: number): number[] {
  const n = xs.length;
  const rand = mulberry32(seed);
  const out: number[] = new Array<number>(resamples);
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += xs[Math.floor(rand() * n)]!;
    out[r] = s / n;
  }
  return out;
}

export interface BootstrapCI {
  mean: number;
  lo: number;
  hi: number;
  level: number;
  resamples: number;
  seed: number;
}

/**
 * Paired bootstrap: `diffs` are the per-pair differences (condition - baseline).
 * Resampling pairs with replacement and taking the mean gives the percentile
 * interval of the mean difference. Returns null for fewer than two pairs.
 */
export function pairedBootstrapCI(diffs: readonly number[], resamples = 2000, seed = 1, level = 0.95): BootstrapCI | null {
  if (diffs.length < 2) return null;
  const means = bootstrapMeans(diffs, resamples, seed).sort((a, b) => a - b);
  const alpha = (1 - level) / 2;
  return { mean: mean(diffs), lo: quantileSorted(means, alpha), hi: quantileSorted(means, 1 - alpha), level, resamples, seed };
}

/** erfc with a relative error below 1e-15 for the arguments used here (series + continued fraction). */
function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  if (x < 2.5) {
    // erf(x) = 2/sqrt(pi) * sum_{n} (-1)^n x^(2n+1) / (n! (2n+1))
    let term = x;
    let sum = x;
    for (let n = 1; n < 100; n++) {
      term *= (-x * x) / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * sum;
  }
  // Continued fraction (Lentz), erfc(x) = exp(-x^2)/(x sqrt(pi)) * 1/(1+ 1/(2x^2)/(1+2/(2x^2)/(1+...)))
  let f = 0;
  for (let k = 60; k >= 1; k--) f = k / 2 / (x + f);
  return Math.exp(-x * x) / (Math.sqrt(Math.PI) * (x + f));
}

/** Standard normal cumulative distribution function. */
export function normalCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

export interface Wilcoxon {
  /** Number of non-zero differences (zeros are dropped, as in the classical test). */
  n: number;
  /** Sum of the (mid)ranks of the positive differences. */
  wPlus: number;
  wMinus: number;
  /** Two-sided p-value. */
  p: number;
  method: "exact" | "normal";
}

export const WILCOXON_EXACT_MAX_N = 50;

/**
 * Wilcoxon signed-rank test, two-sided, on paired differences.
 *
 * Zero differences are dropped; |d| are ranked with midranks for ties.
 *  - n <= 50: exact permutation distribution of W+ given the observed ranks
 *    (dynamic programme over doubled ranks, so midranks stay integers). With no
 *    ties this is the textbook exact test.
 *  - n > 50: normal approximation with tie correction and continuity correction.
 * Returns null when there is no non-zero difference.
 */
export function wilcoxonSignedRank(diffs: readonly number[]): Wilcoxon | null {
  const d = diffs.filter((x) => Number.isFinite(x) && x !== 0);
  const n = d.length;
  if (n === 0) return null;
  const order = d.map((_, i) => i).sort((i, j) => Math.abs(d[i]!) - Math.abs(d[j]!));
  const ranks = new Array<number>(n);
  const tieSizes: number[] = [];
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && Math.abs(d[order[j + 1]!]!) === Math.abs(d[order[i]!]!)) j++;
    const mid = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]!] = mid;
    tieSizes.push(j - i + 1);
    i = j + 1;
  }
  let wPlus = 0;
  let wMinus = 0;
  for (let i = 0; i < n; i++) if (d[i]! > 0) wPlus += ranks[i]!;
  else wMinus += ranks[i]!;
  if (n <= WILCOXON_EXACT_MAX_N) {
    // counts[s] = number of sign assignments whose doubled W+ equals s.
    const doubled = ranks.map((r) => Math.round(r * 2));
    const max = doubled.reduce((a, b) => a + b, 0);
    let counts = new Float64Array(max + 1);
    counts[0] = 1;
    for (const r of doubled) {
      const next = new Float64Array(max + 1);
      for (let s = 0; s <= max; s++) {
        const c = counts[s]!;
        if (c === 0) continue;
        next[s] += c;
        next[s + r] += c;
      }
      counts = next;
    }
    const obs = Math.round(wPlus * 2);
    let le = 0;
    let ge = 0;
    for (let s = 0; s <= max; s++) {
      if (s <= obs) le += counts[s]!;
      if (s >= obs) ge += counts[s]!;
    }
    const all = 2 ** n;
    return { n, wPlus, wMinus, p: Math.min(1, (2 * Math.min(le, ge)) / all), method: "exact" };
  }
  const mu = (n * (n + 1)) / 4;
  let tieTerm = 0;
  for (const t of tieSizes) tieTerm += t * t * t - t;
  const variance = (n * (n + 1) * (2 * n + 1)) / 24 - tieTerm / 48;
  const diff = wPlus - mu;
  const cc = diff === 0 ? 0 : diff > 0 ? -0.5 : 0.5;
  const z = (diff + cc) / Math.sqrt(variance);
  return { n, wPlus, wMinus, p: Math.min(1, 2 * normalCdf(-Math.abs(z))), method: "normal" };
}
