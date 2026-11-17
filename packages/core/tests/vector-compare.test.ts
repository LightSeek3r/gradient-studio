import { describe, expect, it } from "vitest";
import { firstDifference } from "./vector-compare";

describe("vector comparison", () => {
  it("accepts last-digit float noise (the Node 22 vs Node 24 case)", () => {
    expect(firstDifference({ worstDip: 0.6492378126457392 }, { worstDip: 0.6492378126457399 })).toBeNull();
    expect(firstDifference([0.1 + 0.2], [0.3])).toBeNull();
    expect(firstDifference(1e-12, 2e-12)).toBeNull(); // below the absolute floor of the scale
  });

  it("rejects a float change that is real", () => {
    expect(firstDifference({ x: 0.65 }, { x: 0.66 })).toContain("$.x");
    expect(firstDifference(0.6492378126, 0.6492378226)).not.toBeNull();
  });

  it("never lets an integer drift: scores, indices and positions are exact", () => {
    expect(firstDifference({ score: 82 }, { score: 81 })).toContain("$.score");
    expect(firstDifference({ stops: [1, 2] }, { stops: [1, 3] })).toContain("$.stops[1]");
    expect(firstDifference(100, 100)).toBeNull();
  });

  it("is exact for strings, booleans, null and codes", () => {
    expect(firstDifference("#799600", "#00a600")).not.toBeNull();
    expect(firstDifference({ code: "hue/wide-arc" }, { code: "hue/wide-arc" })).toBeNull();
    expect(firstDifference({ a: true }, { a: false })).not.toBeNull();
    expect(firstDifference(null, 0)).not.toBeNull();
    expect(firstDifference(NaN, NaN)).toBeNull();
    expect(firstDifference(NaN, 1)).not.toBeNull();
    expect(firstDifference(Infinity, 1e308)).not.toBeNull();
  });

  it("is exact about structure: lengths, key sets and key order", () => {
    expect(firstDifference([1, 2], [1, 2, 3])).toContain("length");
    expect(firstDifference({ a: 1 }, { a: 1, b: 2 })).toContain("keys");
    expect(firstDifference({ a: 1, b: 2 }, { b: 2, a: 1 })).toContain("keys");
    expect(firstDifference([], {})).toContain("array vs object");
  });

  it("ignores the powerless hue of an achromatic colour, but not of a chromatic one", () => {
    const grey = { L: 0.6, C: 4e-17, h: 89.87556292373665 };
    expect(firstDifference(grey, { ...grey, h: 89.87556306659991 })).toBeNull();
    expect(firstDifference(grey, { ...grey, h: 12 })).toBeNull(); // meaningless whatever its value
    expect(firstDifference({ L: 0.6, C: 0.2, h: 89.9 }, { L: 0.6, C: 0.2, h: 89.8 })).toContain("$.h");
    expect(firstDifference({ L: 0.6, C: 0.2, h: 89.9 }, { L: 0.6, C: 0.2000001, h: 89.9 })).not.toBeNull();
    // Lightness and chroma of the grey are still compared.
    expect(firstDifference(grey, { ...grey, L: 0.7 })).toContain("$.L");
  });

  it("reports the path of the first difference", () => {
    expect(firstDifference({ a: [{ b: "x" }] }, { a: [{ b: "y" }] })).toBe('$.a[0].b: "x" !== "y"');
  });
});
