// Tests for the EXPERIMENTAL v2 prototype (src/experimental/v2.ts,
// spec/scoring-v2.md). v2 is not a contract; these tests pin its stated
// properties (determinism, bounds, invariances, the behaviours the spec
// claims) and its golden fixture spec/vectors/v2-experimental-score.json.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { V2_CONFIGS, V2_CORPUS, V2_UNSCORABLE, renderV2Vectors } from "../scripts/v2-corpus";
import { score } from "../src/api/score";
import type { GradientDocument, HueInterpolation, Interpolation } from "../src/api/types";
import { oklchToHexFitted } from "../src/color-formats";
import { V2_FINDING_CODES, V2_MODEL, fixHues, samplePathV2, scoreV2, type ScoreResultV2, type ScoreV2Options } from "../src/experimental";
import { hexToOklch, scoreGradient } from "../src/gradient-engine";
import { V1_FINDING_CODES, V1_MODEL } from "../src/scoring-model-v1";

type Ok = Extract<ScoreResultV2, { status: "ok" }>;

function ok(r: ScoreResultV2): Ok {
  if (r.status !== "ok") throw new Error(`unscorable: ${r.code} ${r.reason}`);
  return r;
}

const lin = (colors: string[], positions?: number[], interpolation?: Interpolation): GradientDocument => ({
  kind: "linear",
  angle: 90,
  stops: colors.map((color, i) => ({ color, position: positions ? positions[i] : i / (colors.length - 1) })),
  ...(interpolation ? { interpolation } : {}),
});

const SRGB: ScoreV2Options = { interpolation: { space: "srgb" } };
const OKLAB: ScoreV2Options = { interpolation: { space: "oklab" } };
const OKLCH: ScoreV2Options = { interpolation: { space: "oklch" } };
const hue = (h: HueInterpolation): ScoreV2Options => ({ interpolation: { space: "oklch", hue: h } });

const codes = (r: Ok) => r.issues.map((i) => i.code);
const issue = (r: Ok, code: string) => r.issues.find((i) => i.code === code);

/** Every number in a value is finite (recursively). */
function allFinite(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(allFinite);
  if (v && typeof v === "object") return Object.values(v).every(allFinite);
  return true;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (rnd: () => number) =>
  "#" + [0, 1, 2].map(() => Math.floor(rnd() * 256).toString(16).padStart(2, "0")).join("");

function randomDoc(rnd: () => number, maxStops = 8): GradientDocument {
  const n = 2 + Math.floor(rnd() * (maxStops - 1));
  const pos = Array.from({ length: n }, () => Math.round(rnd() * 100) / 100).sort((a, b) => a - b);
  return lin(Array.from({ length: n }, () => hex(rnd)), pos);
}

const ALL_OPTS: [string, ScoreV2Options][] = [
  ["srgb", SRGB],
  ["oklab", OKLAB],
  ["oklch shorter", OKLCH],
  ["oklch longer", hue("longer")],
  ["oklch increasing", hue("increasing")],
  ["oklch decreasing", hue("decreasing")],
  ["oklch clip", { interpolation: { space: "oklch" }, gamutMapping: "clip" }],
];

// v1 corpus (inputs only).
interface VCase {
  name: string;
  stops: { id: number; color: string; position: number }[];
}
const v1Corpus = (
  JSON.parse(readFileSync(new URL("../../../spec/vectors/v1-score.json", import.meta.url), "utf-8")) as { cases: VCase[] }
).cases;
const v1Docs = v1Corpus
  .map((c) => ({
    name: c.name,
    ticks: c.stops,
    doc: lin(
      [...c.stops].sort((a, b) => a.position - b.position).map((s) => s.color),
      [...c.stops].sort((a, b) => a.position - b.position).map((s) => s.position / 100),
    ),
  }))
  .filter((c) => score(c.doc).status === "ok");

// ── Golden fixture ──────────────────────────────────────────────────────────────

describe("v2-experimental golden fixture", () => {
  it("spec/vectors/v2-experimental-score.json matches the prototype byte for byte (npm run vectors:v2)", () => {
    const onDisk = readFileSync(new URL("../../../spec/vectors/v2-experimental-score.json", import.meta.url), "utf-8");
    expect(onDisk).toBe(renderV2Vectors());
  });

  it("rendering the fixture twice is byte-identical", () => {
    expect(renderV2Vectors()).toBe(renderV2Vectors());
  });

  it("is marked experimental and is not a v1 vector file", () => {
    const json = JSON.parse(renderV2Vectors()) as { scoringModel: string; note: string };
    expect(json.scoringModel).toBe("v2-experimental");
    expect(json.note).toMatch(/NOT part of the v1 vector set/);
  });
});

// ── Model table ─────────────────────────────────────────────────────────────────

describe("V2_MODEL and V2_FINDING_CODES", () => {
  it("is deeply frozen, versioned and flagged as not validated", () => {
    expect(Object.isFrozen(V2_MODEL)).toBe(true);
    expect(Object.isFrozen(V2_MODEL.sampling.refine)).toBe(true);
    expect(Object.isFrozen(V2_MODEL.chroma.gamut.strong)).toBe(true);
    expect(V2_MODEL.version).toBe("v2-experimental");
    expect(V2_MODEL.validated).toBe(false);
  });

  it("is a separate object from V1_MODEL", () => {
    expect(V2_MODEL as unknown).not.toBe(V1_MODEL as unknown);
  });

  it("weights equal v1's and sum to 100", () => {
    expect(V2_MODEL.weights).toEqual(V1_MODEL.weights);
    const w = V2_MODEL.weights;
    expect(w.lightness + w.hue + w.chroma + w.rhythm).toBe(100);
  });

  it("carried-over rules use exactly v1's constants: abrupt jump", () => {
    const a = V2_MODEL.lightness.abruptJump;
    const b = V1_MODEL.lightness.abruptJump;
    expect([a.code, a.maxGap, a.deltaEAbove, a.tier.penalty, a.tier.severity, a.tier.message]).toEqual([
      b.code, b.maxGap, b.deltaEAbove, b.tier.penalty, b.tier.severity, b.tier.message,
    ]);
  });

  it("carried-over rules use exactly v1's constants: saturation range and dead zone", () => {
    expect(V2_MODEL.chroma.range).toEqual(V1_MODEL.chroma.range);
    expect(V2_MODEL.chroma.coherence).toEqual(V1_MODEL.chroma.coherence);
  });

  it("carried-over rules use exactly v1's constants: rhythm", () => {
    expect(V2_MODEL.rhythm).toEqual(V1_MODEL.rhythm);
  });

  it("redefined rules keep v1's thresholds where the spec says so", () => {
    expect(V2_MODEL.lightness.contrast.invisibleBelow).toBe(V1_MODEL.lightness.contrast.invisibleBelow);
    expect(V2_MODEL.lightness.contrast.lowBelow).toBe(V1_MODEL.lightness.contrast.lowBelow);
    expect(V2_MODEL.lightness.speed.strongAbove).toBe(V1_MODEL.lightness.velocity.strongAbove);
    expect(V2_MODEL.lightness.speed.mildAbove).toBe(V1_MODEL.lightness.velocity.mildAbove);
    expect(V2_MODEL.hue.arc.clashAbove).toBe(V1_MODEL.hue.arc.clashAbove);
    expect(V2_MODEL.hue.arc.wideAbove).toBe(V1_MODEL.hue.arc.wideAbove);
    expect(V2_MODEL.hue.arc.narrowBelow).toBe(V1_MODEL.hue.arc.narrowBelow);
    expect(V2_MODEL.hue.direction.minStep).toBe(V1_MODEL.hue.direction.minStep);
    expect(V2_MODEL.hue.chromaticAbove).toBe(V1_MODEL.hue.chromaticAbove);
    expect(V2_MODEL.chroma.dip.muddyAbove).toBe(V1_MODEL.chroma.midpoint.muddyAbove);
    expect(V2_MODEL.chroma.dip.slightAbove).toBe(V1_MODEL.chroma.midpoint.slightAbove);
    expect(V2_MODEL.lightness.perceivedReversal.chromaWeight).toBe(V1_MODEL.lightness.perceivedReversal.chromaWeight);
  });

  it.each(Object.entries(V2_FINDING_CODES))("code %s is consistently namespaced", (code, info) => {
    if (info.origin === "v1-unchanged") {
      expect(V1_FINDING_CODES[code]).toBe(info.dimension);
      expect(code.startsWith("v2/")).toBe(false);
    } else {
      expect(code.startsWith("v2/")).toBe(true);
    }
    if (info.origin === "redefined") expect(V1_FINDING_CODES[info.replaces as string]).toBe(info.dimension);
    if (info.origin === "new") expect(info.replaces).toBeUndefined();
  });

  it("every v1 code is either carried over or replaced exactly once", () => {
    const covered = Object.entries(V2_FINDING_CODES).map(([code, i]) => (i.origin === "v1-unchanged" ? code : i.replaces)).filter(Boolean);
    expect([...covered].sort()).toEqual(Object.keys(V1_FINDING_CODES).sort());
  });

  it("severities follow the v1 convention (>=12 error, 6-10 warning, <=5 info)", () => {
    const tiers: { penalty: number; severity: string }[] = [];
    const walk = (v: unknown) => {
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (typeof o.penalty === "number" && typeof o.severity === "string") tiers.push(o as { penalty: number; severity: string });
        Object.values(o).forEach(walk);
      }
    };
    walk(V2_MODEL);
    expect(tiers.length).toBeGreaterThan(20);
    for (const t of tiers) expect(t.severity).toBe(t.penalty >= 12 ? "error" : t.penalty >= 6 ? "warning" : "info");
  });

  it("spec/scoring-v2.md mentions every finding code", () => {
    const spec = readFileSync(new URL("../../../spec/scoring-v2.md", import.meta.url), "utf-8");
    for (const code of Object.keys(V2_FINDING_CODES)) expect(spec).toContain("`" + code + "`");
  });
});

// ── Never throws, never NaN, result shape ───────────────────────────────────────

describe("scoreV2 robustness", () => {
  it.each(V2_CORPUS.flatMap((c) => ALL_OPTS.map(([k, o]) => [`${c.name} / ${k}`, c.doc, o] as const)))(
    "%s: ok, finite, integer score, consistent dimensions",
    (_name, doc, opts) => {
      const r = ok(scoreV2(doc, opts));
      expect(allFinite(r)).toBe(true);
      expect(Number.isInteger(r.score)).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(r.score).toBe(r.dimensions.lightness + r.dimensions.hue + r.dimensions.chroma + r.dimensions.spacing);
      expect(r.scoringModel).toBe("v2-experimental");
      for (const i of r.issues) {
        const info = V2_FINDING_CODES[i.code];
        expect(info).toBeDefined();
        expect(i.dimension).toBe(info.dimension === "rhythm" ? "spacing" : info.dimension);
        if (i.stopIndices) for (const s of i.stopIndices) expect(s).toBeGreaterThanOrEqual(0);
        if (i.segment) expect(i.segment.start).toBeLessThanOrEqual(i.segment.end);
      }
      // Clamp relation per dimension.
      const budget = { lightness: 30, hue: 30, chroma: 20, spacing: 20 } as const;
      for (const d of Object.keys(budget) as (keyof typeof budget)[]) {
        const lost = r.issues.filter((i) => i.dimension === d).reduce((a, i) => a + i.pointsLost, 0);
        expect(budget[d] - r.dimensions[d]).toBe(Math.min(budget[d], lost));
      }
    },
  );

  it.each(V2_UNSCORABLE.map((u) => [u.name, u.doc, u.code] as const))("%s is unscorable (%s)", (_n, doc, code) => {
    const r = scoreV2(doc as GradientDocument);
    expect(r.status).toBe("unscorable");
    if (r.status === "unscorable") {
      expect(r.code).toBe(code);
      expect(r.reason.length).toBeGreaterThan(0);
    }
    expect(samplePathV2(doc as GradientDocument)).toBeNull();
  });

  it("accepts exactly the v1 colour domain (opaque #rrggbb, either case)", () => {
    expect(V1_MODEL.domain.colorPattern).toBe("^#[0-9a-fA-F]{6}$");
    expect(scoreV2(lin(["#ABCDEF", "#00ff00"])).status).toBe("ok");
    for (const bad of ["#abc", "#abcdef80", "rgb(0 0 0)", " #abcdef", "#abcdeg"]) {
      const r = scoreV2(lin([bad, "#00ff00"]));
      expect(r.status === "unscorable" && r.code).toBe("invalid-color");
    }
  });

  it("never throws on garbage input", () => {
    const junk: unknown[] = [undefined, 0, "linear-gradient(red, blue)", [], { stops: "x" }, { kind: "linear", stops: [1, 2] }, { kind: "linear", stops: [{}, {}] }];
    for (const j of junk) {
      expect(() => scoreV2(j as GradientDocument)).not.toThrow();
      expect(scoreV2(j as GradientDocument).status).toBe("unscorable");
    }
    expect(() => scoreV2(lin(["#ff0000", "#0000ff"]), { interpolation: { space: "lab" } as unknown as Interpolation })).not.toThrow();
    expect(scoreV2(lin(["#ff0000", "#0000ff"]), { interpolation: { space: "oklch", hue: "sideways" } as unknown as Interpolation }).status).toBe("unscorable");
  });

  it("fuzz: 300 random documents x 4 interpolations are finite and bounded", () => {
    const rnd = mulberry32(42);
    const opts = [SRGB, OKLAB, OKLCH, hue("longer")];
    for (let k = 0; k < 300; k++) {
      const doc = randomDoc(rnd);
      const r = ok(scoreV2(doc, opts[k % 4]));
      expect(allFinite(r)).toBe(true);
      expect(r.measurements.sampleCount).toBeLessThanOrEqual(516 + 10 * doc.stops.length);
    }
  });
});

// ── Determinism and bounded cost ────────────────────────────────────────────────

describe("determinism and bounded sampling", () => {
  it.each(V2_CORPUS.map((c) => [c.name, c.doc] as const))("%s: identical results on repeated calls (all configs)", (_n, doc) => {
    for (const cfg of V2_CONFIGS) expect(scoreV2(doc, cfg.opts)).toEqual(scoreV2(doc, cfg.opts));
  });

  it("does not mutate its input", () => {
    const doc = lin(["#ff0000", "#00ff00", "#0000ff"], undefined, { space: "oklch", hue: "longer" });
    const copy = JSON.parse(JSON.stringify(doc));
    scoreV2(doc);
    samplePathV2(doc);
    expect(doc).toEqual(copy);
  });

  it.each([2, 3, 8, 16, 32, 64])("%i stops: sample count within 516 + 10n and refinement within its cap", (n) => {
    const rnd = mulberry32(n);
    for (const opts of [SRGB, OKLCH, hue("longer"), hue("increasing")]) {
      const doc = lin(Array.from({ length: n }, () => hex(rnd)));
      const r = ok(scoreV2(doc, opts));
      expect(r.measurements.sampleCount).toBeLessThanOrEqual(516 + 10 * n);
      expect(r.measurements.refinedSamples).toBeLessThanOrEqual(V2_MODEL.sampling.refine.maxExtraSamples);
      expect(samplePathV2(doc, opts)?.length).toBe(r.measurements.sampleCount);
    }
  });

  it("a long 2-stop sRGB gradient uses exactly the base grid (257 samples, no refinement)", () => {
    const r = ok(scoreV2(lin(["#ff0000", "#0000ff"]), SRGB));
    expect(r.measurements.sampleCount).toBe(257);
    expect(r.measurements.refinedSamples).toBe(0);
  });

  it("8 stops in oklch longer: median runtime well under budget", () => {
    const doc = lin(["#ff0000", "#ff8800", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#8800ff", "#ff00ff"]);
    for (let k = 0; k < 5; k++) scoreV2(doc, hue("longer"));
    const times: number[] = [];
    for (let k = 0; k < 15; k++) {
      const t0 = performance.now();
      scoreV2(doc, hue("longer"));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    // Target is < 5 ms on the built package (docs/v2-experiments.md); the test
    // allows for an instrumented, parallel test runner.
    expect(times[7]).toBeLessThan(40);
  });

  it("samples are ordered by position and lie within the stop span", () => {
    for (const { doc } of V2_CORPUS) {
      const s = samplePathV2(doc, OKLCH) as NonNullable<ReturnType<typeof samplePathV2>>;
      for (let k = 1; k < s.length; k++) expect(s[k].t).toBeGreaterThanOrEqual(s[k - 1].t);
    }
  });
});

// ── Invariances ─────────────────────────────────────────────────────────────────

describe("invariances", () => {
  const methods: HueInterpolation[] = ["shorter", "longer", "increasing", "decreasing"];

  it.each(methods)("fixHues(%s) is invariant under rotating both hues by ±360", (m) => {
    const rnd = mulberry32(7);
    for (let k = 0; k < 200; k++) {
      const h1 = rnd() * 360;
      const h2 = rnd() * 360;
      const [a, b] = fixHues(h1, h2, m);
      const [c, d] = fixHues(h1 + 360, h2 + 360, m);
      const [e, f] = fixHues(h1 - 360, h2 - 360, m);
      expect(d - c).toBeCloseTo(b - a, 9);
      expect(f - e).toBeCloseTo(b - a, 9);
    }
  });

  it.each(methods)("fixHues(%s) travel stays in the CSS Color 4 range", (m) => {
    const rnd = mulberry32(11);
    for (let k = 0; k < 200; k++) {
      const [a, b] = fixHues(rnd() * 360, rnd() * 360, m);
      const travel = b - a;
      if (m === "shorter") expect(Math.abs(travel)).toBeLessThanOrEqual(180);
      if (m === "longer") {
        expect(Math.abs(travel)).toBeGreaterThanOrEqual(180);
        expect(Math.abs(travel)).toBeLessThanOrEqual(360);
      }
      if (m === "increasing") expect(travel).toBeGreaterThanOrEqual(0);
      if (m === "decreasing") expect(travel).toBeLessThanOrEqual(0);
    }
  });

  it("stops built from OKLCH hue h and h + 360 give identical scores", () => {
    for (const h of [10, 95, 200, 300]) {
      const a = [oklchToHexFitted({ L: 0.7, C: 0.12, h }), oklchToHexFitted({ L: 0.5, C: 0.15, h: h + 90 })];
      const b = [oklchToHexFitted({ L: 0.7, C: 0.12, h: h + 360 }), oklchToHexFitted({ L: 0.5, C: 0.15, h: h + 450 })];
      for (const opts of [SRGB, OKLCH, hue("longer")]) expect(scoreV2(lin(b), opts)).toEqual(scoreV2(lin(a), opts));
    }
  });

  it.each([
    ["A B A", ["#ff0000", "#0000ff", "#ff0000"], [0, 0.5, 1]],
    ["A B C B A", ["#0ea5e9", "#22c55e", "#facc15", "#22c55e", "#0ea5e9"], [0, 0.2, 0.5, 0.8, 1]],
    ["grey sandwich", ["#ff0066", "#808080", "#ff0066"], [0, 0.5, 1]],
    ["dark band", ["#ffffff", "#000000", "#ffffff"], [0.1, 0.5, 0.9]],
  ] as const)("reversing a symmetric gradient (%s) keeps score and findings", (_n, colors, pos) => {
    const doc = lin([...colors], [...pos]);
    const rev = lin([...colors].reverse(), [...pos].reverse().map((p) => 1 - p));
    for (const [, opts] of ALL_OPTS) {
      const a = ok(scoreV2(doc, opts));
      const b = ok(scoreV2(rev, opts));
      expect(b.score).toBe(a.score);
      expect(codes(b).sort()).toEqual(codes(a).sort());
    }
  });

  it.each([
    ["red-green", "#ff0000", "#00ff00"],
    ["blue-yellow", "#0000ff", "#ffff00"],
    ["teal-orange", "#0d9488", "#f97316"],
  ] as const)("reversing a 2-stop gradient (%s) keeps the score in srgb, oklab and oklch shorter", (_n, a, b) => {
    for (const opts of [SRGB, OKLAB, OKLCH]) {
      expect(ok(scoreV2(lin([b, a]), opts)).score).toBe(ok(scoreV2(lin([a, b]), opts)).score);
    }
  });

  it("A→B increasing equals B→A decreasing (same path, reversed)", () => {
    for (const [a, b] of [["#ff0000", "#00ff00"], ["#db6468", "#b76ec7"], ["#0ea5e9", "#f43f5e"]]) {
      const x = ok(scoreV2(lin([a, b]), hue("increasing")));
      const y = ok(scoreV2(lin([b, a]), hue("decreasing")));
      expect(y.score).toBe(x.score);
      expect(y.measurements.visitedHueArc).toBeCloseTo(x.measurements.visitedHueArc as number, 6);
    }
  });

  it("permuting identical duplicate stops changes nothing", () => {
    const doc = lin(["#ff0000", "#ff0000", "#00ff00", "#0000ff"], [0, 0, 0.5, 1]);
    const perm = { ...doc, stops: [doc.stops[1], doc.stops[0], doc.stops[2], doc.stops[3]] };
    expect(scoreV2(perm, OKLCH)).toEqual(scoreV2(doc, OKLCH));
  });

  it("stop order follows CSS: an out-of-order position is raised (permutation = different rendering)", () => {
    const shuffled = lin(["#ff0000", "#00ff00", "#0000ff"], [0.6, 0.2, 1]);
    const raised = lin(["#ff0000", "#00ff00", "#0000ff"], [0.6, 0.6, 1]);
    expect(scoreV2(shuffled, OKLAB)).toEqual(scoreV2(raised, OKLAB));
  });

  it("explicit positions equal to the auto positions give the same result", () => {
    const auto: GradientDocument = { kind: "linear", angle: 180, stops: [{ color: "#4f46e5" }, { color: "#06b6d4" }, { color: "#22c55e" }] };
    expect(scoreV2(auto, OKLCH)).toEqual(scoreV2({ ...lin(["#4f46e5", "#06b6d4", "#22c55e"]), angle: 180 }, OKLCH));
  });

  it("the angle does not affect the score", () => {
    const d = lin(["#f97316", "#db2777", "#7c3aed"]);
    expect(scoreV2({ ...d, angle: 0 }, OKLCH)).toEqual(scoreV2({ ...d, angle: 135 }, OKLCH));
  });
});

// ── Agreement with v1 (srgb) ────────────────────────────────────────────────────

describe("v2 under srgb vs v1", () => {
  it("rules carried over unchanged agree with v1 on every scorable v1 corpus case (all spaces)", () => {
    const unchanged = Object.entries(V2_FINDING_CODES).filter(([, i]) => i.origin === "v1-unchanged").map(([c]) => c);
    let checked = 0;
    for (const c of v1Docs) {
      const v1 = score(c.doc);
      if (v1.status !== "ok") continue;
      for (const opts of [SRGB, OKLAB, OKLCH]) {
        const v2 = ok(scoreV2(c.doc, opts));
        for (const code of unchanged) {
          const a = v1.issues.find((i) => i.code === code);
          const b = issue(v2, code);
          expect(b?.pointsLost, `${c.name} ${code}`).toBe(a?.pointsLost);
          if (a && b) expect(b.stopIndices).toEqual(a.stopIndices);
        }
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(250);
  });

  it("srgb banding levels equal v1's segmentRgbSteps on every scorable v1 corpus case (gap > 0)", () => {
    for (const c of v1Docs) {
      const v1 = scoreGradient(c.ticks.map((s) => ({ ...s })));
      const v2 = ok(scoreV2(c.doc, SRGB));
      const steps = v1.details.measurements?.segmentRgbSteps ?? [];
      expect(v2.measurements.segmentLevels.length).toBe(steps.length);
      const gaps = v1.details.measurements?.segmentGaps ?? [];
      // A zero-width segment (hard stop) is a jump, not a path: 0 levels in v2.
      v2.measurements.segmentLevels.forEach((lv, i) => expect(lv).toBeCloseTo(gaps[i] > 0 ? steps[i] : 0, 6));
    }
  });

  it("v2 srgb and v1 rank the corpus similarly (Spearman ρ > 0.9)", () => {
    const rank = (xs: number[]) => {
      const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
      const r: number[] = new Array(xs.length);
      for (let k = 0; k < idx.length; ) {
        let j = k;
        while (j + 1 < idx.length && idx[j + 1][0] === idx[k][0]) j++;
        for (let m = k; m <= j; m++) r[idx[m][1]] = (k + j) / 2;
        k = j + 1;
      }
      return r;
    };
    const a = v1Docs.map((c) => (score(c.doc) as { score: number }).score);
    const b = v1Docs.map((c) => ok(scoreV2(c.doc, SRGB)).score);
    const ra = rank(a);
    const rb = rank(b);
    const m = (ra.length - 1) / 2;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < ra.length; i++) {
      num += (ra[i] - m) * (rb[i] - m);
      da += (ra[i] - m) ** 2;
      db += (rb[i] - m) ** 2;
    }
    expect(num / Math.sqrt(da * db)).toBeGreaterThan(0.9);
  });

  // Curated pairs: [better, worse] by v1; v2 under srgb must agree on the direction.
  it.each([
    ["black-white beats near-identical", ["#000000", "#ffffff"], ["#336699", "#346699"]],
    ["ocean beats red-green", ["#0ea5e9", "#1e3a8a"], ["#ff0000", "#00ff00"]],
    ["mint beats a lightness dip", ["#a7f3d0", "#047857"], ["#e0e7ff", "#1e1b4b", "#c7d2fe"]],
    ["sunset beats an RGB rainbow", ["#f97316", "#db2777", "#7c3aed"], ["#ff0000", "#00ff00", "#0000ff"]],
    ["indigo-cyan beats navy banding", ["#4f46e5", "#06b6d4"], ["#112233", "#1a2b3b"]],
    ["two blues beat red-grey-green", ["#3b82f6", "#1d4ed8"], ["#ff0000", "#808080", "#00ff00"]],
  ] as const)("same direction of judgement: %s", (_n, better, worse) => {
    const v1b = (score(lin([...better])) as { score: number }).score;
    const v1w = (score(lin([...worse])) as { score: number }).score;
    expect(v1b).toBeGreaterThan(v1w);
    expect(ok(scoreV2(lin([...better]), SRGB)).score).toBeGreaterThan(ok(scoreV2(lin([...worse]), SRGB)).score);
  });

  // Documented differences (spec/scoring-v2.md §4, docs/v2-experiments.md).
  it("differs by design: the sRGB red→green dip between the stops is a lightness reversal in v2, not in v1", () => {
    const v1 = score(lin(["#ff0000", "#00ff00"]));
    expect(v1.status === "ok" && v1.issues.some((i) => i.code === "lightness/reversal")).toBe(false);
    const v2 = ok(scoreV2(lin(["#ff0000", "#00ff00"]), SRGB));
    expect(v2.measurements.lightnessReversals).toBe(1);
  });

  it("differs by design: sub-JND stop wobbles count in v1 but not in v2 (pastels)", () => {
    const doc = lin(["#fbcfe8", "#fde68a", "#bbf7d0", "#bfdbfe", "#ddd6fe", "#fecaca"]);
    const v1 = score(doc);
    const v2 = ok(scoreV2(doc, SRGB));
    expect(v1.status === "ok" && v1.score).toBeLessThan(v2.score);
  });

  it("differs by design: a 2-stop sRGB black→white is uneven in OKLAB speed (v1 needs 3 stops)", () => {
    const v2 = ok(scoreV2(lin(["#000000", "#ffffff"]), SRGB));
    expect(v2.measurements.speedCv).toBeGreaterThan(0.5);
    expect(v2.measurements.speedCv).toBeLessThanOrEqual(0.8);
    expect(ok(scoreV2(lin(["#000000", "#ffffff"]), OKLAB)).measurements.speedCv).toBeCloseTo(0, 3);
  });

  it("differs by design: sRGB blue→white drifts towards purple (unexpected hue, info)", () => {
    const r = ok(scoreV2(lin(["#0000ff", "#ffffff"]), SRGB));
    expect(r.measurements.hueExcursion).toBeGreaterThan(15);
    expect(issue(r, "v2/unexpected-hue")?.pointsLost).toBe(V2_MODEL.hue.unexpected.mild.penalty);
    expect(codes(ok(scoreV2(lin(["#0000ff", "#ffffff"]), OKLAB)))).not.toContain("v2/unexpected-hue");
  });
});

// ── Muddy midpoint ──────────────────────────────────────────────────────────────

describe("the classic muddy sRGB midpoint (red → green)", () => {
  const doc = lin(["#ff0000", "#00ff00"]);

  it("v1 flags chroma/muddy-midpoint", () => {
    const v1 = score(doc);
    expect(v1.status === "ok" && v1.issues.find((i) => i.code === "chroma/muddy-midpoint")?.pointsLost).toBe(10);
  });

  it("v2 under srgb flags the muddy tier of v2/chroma-dip", () => {
    const r = ok(scoreV2(doc, SRGB));
    expect(issue(r, "v2/chroma-dip")?.pointsLost).toBe(V2_MODEL.chroma.dip.muddy.penalty);
    expect(r.measurements.worstDip).toBeGreaterThan(0.5);
  });

  it("v2 under oklab does not flag it as muddy (the straight a/b line still loses ≈45 %: slight)", () => {
    const r = ok(scoreV2(doc, OKLAB));
    expect(issue(r, "v2/chroma-dip")?.pointsLost).not.toBe(V2_MODEL.chroma.dip.muddy.penalty);
    expect(r.measurements.worstDip).toBeGreaterThan(0.4);
    expect(r.measurements.worstDip).toBeLessThan(0.5);
  });

  it.each(["shorter", "longer", "increasing", "decreasing"] as const)("v2 under oklch %s hue has no chroma dip at all", (h) => {
    const r = ok(scoreV2(doc, hue(h)));
    expect(codes(r)).not.toContain("v2/chroma-dip");
    expect(r.measurements.worstDip).toBeLessThan(1e-6);
  });

  it("the doc's own interpolation is used when no option is given", () => {
    expect(ok(scoreV2({ ...doc, interpolation: { space: "oklch" } })).measurements.space).toBe("oklch");
    expect(ok(scoreV2(doc)).measurements.space).toBe("srgb");
    expect(ok(scoreV2({ ...doc, interpolation: { space: "oklch" } }, SRGB)).measurements.space).toBe("srgb");
  });
});

// ── Hue paths ───────────────────────────────────────────────────────────────────

describe("hue paths (300° pair: #db6468 h≈20, #b76ec7 h≈320)", () => {
  const doc = lin(["#db6468", "#b76ec7"]);

  it("the pair is 300° apart going up, 60° the short way", () => {
    const d = hexToOklch("#b76ec7").h - hexToOklch("#db6468").h;
    expect(d).toBeGreaterThan(299);
    expect(d).toBeLessThan(301);
  });

  it("shorter: visits ≈60°, no arc finding beyond v1's", () => {
    const r = ok(scoreV2(doc, OKLCH));
    expect(r.measurements.visitedHueArc).toBeGreaterThan(55);
    expect(r.measurements.visitedHueArc).toBeLessThan(65);
    expect(codes(r)).not.toContain("v2/hue-arc");
  });

  it("longer: visits ≈300° and hits the clash tier", () => {
    const r = ok(scoreV2(doc, hue("longer")));
    expect(r.measurements.visitedHueArc).toBeGreaterThan(290);
    expect(issue(r, "v2/hue-arc")?.pointsLost).toBe(V2_MODEL.hue.arc.clash.penalty);
  });

  it("increasing goes the long way here (20 → 320), decreasing the short way", () => {
    expect(ok(scoreV2(doc, hue("increasing"))).measurements.hueTravel).toBeGreaterThan(290);
    expect(ok(scoreV2(doc, hue("decreasing"))).measurements.hueTravel).toBeLessThan(65);
  });

  it("the requested path is not 'unexpected': no unexpected-hue finding for longer", () => {
    expect(codes(ok(scoreV2(doc, hue("longer"))))).not.toContain("v2/unexpected-hue");
  });

  it("v1 sees the same 60° arc whatever the interpolation", () => {
    const v1 = scoreGradient([{ id: 0, color: "#db6468", position: 0 }, { id: 1, color: "#b76ec7", position: 100 }]);
    expect(v1.details.measurements?.enclosingArc).toBeCloseTo(60, 0);
  });

  it("2 stops under shorter can never reach the clash tier", () => {
    const rnd = mulberry32(99);
    for (let k = 0; k < 100; k++) {
      const r = ok(scoreV2(lin([hex(rnd), hex(rnd)]), OKLCH));
      expect((r.measurements.visitedHueArc ?? 0) <= 180 + 1e-6).toBe(true);
    }
  });

  it("3 chromatic stops under shorter can (RGB rainbow ≈ 235°)", () => {
    const r = ok(scoreV2(lin(["#ff0000", "#00ff00", "#0000ff"]), OKLCH));
    expect(r.measurements.visitedHueArc).toBeGreaterThan(180);
    expect(issue(r, "v2/hue-arc")?.pointsLost).toBe(20);
  });

  it("a zig-zag of hue travel is a direction reversal; a monotone one is not", () => {
    const zig = ok(scoreV2(lin([oklchToHexFitted({ L: 0.7, C: 0.12, h: 350 }), oklchToHexFitted({ L: 0.7, C: 0.12, h: 30 }), oklchToHexFitted({ L: 0.7, C: 0.12, h: 10 })]), OKLCH));
    expect(codes(zig)).toContain("v2/hue-direction-reversal");
    const mono = ok(scoreV2(lin(["#f97316", "#db2777", "#7c3aed"]), OKLCH));
    expect(codes(mono)).not.toContain("v2/hue-direction-reversal");
  });
});

// ── Powerless hue on grey stops ─────────────────────────────────────────────────

describe("powerless hue (CSS Color 4 missing components)", () => {
  it("sRGB greys are powerless (C far below the epsilon)", () => {
    for (const g of ["#000000", "#808080", "#ffffff", "#f8f8f8"]) {
      expect(hexToOklch(g).C).toBeLessThanOrEqual(V2_MODEL.color.powerlessChromaAtMost);
      expect(ok(scoreV2(lin([g, "#ff0000"]), OKLCH)).measurements.powerlessStops).toEqual([0]);
    }
  });

  it("grey → red in oklch shorter keeps red's hue along the whole path", () => {
    const red = hexToOklch("#ff0000").h;
    const s = samplePathV2(lin(["#808080", "#ff0000"]), OKLCH) as NonNullable<ReturnType<typeof samplePathV2>>;
    for (const x of s) if (x.C > 0.04) expect(Math.abs(((x.h - red + 540) % 360) - 180)).toBeLessThan(1);
    const r = ok(scoreV2(lin(["#808080", "#ff0000"]), OKLCH));
    expect(codes(r)).not.toContain("v2/unexpected-hue");
    expect(codes(r)).not.toContain("v2/powerless-hue");
  });

  it("grey → red in oklch longer: spec-literal full turn (equal hues + longer = 360°) is unexpected", () => {
    const r = ok(scoreV2(lin(["#808080", "#ff0000"]), hue("longer")));
    expect(r.measurements.hueExcursion).toBeGreaterThan(170);
    expect(issue(r, "v2/unexpected-hue")?.pointsLost).toBe(V2_MODEL.hue.unexpected.strong.penalty);
  });

  it("a near-grey (off-white) carries an invisible hue that steers the oklch path", () => {
    const doc = lin(["#faf8f5", "#0000ff"]);
    const c = hexToOklch("#faf8f5").C;
    expect(c).toBeGreaterThan(V2_MODEL.color.powerlessChromaAtMost);
    expect(c).toBeLessThanOrEqual(V2_MODEL.color.achromaticAtMost);
    const r = ok(scoreV2(doc, OKLCH));
    expect(r.measurements.noisyHueStops).toEqual([0]);
    expect(codes(r)).toContain("v2/powerless-hue");
    expect(issue(r, "v2/unexpected-hue")?.pointsLost).toBe(V2_MODEL.hue.unexpected.strong.penalty);
  });

  it("the near-grey has no hue effect in srgb or oklab", () => {
    for (const opts of [SRGB, OKLAB]) {
      const r = ok(scoreV2(lin(["#faf8f5", "#0000ff"]), opts));
      expect(codes(r)).not.toContain("v2/powerless-hue");
      expect(r.measurements.hueExcursion).toBeLessThan(35);
    }
  });

  it("grey → grey in oklch is fine (both hues missing)", () => {
    const r = ok(scoreV2(lin(["#202020", "#e0e0e0"]), OKLCH));
    expect(allFinite(r)).toBe(true);
    expect(r.measurements.powerlessStops).toEqual([0, 1]);
    expect(r.measurements.hueExcursion).toBe(0);
    expect(r.score).toBe(ok(scoreV2(lin(["#202020", "#e0e0e0"]), OKLAB)).score);
  });
});

// ── Gamut excursion ─────────────────────────────────────────────────────────────

describe("gamut excursion", () => {
  it("srgb paths never leave the gamut", () => {
    for (const { doc } of V2_CORPUS) {
      const r = ok(scoreV2(doc, SRGB));
      expect(r.measurements.gamutExcursion).toBe(0);
      expect(r.measurements.outOfGamutFraction).toBe(0);
    }
  });

  it("red → green in oklch is a known out-of-gamut ramp: strong excursion over most of the line", () => {
    const r = ok(scoreV2(lin(["#ff0000", "#00ff00"]), OKLCH));
    expect(r.measurements.gamutExcursion).toBeGreaterThan(V2_MODEL.chroma.gamut.strongAbove);
    expect(r.measurements.outOfGamutFraction).toBeGreaterThan(0.9);
    expect(issue(r, "v2/gamut-excursion")?.pointsLost).toBe(V2_MODEL.chroma.gamut.strong.penalty);
  });

  it("yellow → blue in oklch longer leaves the gamut; refinement localises the boundary", () => {
    const r = ok(scoreV2(lin(["#ffff00", "#0000ff"]), hue("longer")));
    expect(r.measurements.gamutExcursion).toBeGreaterThan(0.06);
    expect(r.measurements.refinedSamples).toBeGreaterThan(0);
  });

  it("blue → white in oklab leaves the gamut slightly (within the CSS JND: no finding)", () => {
    const r = ok(scoreV2(lin(["#0000ff", "#ffffff"]), OKLAB));
    expect(r.measurements.outOfGamutFraction).toBeGreaterThan(0.5);
    expect(r.measurements.gamutExcursion).toBeGreaterThan(0);
    expect(r.measurements.gamutExcursion).toBeLessThan(V2_MODEL.color.gamut.jnd);
    expect(codes(r)).not.toContain("v2/gamut-excursion");
  });

  it("displayed samples are always inside sRGB, whatever the mapping", () => {
    for (const gm of ["css4", "clip"] as const) {
      for (const { doc } of V2_CORPUS) {
        for (const x of samplePathV2(doc, { interpolation: { space: "oklch", hue: "longer" }, gamutMapping: gm }) ?? []) {
          for (const c of x.rgb) {
            expect(c).toBeGreaterThanOrEqual(0);
            expect(c).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it("css4 mapping preserves hue better than clipping on an out-of-gamut ramp", () => {
    const doc = lin(["#ff0000", "#00ff00"]);
    const a = samplePathV2(doc, OKLCH) as NonNullable<ReturnType<typeof samplePathV2>>;
    const b = samplePathV2(doc, { ...OKLCH, gamutMapping: "clip" }) as NonNullable<ReturnType<typeof samplePathV2>>;
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    const [h1, h2] = fixHues(hexToOklch("#ff0000").h, hexToOklch("#00ff00").h, "shorter");
    const drift = (s: typeof a) => Math.max(...s.filter((x) => x.outOfGamut && x.C > 0.04).map((x) => {
      const want = h1 + (h2 - h1) * x.u;
      return Math.abs(((x.h - want + 540) % 360) - 180);
    }));
    expect(drift(a)).toBeLessThanOrEqual(drift(b));
  });

  it("in-gamut samples are displayed exactly as intended", () => {
    for (const x of samplePathV2(lin(["#000000", "#ffffff"]), OKLAB) ?? []) {
      expect(x.excursion).toBe(0);
      expect(x.outOfGamut).toBe(false);
    }
  });
});

// ── Banding, speed, contrast, hard stops ───────────────────────────────────────

describe("banding, speed, contrast, hard stops", () => {
  it("navy #112233 → #1a2b3b: 9 levels → 111 px bands at 1000 px (strong)", () => {
    const r = ok(scoreV2(lin(["#112233", "#1a2b3b"]), SRGB));
    expect(r.measurements.segmentLevels[0]).toBeCloseTo(9, 9);
    expect(r.measurements.maxBandPx).toBeCloseTo(1000 / 9, 6);
    expect(issue(r, "v2/banding")?.pointsLost).toBe(V2_MODEL.chroma.banding.strong.penalty);
  });

  it("band width scales with the reference length", () => {
    const doc = lin(["#1e293b", "#0f172a"]);
    const a = ok(scoreV2(doc, { ...SRGB, referenceLengthPx: 500 }));
    const b = ok(scoreV2(doc, { ...SRGB, referenceLengthPx: 2000 }));
    expect(b.measurements.maxBandPx).toBeCloseTo(4 * a.measurements.maxBandPx, 6);
    expect(a.measurements.referenceLengthPx).toBe(500);
  });

  it("an invalid reference length falls back to the default", () => {
    for (const bad of [0, -5, Number.NaN, Infinity, 1e9]) {
      expect(ok(scoreV2(lin(["#000000", "#ffffff"]), { referenceLengthPx: bad })).measurements.referenceLengthPx).toBe(1000);
    }
  });

  it("a dark ramp v1 ignores (18 levels) is flagged by v2 banding", () => {
    const doc = lin(["#1e293b", "#0f172a"]);
    const v1 = score(doc);
    expect(v1.status === "ok" && v1.issues.some((i) => i.code === "chroma/banding")).toBe(false);
    expect(codes(ok(scoreV2(doc, SRGB)))).toContain("v2/banding");
  });

  it("oklch paths traverse more 8-bit levels than the endpoint delta (curved in sRGB)", () => {
    const r = ok(scoreV2(lin(["#ff0000", "#00ff00"]), OKLCH));
    expect(r.measurements.segmentLevels[0]).toBeGreaterThan(255);
  });

  it("black → white in oklab has uniform speed (CV ≈ 0) and no findings", () => {
    const r = ok(scoreV2(lin(["#000000", "#ffffff"]), OKLAB));
    expect(r.score).toBe(100);
  });

  it("speed windows make the CV resolution-robust near black (finite, < 1)", () => {
    const r = ok(scoreV2(lin(["#000000", "#ffffff"]), SRGB));
    expect(r.measurements.speedCv).toBeLessThan(1);
  });

  it("near-identical stops: invisible-tier low contrast, as in v1", () => {
    const r = ok(scoreV2(lin(["#336699", "#346699"]), OKLCH));
    expect(issue(r, "v2/low-contrast")?.pointsLost).toBe(V2_MODEL.lightness.contrast.invisible.penalty);
  });

  it("the path diameter can exceed the stop diameter (longer hue)", () => {
    const doc = lin(["#db6468", "#b76ec7"]);
    const shorter = ok(scoreV2(doc, OKLCH)).measurements.pathDeltaE;
    const longer = ok(scoreV2(doc, hue("longer"))).measurements.pathDeltaE;
    expect(longer).toBeGreaterThan(shorter);
  });

  it("hard stops: both colours are sampled at the same position", () => {
    const doc = lin(["#ff0000", "#ff0000", "#0000ff", "#0000ff"], [0, 0.5, 0.5, 1]);
    const r = ok(scoreV2(doc, OKLCH));
    expect(r.analysis.hasHardStops).toBe(true);
    const s = samplePathV2(doc, OKLCH) as NonNullable<ReturnType<typeof samplePathV2>>;
    const at = s.filter((x) => x.t === 0.5);
    expect(at.length).toBe(2);
    expect(r.measurements.pathDeltaE).toBeGreaterThan(0.5);
  });

  it("all stops at one position: the painted first and last colours are sampled (red|blue)", () => {
    const r = ok(scoreV2(lin(["#ff0000", "#00ff00", "#0000ff"], [0.3, 0.3, 0.3]), OKLCH));
    expect(r.measurements.sampleCount).toBe(2);
    expect(codes(r)).not.toContain("v2/low-contrast");
    expect(r.measurements.speedCv).toBeNull();
  });

  it("a mid-gradient lightness dip is one reversal located at the dip stop", () => {
    const r = ok(scoreV2(lin(["#e0e7ff", "#1e1b4b", "#c7d2fe"]), OKLAB));
    expect(r.measurements.lightnessReversals).toBe(1);
    expect(issue(r, "v2/lightness-reversal")?.stopIndices).toEqual([1]);
  });

  it("unchanged rhythm rules fire as in v1 (edge gap 12 → −3)", () => {
    const r = ok(scoreV2(lin(["#ff0000", "#0000ff"], [0.06, 0.94]), OKLAB));
    expect(issue(r, "rhythm/edge-gap")?.pointsLost).toBe(3);
  });
});
