// Reference values used below (all independent of this implementation):
//  - quantile: R type 7 / NumPy default. quantile([1,2,3,4], .25) = 1.75 (hand: h=0.75 between 1 and 2).
//  - sample sd of [2,4,4,4,5,5,7,9]: sum of squared deviations = 32, 32/7 = 4.571428..., sqrt = 2.13808994 (population sd is exactly 2).
//  - standard normal CDF: Phi(0)=0.5, Phi(1)=0.8413447460685429, Phi(1.96)=0.9750021048517795,
//    Phi(-1)=0.15865525393145707, Phi(3)=0.9986501019683699, Phi(-5)=2.866515718791939e-7 (NIST / scipy.stats.norm.cdf).
//  - Wilcoxon signed-rank, exact two-sided: the example in the SciPy documentation for scipy.stats.wilcoxon,
//    x = [1.83, 0.50, 1.62, 2.48, 1.68, 1.88, 1.55, 3.06, 1.30], y = [0.878, 0.647, 0.598, 2.05, 1.06, 1.29, 1.06, 3.14, 1.29].
//    Differences give W+ = 40, W- = 5; P(W+ >= 40) = 10/512 = 0.01953125 (SciPy documents 0.0195 for alternative="greater"),
//    so two-sided p = 0.0390625. Counting by hand: subsets of {1..9} with sum <= 5 are 1,2,3,{3},{1,2},4,{4},{1,3},5,{5},{1,4},{2,3}: 10.
//  - n = 5 all positive: only the two extreme sign patterns are as extreme: p = 2/32 = 0.0625 (smallest possible for n = 5).
//  - n = 6 all positive: p = 2/64 = 0.03125.
//  - Normal approximation (n > 50): z = (W+ - n(n+1)/4 + 0.5) / sqrt(n(n+1)(2n+1)/24), computed in the test from the textbook formula.
import { describe, expect, it } from "vitest";
import { bootstrapMeans, mean, median, mulberry32, normalCdf, pairedBootstrapCI, quantile, sd, wilcoxonSignedRank } from "../src/stats";

describe("descriptive statistics", () => {
  it("mean and median", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(mean([])).toBeNaN();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("quantile (type 7)", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 12);
    expect(quantile([1, 2, 3, 4], 0.75)).toBeCloseTo(3.25, 12);
    expect(quantile([5], 0.9)).toBe(5);
    expect(quantile([1, 2, 3], 0)).toBe(1);
    expect(quantile([1, 2, 3], 1)).toBe(3);
    expect(quantile([], 0.5)).toBeNaN();
  });

  it("sample standard deviation", () => {
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13808993529939, 10);
    expect(sd([1])).toBeNaN();
    expect(sd([3, 3, 3])).toBe(0);
  });
});

describe("normal CDF", () => {
  it.each([
    [0, 0.5],
    [1, 0.8413447460685429],
    [1.96, 0.9750021048517795],
    [-1, 0.15865525393145707],
    [3, 0.9986501019683699],
  ])("Phi(%f) = %f", (z, p) => {
    expect(normalCdf(z)).toBeCloseTo(p, 12);
  });

  it("is accurate in the tail", () => {
    expect(normalCdf(-5) / 2.866515718791939e-7).toBeCloseTo(1, 8);
    expect(normalCdf(-8)).toBeGreaterThan(0);
    expect(normalCdf(-8)).toBeLessThan(1e-14);
  });

  it("is monotone and symmetric", () => {
    let prev = 0;
    for (let z = -6; z <= 6; z += 0.25) {
      const p = normalCdf(z);
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p + normalCdf(-z)).toBeCloseTo(1, 12);
      prev = p;
    }
  });
});

describe("Wilcoxon signed-rank", () => {
  const x = [1.83, 0.5, 1.62, 2.48, 1.68, 1.88, 1.55, 3.06, 1.3];
  const y = [0.878, 0.647, 0.598, 2.05, 1.06, 1.29, 1.06, 3.14, 1.29];
  const d = x.map((v, i) => v - y[i]!);

  it("matches the SciPy documentation example exactly", () => {
    const w = wilcoxonSignedRank(d)!;
    expect(w.n).toBe(9);
    expect(w.wPlus).toBe(40);
    expect(w.wMinus).toBe(5);
    expect(w.method).toBe("exact");
    expect(w.p).toBeCloseTo(0.0390625, 12);
  });

  it("is symmetric under negating the differences", () => {
    const w = wilcoxonSignedRank(d.map((v) => -v))!;
    expect(w.wPlus).toBe(5);
    expect(w.p).toBeCloseTo(0.0390625, 12);
  });

  it("smallest exact p-values: n=5 and n=6, all positive", () => {
    expect(wilcoxonSignedRank([1, 2, 3, 4, 5])!.p).toBeCloseTo(0.0625, 12);
    expect(wilcoxonSignedRank([1, 2, 3, 4, 5, 6])!.p).toBeCloseTo(0.03125, 12);
  });

  it("balanced differences give p = 1", () => {
    // ranks 1..4 with signs + - - + : W+ = 5 = n(n+1)/4 (the mean), p = 1
    expect(wilcoxonSignedRank([1, -2, -3, 4])!.p).toBe(1);
  });

  it("drops zero differences", () => {
    const w = wilcoxonSignedRank([0, 0, ...d])!;
    expect(w.n).toBe(9);
    expect(w.p).toBeCloseTo(0.0390625, 12);
    expect(wilcoxonSignedRank([0, 0, 0])).toBeNull();
    expect(wilcoxonSignedRank([])).toBeNull();
  });

  it("uses midranks for ties (exact conditional test)", () => {
    // |d| = 1,1,2: midranks 1.5,1.5,3. Signs all +: W+ = 6. Of the 8 sign patterns only
    // {+++} reaches 6 and {---} gives 0, so two-sided p = 2/8 = 0.25.
    const w = wilcoxonSignedRank([1, -1, 2].map((v) => Math.abs(v)))!;
    expect(w.wPlus).toBe(4.5 + 1.5);
    expect(w.p).toBeCloseTo(0.25, 12);
    // n = 3 one negative of rank 1.5: W+ = 4.5, patterns with W+ <= 4.5: {}=0,{1.5}=1.5,{1.5'}=1.5,{3}=3,{1.5,1.5'}=3,{1.5,3}=4.5 x2 -> 7 of 8 ... check against brute force
    const brute = (ds: number[]) => {
      const a = ds.map(Math.abs);
      const order = [...a].sort((p, q) => p - q);
      const ranks = a.map((v) => {
        const first = order.indexOf(v);
        const last = order.lastIndexOf(v);
        return (first + last) / 2 + 1;
      });
      const obs = ds.reduce((s, v, i) => s + (v > 0 ? ranks[i]! : 0), 0);
      let le = 0;
      let ge = 0;
      for (let m = 0; m < 1 << ds.length; m++) {
        let s = 0;
        for (let i = 0; i < ds.length; i++) if (m & (1 << i)) s += ranks[i]!;
        if (s <= obs + 1e-9) le++;
        if (s >= obs - 1e-9) ge++;
      }
      return Math.min(1, (2 * Math.min(le, ge)) / (1 << ds.length));
    };
    for (const ds of [[1, -1, 2], [3, -3, 3, 2, -1, 1], [0.5, 0.5, -0.5, 1, 2, -2, 3], [5, 4, 3, 2, 1, -1.5, 0.25]]) {
      expect(wilcoxonSignedRank(ds)!.p).toBeCloseTo(brute(ds), 12);
    }
  });

  it("uses the normal approximation beyond n = 50", () => {
    const n = 60;
    const ds = Array.from({ length: n }, (_, i) => (i % 3 === 0 ? -(i + 1) : i + 1));
    const w = wilcoxonSignedRank(ds)!;
    expect(w.method).toBe("normal");
    const mu = (n * (n + 1)) / 4;
    const v = (n * (n + 1) * (2 * n + 1)) / 24;
    const diff = w.wPlus - mu;
    const z = (diff + (diff > 0 ? -0.5 : 0.5)) / Math.sqrt(v);
    expect(w.p).toBeCloseTo(2 * normalCdf(-Math.abs(z)), 12);
    expect(w.wPlus + w.wMinus).toBe((n * (n + 1)) / 2);
  });

  it("agrees with the normal approximation at n = 50 within a few percent", () => {
    const ds = Array.from({ length: 50 }, (_, i) => (i % 3 === 0 ? -(i + 1) : i + 1));
    const exact = wilcoxonSignedRank(ds)!;
    expect(exact.method).toBe("exact");
    const n = 50;
    const mu = (n * (n + 1)) / 4;
    const sdv = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24);
    const diff = exact.wPlus - mu;
    const approx = 2 * normalCdf(-Math.abs((diff + (diff > 0 ? -0.5 : 0.5)) / sdv));
    expect(Math.abs(exact.p - approx) / approx).toBeLessThan(0.05);
  });

  it("ignores non-finite values", () => {
    expect(wilcoxonSignedRank([NaN, Infinity, 1, 2, 3, 4, 5])!.n).toBe(5);
  });
});

describe("PRNG and bootstrap", () => {
  it("mulberry32 is deterministic, in [0,1) and roughly uniform", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 10000 }, () => a());
    expect(xs.every((v) => v === b() && v >= 0 && v < 1)).toBe(true);
    expect(mean(xs)).toBeGreaterThan(0.49);
    expect(mean(xs)).toBeLessThan(0.51);
    // variance of U(0,1) = 1/12
    expect(sd(xs) ** 2).toBeCloseTo(1 / 12, 2);
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it("mulberry32 regression values (pinned from this implementation; the algorithm is the public-domain reference)", () => {
    const r = mulberry32(0x0a1042);
    expect([r(), r(), r()].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0.81019, 0.18911, 0.751562]);
  });

  it("bootstrap means centre on the sample mean with sd close to sd/sqrt(n)", () => {
    const xs = [1, 2, 3, 4, 5];
    const bm = bootstrapMeans(xs, 20000, 7);
    expect(mean(bm)).toBeCloseTo(3, 1);
    // population sd of the sample is sqrt(2); standard error of the mean of n=5 is sqrt(2)/sqrt(5) = 0.6325
    expect(Math.sqrt(sd(bm) ** 2)).toBeCloseTo(Math.sqrt(2 / 5), 1);
  });

  it("paired bootstrap CI: reproducible, contains the mean, degenerate for constants", () => {
    const diffs = [2, 3, -1, 4, 5, 1, 2, 6, 0, 3];
    const a = pairedBootstrapCI(diffs, 2000, 99)!;
    const b = pairedBootstrapCI(diffs, 2000, 99)!;
    expect(a).toEqual(b);
    expect(a.lo).toBeLessThan(a.mean);
    expect(a.hi).toBeGreaterThan(a.mean);
    expect(a.mean).toBeCloseTo(2.5, 12);
    expect(pairedBootstrapCI(diffs, 2000, 100)).not.toEqual(a);
    const c = pairedBootstrapCI([2, 2, 2, 2], 500, 1)!;
    expect([c.lo, c.hi]).toEqual([2, 2]);
    expect(pairedBootstrapCI([1], 100, 1)).toBeNull();
    expect(pairedBootstrapCI([], 100, 1)).toBeNull();
  });

  it("paired bootstrap CI is close to the normal-theory interval for a symmetric sample", () => {
    // [1..5]: mean 3, sample sd 1.5811, normal-theory 95% interval of the mean about 3 +/- 1.96*0.6325 = [1.76, 4.24]
    const ci = pairedBootstrapCI([1, 2, 3, 4, 5], 2000, 3)!;
    expect(ci.lo).toBeGreaterThan(1.6);
    expect(ci.lo).toBeLessThan(2.1);
    expect(ci.hi).toBeGreaterThan(3.9);
    expect(ci.hi).toBeLessThan(4.4);
  });

  it("paired bootstrap CI narrows with more pairs", () => {
    const small = pairedBootstrapCI([1, 3, 2, 4], 2000, 5)!;
    const big = pairedBootstrapCI([1, 3, 2, 4, 1, 3, 2, 4, 1, 3, 2, 4, 1, 3, 2, 4], 2000, 5)!;
    expect(big.hi - big.lo).toBeLessThan(small.hi - small.lo);
  });
});
