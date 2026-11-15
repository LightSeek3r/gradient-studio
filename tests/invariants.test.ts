// Invariants of the frozen v1 engine (Phase 0b): findings bookkeeping and
// location, permutation invariance, refine monotonicity and the no-NaN
// contract. They run over the whole characterisation corpus (spec/vectors) plus
// seeded random gradients.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildGradientCSS,
  buildMultiGradientStyle,
  colorAtPosition,
  hexToOklch,
  interpolateGradient,
  oklchToHex,
  refineGradient,
  scoreGradient,
  suggestGradient,
  type Finding,
  type GradientScore,
  type GradientTick,
} from "../src/gradient-engine";
import { V1_FINDING_CODES, V1_MODEL } from "../src/scoring-model-v1";
import { mulberry32, type ScoreCase } from "../scripts/vector-lib";

// ── Corpus ────────────────────────────────────────────────────────────────────

const vectorCorpus: GradientTick[][] = (
  JSON.parse(readFileSync(new URL("../spec/vectors/v1-score.json", import.meta.url), "utf-8")) as {
    cases: ScoreCase[];
  }
).cases.map((c) => c.stops.map((s) => ({ ...s })));

function randomHex(rand: () => number): string {
  const byte = () => Math.floor(rand() * 256);
  return "#" + [byte(), byte(), byte()].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function randomGradient(rand: () => number): GradientTick[] {
  const n = 2 + Math.floor(rand() * 9);
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    color: randomHex(rand),
    // Integers make ties (hard stops) common, which is the interesting case.
    position: Math.round(rand() * 100),
  }));
}

const rand = mulberry32(0x0b0b);
const randomCorpus = Array.from({ length: 1000 }, () => randomGradient(rand));
const scorable = [...vectorCorpus, ...randomCorpus].filter((g) => scoreGradient(g).status === "ok");

const WEIGHT = {
  lightness: V1_MODEL.weights.lightness,
  hue: V1_MODEL.weights.hue,
  chroma: V1_MODEL.weights.chroma,
  rhythm: V1_MODEL.weights.rhythm,
} as const;
const detailOf = (r: GradientScore, d: keyof typeof WEIGHT) =>
  d === "rhythm" ? r.details.spacing : r.details[d];

const sortedByPosition = (g: GradientTick[]) => [...g].sort((a, b) => a.position - b.position);

/** A random permutation that keeps the relative order of stops sharing a position. */
function tiePreservingShuffle(g: GradientTick[], r: () => number): GradientTick[] {
  const out = [...g];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  // Re-impose the original order within each group of equal positions.
  const groups = new Map<number, GradientTick[]>();
  for (const t of g) groups.set(t.position, [...(groups.get(t.position) ?? []), t]);
  const next = new Map<number, number>();
  return out.map((t) => {
    const k = next.get(t.position) ?? 0;
    next.set(t.position, k + 1);
    return groups.get(t.position)![k];
  });
}

// ── Findings bookkeeping ──────────────────────────────────────────────────────

describe("findings invariants (whole vector corpus + 1000 random)", () => {
  it("covers a meaningful corpus", () => {
    expect(scorable.length).toBeGreaterThan(1200);
  });

  it("issues === findings.map(message), every finding well-formed and coded", () => {
    for (const g of scorable) {
      const r = scoreGradient(g);
      expect(r.issues).toEqual(r.findings.map((f) => f.message));
      const codes = new Set<string>();
      for (const f of r.findings) {
        expect(V1_FINDING_CODES[f.code]).toBe(f.dimension);
        expect(["info", "warning", "error"]).toContain(f.severity);
        expect(f.pointsLost).toBeGreaterThan(0);
        expect(Number.isInteger(f.pointsLost)).toBe(true);
        expect(f.message.length).toBeGreaterThan(0);
        // Each rule emits at most one finding (its tiers are exclusive).
        expect(codes.has(f.code)).toBe(false);
        codes.add(f.code);
      }
    }
  });

  it("per dimension: budget - detail === min(budget, sum of pointsLost); unclamped => sum === 100 - score", () => {
    let clamped = 0;
    for (const g of scorable) {
      const r = scoreGradient(g);
      let anyClamp = false;
      for (const d of Object.keys(WEIGHT) as (keyof typeof WEIGHT)[]) {
        const lost = r.findings.filter((f) => f.dimension === d).reduce((a, f) => a + f.pointsLost, 0);
        expect(WEIGHT[d] - detailOf(r, d)).toBe(Math.min(WEIGHT[d], lost));
        if (lost > WEIGHT[d]) anyClamp = true;
      }
      const total = r.findings.reduce((a, f) => a + f.pointsLost, 0);
      if (anyClamp) {
        clamped++;
        expect(total).toBeGreaterThan(100 - r.score);
      } else {
        expect(total).toBe(100 - r.score);
      }
    }
    // The clamp branch is real and exercised (rhythm and chroma can exceed 20).
    expect(clamped).toBeGreaterThan(0);
  });

  it("locations are valid: sorted unique stop indices in range, segments on stop positions", () => {
    for (const g of scorable) {
      const r = scoreGradient(g);
      const pos = sortedByPosition(g).map((t) => t.position);
      for (const f of r.findings) {
        expect(f.stops ?? f.segment).toBeDefined();
        if (f.stops) {
          expect(f.stops.length).toBeGreaterThan(0);
          for (let i = 0; i < f.stops.length; i++) {
            expect(Number.isInteger(f.stops[i])).toBe(true);
            expect(f.stops[i]).toBeGreaterThanOrEqual(0);
            expect(f.stops[i]).toBeLessThan(g.length);
            if (i > 0) expect(f.stops[i]).toBeGreaterThan(f.stops[i - 1]);
          }
        }
        if (f.segment) {
          const [a, b] = f.segment;
          expect(a).toBeLessThanOrEqual(b);
          expect(pos).toContain(a);
          expect(pos).toContain(b);
          if (f.stops) {
            expect(a).toBe(pos[f.stops[0]]);
            expect(b).toBe(pos[f.stops[f.stops.length - 1]]);
          }
        }
      }
    }
  });

  it("every finding code is emitted somewhere in the corpus", () => {
    const seen = new Set<string>();
    for (const g of scorable) for (const f of scoreGradient(g).findings) seen.add(f.code);
    expect([...seen].sort()).toEqual(Object.keys(V1_FINDING_CODES).sort());
  });
});

// ── Location semantics on hand-built cases ────────────────────────────────────

describe("finding locations", () => {
  const t = (color: string, position: number, id = position): GradientTick => ({ id, color, position });
  const lch = (L: number, C: number, h: number) => oklchToHex({ L, C, h });
  const find = (g: GradientTick[], code: string): Finding | undefined =>
    scoreGradient(g).findings.find((f) => f.code === code);

  it("lightness/reversal points at the interior extremum", () => {
    expect(find([t("#e0e7ff", 0), t("#1e1b4b", 50), t("#c7d2fe", 100)], "lightness/reversal")).toMatchObject({
      stops: [1],
      pointsLost: 12,
    });
    const two = find([t("#ffffff", 0), t("#000000", 33), t("#ffffff", 66), t("#000000", 100)], "lightness/reversal");
    expect(two).toMatchObject({ stops: [1, 2], pointsLost: 24, message: "Lightness fluctuates (2 reversals) — creates visual noise" });
  });

  it("lightness/abrupt-jump is the first close, big jump", () => {
    expect(find([t("#000000", 0), t("#ffffff", 5), t("#888888", 100)], "lightness/abrupt-jump")).toMatchObject({
      stops: [0, 1],
      segment: [0, 5],
    });
  });

  it("lightness/uneven-speed points at the segment furthest from the mean speed", () => {
    // ΔE/% is far higher on 0-10 than on the two long segments.
    const f = find([t("#000000", 0), t("#ffffff", 10), t("#f4f4f4", 55), t("#e8e8e8", 100)], "lightness/uneven-speed");
    expect(f).toMatchObject({ stops: [0, 1], segment: [0, 10] });
  });

  it("hue/wide-arc spans the two stops at the ends of the enclosing arc", () => {
    // Hues 0, 200, 100 at 0/50/100: the arc runs 0 -> 200; its ends are stops 0 and 1.
    const g = [t(lch(0.6, 0.12, 0), 0), t(lch(0.6, 0.12, 200), 50), t(lch(0.6, 0.12, 100), 100)];
    expect(find(g, "hue/wide-arc")).toMatchObject({ stops: [0, 1], severity: "error", pointsLost: 20 });
  });

  it("hue/direction-reversal points at the stop where the direction turns", () => {
    const g = [t(lch(0.4, 0.12, 350), 0), t(lch(0.6, 0.12, 30), 50), t(lch(0.8, 0.12, 10), 100)];
    expect(find(g, "hue/direction-reversal")?.stops).toEqual([1]);
  });

  it("chroma/saturation-range names the most and least saturated stops", () => {
    expect(find([t("#808080", 0), t("#ff0000", 100)], "chroma/saturation-range")?.stops).toEqual([0, 1]);
  });

  it("chroma/dead-zone points at the grey stop(s)", () => {
    expect(find([t("#ff0000", 0), t("#808080", 50), t("#00ff00", 100)], "chroma/dead-zone")?.stops).toEqual([1]);
  });

  it("chroma/muddy-midpoint is the segment with the worst sRGB-midpoint dip", () => {
    const f = find([t("#ff2200", 0), t("#ff5500", 50), t("#0055ff", 100)], "chroma/muddy-midpoint");
    expect(f).toMatchObject({ stops: [1, 2], segment: [50, 100] });
  });

  it("chroma/banding is the first long low-resolution segment", () => {
    const f = find([t("#112233", 0), t("#1a2b3b", 100)], "chroma/banding");
    expect(f).toMatchObject({ segment: [0, 100], severity: "warning" });
  });

  it("rhythm rules point at the end stops / the most uneven gap", () => {
    const c0 = lch(0.55, 0.12, 200);
    const c1 = lch(0.85, 0.12, 230);
    expect(find([t(c0, 6), t(c1, 94)], "rhythm/edge-gap")?.stops).toEqual([0, 1]);
    expect(find([t(c0, 32), t(c1, 67)], "rhythm/narrow-span")).toMatchObject({ stops: [0, 1], segment: [32, 67] });
    const g = [t(c0, 0), t(lch(0.65, 0.12, 210), 10), t(lch(0.75, 0.12, 220), 20), t(c1, 100)];
    expect(find(g, "rhythm/uneven-gaps")).toMatchObject({ stops: [2, 3], segment: [20, 100] });
  });
});

// ── Permutation invariance ────────────────────────────────────────────────────

describe("permutation invariance (seeded, tie-preserving)", () => {
  // Stops that share a position keep their relative order: CSS paints them in
  // array order, so swapping them is a different gradient, not a permutation
  // of the same one.
  it("scoreGradient, suggestGradient, interpolateGradient and the CSS builders ignore array order", () => {
    const r = mulberry32(0x5eed);
    for (const g of scorable) {
      const base = scoreGradient(g);
      const baseSuggest = suggestGradient(g);
      const baseInterp = interpolateGradient(g, 9);
      const baseCss = buildGradientCSS(g, 45);
      for (let k = 0; k < 3; k++) {
        const p = tiePreservingShuffle(g, r);
        expect(scoreGradient(p)).toEqual(base);
        expect(suggestGradient(p)).toEqual(baseSuggest);
        expect(interpolateGradient(p, 9)).toEqual(baseInterp);
        expect(buildGradientCSS(p, 45)).toBe(baseCss);
      }
    }
  });

  it("with distinct positions ANY permutation is invariant", () => {
    const r = mulberry32(0xd6);
    for (let i = 0; i < 300; i++) {
      const g = randomGradient(r).map((t, k) => ({ ...t, position: t.position * 0.9 + k * 0.01 }));
      const p = tiePreservingShuffle(g, r);
      expect(scoreGradient(p)).toEqual(scoreGradient(g));
      expect(refineGradient(p)).toEqual(refineGradient(g));
    }
  });
});

// ── Refine guarantees over the corpus ─────────────────────────────────────────

describe("refine guarantees (whole vector corpus + 1000 random)", () => {
  const A = V1_MODEL.refine.achromaticAtMost;

  it("score(suggest(x)) >= score(x), and declined results are the sorted input", () => {
    for (const g of scorable) {
      const r = refineGradient(g);
      expect(r.before).toBe(scoreGradient(g).score);
      expect(r.after).toBe(scoreGradient(r.stops).score);
      expect(r.after).toBeGreaterThanOrEqual(r.before);
      expect(scoreGradient(suggestGradient(g)).score).toBeGreaterThanOrEqual(scoreGradient(g).score);
      if (!r.refined) expect(r.stops).toEqual(sortedByPosition(g));
    }
  });

  it("achromatic stops stay achromatic", () => {
    for (const g of scorable) {
      const before = sortedByPosition(g);
      const after = suggestGradient(g);
      before.forEach((s, i) => {
        if (hexToOklch(s.color).C <= A) expect(hexToOklch(after[i].color).C).toBeLessThanOrEqual(A);
      });
    }
  });

  it("hard stops stay hard: neighbours <= 1% apart keep their exact offset", () => {
    for (const g of scorable) {
      const before = sortedByPosition(g);
      const after = suggestGradient(g);
      for (let i = 1; i < before.length; i++) {
        const gap = before[i].position - before[i - 1].position;
        if (gap <= V1_MODEL.refine.hardStopGap) {
          expect(after[i].position - after[i - 1].position).toBeCloseTo(gap, 9);
        }
      }
      for (let i = 1; i < after.length; i++) expect(after[i].position).toBeGreaterThanOrEqual(after[i - 1].position);
    }
  });
});

// ── No NaN, ever ──────────────────────────────────────────────────────────────

describe("no-NaN fuzz (valid and invalid input)", () => {
  function hasNaN(v: unknown): boolean {
    if (typeof v === "number") return Number.isNaN(v);
    if (typeof v === "string") return v.includes("NaN");
    if (Array.isArray(v)) return v.some(hasNaN);
    if (v && typeof v === "object") return Object.values(v).some(hasNaN);
    return false;
  }
  const COLORS = ["#ff0000", "#FFFFFF", "#000000", "#808080", "#zzzzzz", "#abc", "", "red", "#ff000080", "ff0000", "#12345"];
  const POSITIONS = [0, 100, 50, 50, 0.5, 99.9, -5, 150, NaN, Infinity, -Infinity, 1e308];

  it("score / suggest / interpolate / colorAt / CSS never produce NaN", () => {
    const r = mulberry32(0xbad);
    for (let k = 0; k < 3000; k++) {
      const n = Math.floor(r() * 8);
      const g: GradientTick[] = Array.from({ length: n }, (_, i) => ({
        id: i,
        color: r() < 0.6 ? randomHex(r) : COLORS[Math.floor(r() * COLORS.length)],
        position: r() < 0.6 ? Math.round(r() * 1000) / 10 : POSITIONS[Math.floor(r() * POSITIONS.length)],
      }));
      const s = scoreGradient(g);
      expect(hasNaN(s)).toBe(false);
      expect(Number.isInteger(s.score)).toBe(true);
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      if (s.status === "unscorable") {
        expect(s.score).toBe(0);
        expect(suggestGradient(g)).toBe(g);
      } else {
        expect(hasNaN(suggestGradient(g))).toBe(false);
      }
      expect(hasNaN(interpolateGradient(g, 1 + Math.floor(r() * 10)))).toBe(false);
      expect(hasNaN(colorAtPosition(g, r() * 100))).toBe(false);
      expect(buildGradientCSS(g, 90)).not.toContain("NaN");
      expect(buildMultiGradientStyle(g, [{ id: 1, angle: 0, weight: 10, enabled: true }]).background).not.toContain("NaN");
    }
  });
});
