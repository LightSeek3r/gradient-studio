// Unit and property tests for src/tolerance.ts and the D8 selection rules built
// on it (docs/DETERMINISM.md).
import { describe, expect, it } from "vitest";
import { hueArcEnds } from "../src/gradient-engine";
import { EPS, approxEq, argBest, argBestBy, definitelyGreater, definitelyLess, quantize, roundHalfUp, tolerance } from "../src/tolerance";
import { mulberry32 } from "../scripts/vector-lib";

describe("tolerance helpers", () => {
  it("EPS is 1e-9, relative above magnitude 1 and absolute below", () => {
    expect(EPS).toBe(1e-9);
    expect(tolerance(0.5, 0.25)).toBe(1e-9);
    expect(tolerance(360, 359)).toBeCloseTo(360e-9, 20);
    expect(tolerance(-200, 3)).toBeCloseTo(200e-9, 20);
  });

  it("approxEq", () => {
    expect(approxEq(1, 1 + 5e-10)).toBe(true);
    expect(approxEq(1, 1 + 2e-9)).toBe(false);
    expect(approxEq(142.49533888781002, 142.4953388878099)).toBe(true);
    expect(approxEq(0, 1e-10)).toBe(true);
    expect(approxEq(0, 1e-8)).toBe(false);
    expect(approxEq(NaN, NaN)).toBe(false);
    expect(approxEq(NaN, 1)).toBe(false);
    expect(approxEq(Infinity, Infinity)).toBe(false); // |∞ - ∞| is NaN
  });

  it("definitelyLess / definitelyGreater exclude ties", () => {
    expect(definitelyLess(1, 1 + 1e-12)).toBe(false);
    expect(definitelyLess(1, 1.1)).toBe(true);
    expect(definitelyGreater(1 + 1e-12, 1)).toBe(false);
    expect(definitelyGreater(2, 1)).toBe(true);
  });

  it("argBest: lowest index among values within EPS of the extreme", () => {
    expect(argBest([3, 1, 2], "min")).toBe(1);
    expect(argBest([3, 1, 2], "max")).toBe(0);
    // The later value is larger by noise only: the earlier index wins.
    expect(argBest([0.5, 0.5 + 1e-15, 0.1], "max")).toBe(0);
    expect(argBest([0.5 + 1e-15, 0.5, 0.1], "max")).toBe(0);
    expect(argBest([0.2, 0.1 + 1e-15, 0.1], "min")).toBe(1);
    // A real difference is still a difference.
    expect(argBest([0.5, 0.5 + 1e-6], "max")).toBe(1);
    // NaN is ignored; nothing at all gives -1.
    expect(argBest([NaN, 2, NaN, 3], "max")).toBe(3);
    expect(argBest([NaN, NaN], "min")).toBe(-1);
    expect(argBest([], "min")).toBe(-1);
    expect(argBestBy([{ c: 2 }, { c: 1 }, { c: 1 + 1e-14 }], (x) => x.c, "min")).toBe(1);
  });

  it("roundHalfUp: values within EPS of k + 0.5 round up, like an exact half", () => {
    expect(roundHalfUp(12.5)).toBe(13);
    expect(roundHalfUp(12.499999999999998)).toBe(13);
    expect(roundHalfUp(12.500000000000002)).toBe(13);
    expect(roundHalfUp(12.49)).toBe(12);
    expect(roundHalfUp(-2.5)).toBe(-2);
    expect(roundHalfUp(-2.5000000000000004)).toBe(-2);
    expect(roundHalfUp(7)).toBe(7);
    expect(roundHalfUp(0.4)).toBe(0);
  });

  it("quantize collapses noise and keeps real differences", () => {
    expect(quantize(1 / 3)).toBe(quantize(0.3333333333333333 + 1e-16));
    expect(quantize(0.1)).not.toBe(quantize(0.1 + 1e-8));
  });
});

describe("D8 property: selections do not move under 1e-12 perturbations", () => {
  const rand = mulberry32(0xd8d8d8);
  const jitter = (x: number) => x + (rand() * 2 - 1) * 1e-12;

  it("argBest over values with planted ties", () => {
    for (let t = 0; t < 2000; t++) {
      const n = 2 + Math.floor(rand() * 8);
      const base = Array.from({ length: n }, () => Math.round(rand() * 4) / 4); // many exact ties
      for (const mode of ["min", "max"] as const) {
        const want = argBest(base, mode);
        // The rule itself: the lowest index holding the extreme value.
        const extreme = mode === "min" ? Math.min(...base) : Math.max(...base);
        expect(want).toBe(base.indexOf(extreme));
        for (let r = 0; r < 5; r++) expect(argBest(base.map(jitter), mode)).toBe(want);
      }
    }
  });

  it("hueArcEnds over hue sets with planted equal hues (also at the 0/360 seam)", () => {
    const palette = [0, 0.5, 40, 120, 142.49533888781, 200, 300, 359.9999999999995];
    for (let t = 0; t < 3000; t++) {
      const n = 2 + Math.floor(rand() * 6);
      const hues = Array.from({ length: n }, () => palette[Math.floor(rand() * palette.length)]);
      const ends = (hs: number[]) => {
        const byHue = hs.map((_, i) => i).sort((a, b) => hs[a] - hs[b] || a - b);
        return hueArcEnds(byHue, (i) => hs[i]);
      };
      const want = ends(hues);
      const wrapped = (h: number) => ((h % 360) + 360) % 360;
      for (let r = 0; r < 5; r++) expect(ends(hues.map((h) => wrapped(jitter(h))))).toEqual(want);
    }
  });

  it("hueArcEnds rule: start = lowest index of its tie group, end = highest index of its tie group", () => {
    const ends = (hs: number[]) => {
      const byHue = hs.map((_, i) => i).sort((a, b) => hs[a] - hs[b] || a - b);
      return hueArcEnds(byHue, (i) => hs[i]);
    };
    // One group (all hues equal, arc 0): lowest and highest index.
    expect(ends([142.5, 142.5 + 1e-13, 142.5 - 1e-13])).toEqual([0, 2]);
    // Two groups 100° apart: the arc runs from group {1,3} (hue 10) to group {0,2} (hue 110).
    expect(ends([110, 10, 110 - 1e-13, 10 + 1e-13])).toEqual([1, 2]);
    // A group straddling the 0°/360° seam is one group.
    expect(ends([359.9999999999999, 0.0000000000001, 90])).toEqual([0, 2]);
    // Three hues 120° apart: all gaps tie, the lowest start index wins.
    expect(ends([0, 120, 240])).toEqual([0, 2]);
    expect(ends([120, 240, 0 + 1e-13])).toEqual([0, 2]);
    // Without ties the old rule: stop after the largest gap, stop before it.
    expect(ends([10, 50, 30])).toEqual([0, 1]);
  });
});
