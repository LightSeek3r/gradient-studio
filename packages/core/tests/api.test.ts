// Document API: resolveStops, score, scoreParsed, refine, toCSS, bakeStops,
// sampleGradient, complement (spec/api.md).

import { describe, expect, it } from "vitest";
import {
  bakeStops,
  complement,
  complementHex,
  parseGradient,
  refine,
  refineGradient,
  resolveStops,
  sampleGradient,
  score,
  scoreGradient,
  scoreParsed,
  toCSS,
  toCSSWithFallback,
  type GradientDocument,
  type GradientTick,
  type Stop,
} from "../src/index";

const doc = (stops: Stop[], extra: Partial<GradientDocument> = {}): GradientDocument => ({ kind: "linear", angle: 90, stops, ...extra });
const parse = (css: string): GradientDocument => {
  const g = parseGradient(css).gradients[0];
  expect(g.skipped).toBeUndefined();
  return g.document!;
};
const positions = (css: string): number[] => resolveStops(parse(css)).map((s) => s.position);

/** Seeded PRNG (mulberry32). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randomHex = (r: () => number): string => `#${Math.floor(r() * 0x1000000).toString(16).padStart(6, "0")}`;

// ── resolveStops ──────────────────────────────────────────────────────────────

describe("resolveStops (CSS auto-distribution)", () => {
  it.each<[string, number[]]>([
    ["linear-gradient(red, blue)", [0, 1]],
    ["linear-gradient(red, lime, blue)", [0, 0.5, 1]],
    ["linear-gradient(red, lime, blue, black)", [0, 1 / 3, 2 / 3, 1]],
    ["linear-gradient(red, lime, blue, black, white)", [0, 0.25, 0.5, 0.75, 1]],
    ["linear-gradient(red 20%, blue)", [0.2, 1]],
    ["linear-gradient(red, blue 80%)", [0, 0.8]],
    ["linear-gradient(red 20%, lime, blue 80%)", [0.2, 0.5, 0.8]],
    ["linear-gradient(red, lime 30%, blue)", [0, 0.3, 1]],
    ["linear-gradient(red, lime, blue 60%, black)", [0, 0.3, 0.6, 1]],
    ["linear-gradient(red 10%, lime, blue, black, white 90%)", [0.1, 0.3, 0.5, 0.7, 0.9]],
    ["linear-gradient(red, lime 40%, blue, black, white)", [0, 0.4, 0.6, 0.8, 1]],
    ["linear-gradient(red, lime, blue 40%, black, white 60%, grey)", [0, 0.2, 0.4, 0.5, 0.6, 1]],
    // Fix-up: a position below an earlier one is raised to it.
    ["linear-gradient(red 80%, blue 20%)", [0.8, 0.8]],
    ["linear-gradient(red 50%, lime 30%, blue 70%)", [0.5, 0.5, 0.7]],
    ["linear-gradient(red 30%, lime 10%, blue 20%, black 40%)", [0.3, 0.3, 0.3, 0.4]],
    ["linear-gradient(red 40%, lime, blue 20%)", [0.4, 0.4, 0.4]],
    ["linear-gradient(red 60%, lime, blue)", [0.6, 0.8, 1]],
    ["linear-gradient(crimson 30%, navy 0)", [0.3, 0.3]],
    ["linear-gradient(red 120%, blue)", [1.2, 1.2]],
    ["linear-gradient(red, blue -20%)", [0, 0]],
    ["linear-gradient(red -20%, lime, blue)", [-0.2, 0.4, 1]],
    // Hard stops and double positions.
    ["linear-gradient(red 50%, blue 50%)", [0.5, 0.5]],
    ["linear-gradient(red 0% 50%, blue 50% 100%)", [0, 0.5, 0.5, 1]],
    ["linear-gradient(red 25% 75%, blue)", [0.25, 0.75, 1]],
    ["linear-gradient(red, blue 25% 75%, lime)", [0, 0.25, 0.75, 1]],
    ["linear-gradient(red)", [0]],
    ["linear-gradient(red 30%)", [0.3]],
    // Hints are ignored and do not take a slot.
    ["linear-gradient(red, 20%, lime, blue)", [0, 0.5, 1]],
  ])("%s", (css, expected) => {
    const got = positions(css);
    expect(got).toHaveLength(expected.length);
    got.forEach((p, i) => expect(p).toBeCloseTo(expected[i], 12));
  });

  it("keeps colour, alpha and id, and does not modify its input", () => {
    const d = doc([{ color: "#ff0000", id: "a" }, { color: "#00ff00", alpha: 0.5 }, { color: "#0000ff", id: "c" }]);
    const snapshot = JSON.stringify(d);
    expect(resolveStops(d)).toEqual([
      { color: "#ff0000", id: "a", position: 0 },
      { color: "#00ff00", alpha: 0.5, position: 0.5 },
      { color: "#0000ff", id: "c", position: 1 },
    ]);
    expect(JSON.stringify(d)).toBe(snapshot);
  });

  it("treats non-finite positions as missing and is idempotent", () => {
    const d = doc([{ color: "#000000", position: NaN }, { color: "#111111", position: Infinity }, { color: "#222222" }]);
    const once = resolveStops(d);
    expect(once.map((s) => s.position)).toEqual([0, 0.5, 1]);
    expect(resolveStops(doc(once))).toEqual(once);
  });

  it.each([null, undefined, 3, "x", {}, { stops: 3 }, { stops: [null] }])("returns [] for %j", (bad) => {
    expect(resolveStops(bad as never)).toEqual([]);
  });

  it("returns [] for an empty document", () => {
    expect(resolveStops(doc([]))).toEqual([]);
  });

  it("random documents resolve to finite, non-decreasing positions", () => {
    const r = prng(7);
    for (let k = 0; k < 300; k++) {
      const stops: Stop[] = Array.from({ length: 1 + Math.floor(r() * 9) }, () => {
        const s: Stop = { color: randomHex(r) };
        if (r() < 0.5) s.position = Math.round(r() * 100) / 100;
        return s;
      });
      const out = resolveStops(doc(stops));
      expect(out).toHaveLength(stops.length);
      for (let i = 0; i < out.length; i++) {
        expect(Number.isFinite(out[i].position)).toBe(true);
        if (i > 0) expect(out[i].position).toBeGreaterThanOrEqual(out[i - 1].position);
      }
    }
  });
});

// ── score ─────────────────────────────────────────────────────────────────────

describe("score", () => {
  it("returns the v1 engine's numbers for a simple document", () => {
    const d = doc([{ color: "#ff0000", position: 0 }, { color: "#00ff00", position: 0.5 }, { color: "#0000ff", position: 1 }]);
    const legacy = scoreGradient([
      { id: 0, color: "#ff0000", position: 0 },
      { id: 1, color: "#00ff00", position: 50 },
      { id: 2, color: "#0000ff", position: 100 },
    ]);
    const result = score(d);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.score).toBe(legacy.score);
    expect(result.scoringModel).toBe("v1");
    expect(result.dimensions).toEqual({
      lightness: legacy.details.lightness,
      chroma: legacy.details.chroma,
      hue: legacy.details.hue,
      spacing: legacy.details.spacing,
    });
    expect(result.issues.map((i) => i.code)).toEqual(legacy.findings.map((f) => f.code));
    expect(result.issues.map((i) => i.message)).toEqual(legacy.issues);
    expect(result.analysis).toEqual({ hasHardStops: false });
  });

  it("matches scoreGradient on 400 random documents (same score, dimensions, codes, locations)", () => {
    const r = prng(42);
    for (let k = 0; k < 400; k++) {
      const n = 2 + Math.floor(r() * 6);
      const pos = Array.from({ length: n }, () => Math.floor(r() * 101)).sort((a, b) => a - b);
      const ticks: GradientTick[] = pos.map((p, i) => ({ id: i, color: randomHex(r), position: p }));
      const d = doc(ticks.map((t) => ({ color: t.color, position: t.position / 100 })));
      const legacy = scoreGradient(ticks);
      const result = score(d);
      expect(result.status).toBe("ok");
      if (result.status !== "ok") continue;
      expect(result.score).toBe(legacy.score);
      expect(result.dimensions.spacing).toBe(legacy.details.spacing);
      expect(result.issues).toHaveLength(legacy.findings.length);
      result.issues.forEach((issue, i) => {
        const f = legacy.findings[i];
        expect(issue.code).toBe(f.code);
        expect(issue.severity).toBe(f.severity);
        expect(issue.pointsLost).toBe(f.pointsLost);
        expect(issue.dimension).toBe(f.dimension === "rhythm" ? "spacing" : f.dimension);
        expect(issue.stopIndices).toEqual(f.stops);
        if (f.segment) {
          expect(issue.segment!.start).toBeCloseTo(f.segment[0] / 100, 12);
          expect(issue.segment!.end).toBeCloseTo(f.segment[1] / 100, 12);
        } else expect(issue.segment).toBeUndefined();
        expect(issue.range).toBeUndefined();
      });
    }
  });

  it("scores a parsed percentage exactly like the engine's integer position", () => {
    // 0.3 * 100 is 30.000000000000004; the unit conversion must not leak that.
    for (let p = 1; p < 100; p++) {
      const parsed = parse(`linear-gradient(#102030 0%, #a0b0c0 ${p}%, #ffeedd 100%)`);
      const legacy = scoreGradient([
        { id: 0, color: "#102030", position: 0 },
        { id: 1, color: "#a0b0c0", position: p },
        { id: 2, color: "#ffeedd", position: 100 },
      ]);
      const result = score(parsed);
      expect(result.status === "ok" && result.score).toBe(legacy.score);
      expect(result.status === "ok" && result.issues.map((i) => i.code)).toEqual(legacy.findings.map((f) => f.code));
    }
  });

  it("resolves missing positions before scoring", () => {
    const auto = score(parse("linear-gradient(#ff0000, #00ff00, #0000ff)"));
    const explicit = score(parse("linear-gradient(#ff0000 0%, #00ff00 50%, #0000ff 100%)"));
    expect(auto).toEqual(explicit);
    expect(auto.status).toBe("ok");
  });

  it("sums: per dimension, budget − kept = min(budget, Σ pointsLost)", () => {
    const r = prng(3);
    const budget = { lightness: 30, hue: 30, chroma: 20, spacing: 20 } as const;
    for (let k = 0; k < 150; k++) {
      const stops = Array.from({ length: 2 + Math.floor(r() * 5) }, () => ({ color: randomHex(r) }));
      const result = score(doc(stops));
      expect(result.status).toBe("ok");
      if (result.status !== "ok") continue;
      let total = 0;
      for (const dim of ["lightness", "hue", "chroma", "spacing"] as const) {
        const lost = result.issues.filter((i) => i.dimension === dim).reduce((a, i) => a + i.pointsLost, 0);
        expect(budget[dim] - result.dimensions[dim]).toBe(Math.min(budget[dim], lost));
        total += result.dimensions[dim];
      }
      expect(result.score).toBe(total);
    }
  });

  it("CSS order is paint order: out-of-order positions are fixed up, not sorted", () => {
    const a = score(doc([{ color: "#ff0000", position: 0.8 }, { color: "#0000ff", position: 0.2 }]));
    const b = score(doc([{ color: "#ff0000", position: 0.8 }, { color: "#0000ff", position: 0.8 }]));
    expect(a).toEqual(b);
    expect(a.status === "ok" && a.analysis.hasHardStops).toBe(true);
  });

  it("issue stop indices point into document.stops", () => {
    const d = parse("linear-gradient(#000000, #ffffff, #000000, #ffffff)");
    const result = score(d);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.issues.length).toBeGreaterThan(0);
    for (const issue of result.issues) {
      for (const i of issue.stopIndices ?? []) expect(d.stops[i]).toBeDefined();
      if (issue.segment) {
        expect(issue.segment.start).toBeGreaterThanOrEqual(0);
        expect(issue.segment.end).toBeLessThanOrEqual(1);
        expect(issue.segment.start).toBeLessThanOrEqual(issue.segment.end);
      }
    }
  });

  it.each<[string, boolean]>([
    ["linear-gradient(red, blue)", false],
    ["linear-gradient(red 50%, blue 50%)", true],
    ["linear-gradient(red 0% 50%, blue 50% 100%)", true],
    ["linear-gradient(red 80%, blue 20%)", true],
    ["linear-gradient(crimson 30%, navy 0)", true],
    ["linear-gradient(red 0% 50%, red 50% 100%)", false],
    ["linear-gradient(red 49%, blue 51%)", false],
    ["linear-gradient(#fff 0%, #fff 30%, #000 30.5%, #000 100%)", false],
  ])("analysis.hasHardStops of %s is %s (and the score stays a v1 score)", (css, hard) => {
    const d = parse(css);
    const result = score(d);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.analysis.hasHardStops).toBe(hard);
    const legacy = scoreGradient(resolveStops(d).map((s, i) => ({ id: i, color: s.color, position: Math.round(s.position * 1e12) / 1e10 })));
    expect(result.score).toBe(legacy.score);
  });

  it.each<[string, unknown, string]>([
    ["null", null, "invalid-document"],
    ["undefined", undefined, "invalid-document"],
    ["a string", "linear-gradient(red, blue)", "invalid-document"],
    ["a number", 7, "invalid-document"],
    ["an array", [], "invalid-document"],
    ["no stops array", { kind: "linear", angle: 0 }, "invalid-document"],
    ["a null stop", { kind: "linear", angle: 0, stops: [null, null] }, "invalid-document"],
    ["a string stop", { kind: "linear", angle: 0, stops: ["#fff", "#000"] }, "invalid-document"],
    ["radial kind", { kind: "radial", angle: 0, stops: [{ color: "#ffffff" }, { color: "#000000" }] }, "unsupported-kind"],
    ["missing kind", { angle: 0, stops: [{ color: "#ffffff" }, { color: "#000000" }] }, "unsupported-kind"],
    ["repeating", doc([{ color: "#ffffff" }, { color: "#000000" }], { repeating: true }), "repeating"],
    ["no stops", doc([]), "too-few-stops"],
    ["one stop", doc([{ color: "#ffffff" }]), "too-few-stops"],
    ["short hex", doc([{ color: "#fff" }, { color: "#000000" }]), "invalid-color"],
    ["8-digit hex", doc([{ color: "#ffffffff" }, { color: "#000000" }]), "invalid-color"],
    ["named colour", doc([{ color: "red" }, { color: "#000000" }]), "invalid-color"],
    ["non-hex digits", doc([{ color: "#gggggg" }, { color: "#000000" }]), "invalid-color"],
    ["rgb() text", doc([{ color: "rgb(0,0,0)" }, { color: "#000000" }]), "invalid-color"],
    ["missing colour", doc([{} as Stop, { color: "#000000" }]), "invalid-color"],
    ["numeric colour", doc([{ color: 0xffffff as unknown as string }, { color: "#000000" }]), "invalid-color"],
    ["translucent stop", doc([{ color: "#ffffff", alpha: 0.5 }, { color: "#000000" }]), "alpha"],
    ["transparent stop", doc([{ color: "#ffffff" }, { color: "#000000", alpha: 0 }]), "alpha"],
    ["nearly opaque stop", doc([{ color: "#ffffff", alpha: 0.999 }, { color: "#000000" }]), "alpha"],
    ["NaN alpha", doc([{ color: "#ffffff", alpha: NaN }, { color: "#000000" }]), "invalid-alpha"],
    ["alpha above 1", doc([{ color: "#ffffff", alpha: 2 }, { color: "#000000" }]), "invalid-alpha"],
    ["negative alpha", doc([{ color: "#ffffff", alpha: -0.1 }, { color: "#000000" }]), "invalid-alpha"],
    ["string alpha", doc([{ color: "#ffffff", alpha: "1" as unknown as number }, { color: "#000000" }]), "invalid-alpha"],
    ["NaN position", doc([{ color: "#ffffff", position: NaN }, { color: "#000000" }]), "invalid-position"],
    ["infinite position", doc([{ color: "#ffffff" }, { color: "#000000", position: Infinity }]), "invalid-position"],
    ["string position", doc([{ color: "#ffffff", position: "0" as unknown as number }, { color: "#000000" }]), "invalid-position"],
    ["null position", doc([{ color: "#ffffff", position: null as unknown as number }, { color: "#000000" }]), "invalid-position"],
    ["position above 1", doc([{ color: "#ffffff", position: 0 }, { color: "#000000", position: 1.2 }]), "position-range"],
    ["negative position", doc([{ color: "#ffffff", position: -0.1 }, { color: "#000000", position: 1 }]), "position-range"],
    ["percent-scale positions", doc([{ color: "#ffffff", position: 0 }, { color: "#000000", position: 100 }]), "position-range"],
  ])("unscorable: %s → %s", (_name, input, code) => {
    const result = score(input as GradientDocument);
    expect(result.status).toBe("unscorable");
    if (result.status !== "unscorable") return;
    expect(result.code).toBe(code);
    expect(result.reason.length).toBeGreaterThan(0);
    expect("score" in result).toBe(false);
  });

  it("alpha: 1 and upper-case hex are inside the domain", () => {
    const result = score(doc([{ color: "#FFFFFF", alpha: 1 }, { color: "#000000" }]));
    expect(result.status).toBe("ok");
  });

  it("only knows scoring model v1", () => {
    const d = doc([{ color: "#ffffff" }, { color: "#000000" }]);
    expect(score(d, { scoringModel: "v1" })).toEqual(score(d));
    expect(score(d, {})).toEqual(score(d));
    const v2 = score(d, { scoringModel: "v2" as never });
    expect(v2.status === "unscorable" && v2.code).toBe("unsupported-model");
  });

  it("does not modify the document", () => {
    const d = parse("linear-gradient(red, lime 30%, blue)");
    const snapshot = JSON.stringify(d);
    score(d);
    refine(d);
    toCSS(d);
    bakeStops(d, 9);
    expect(JSON.stringify(d)).toBe(snapshot);
  });
});

// ── scoreParsed ───────────────────────────────────────────────────────────────

describe("scoreParsed", () => {
  it("locates issues on the source text of the offending stops", () => {
    const css = ".a { background: linear-gradient(45deg, red, lime, blue); }";
    const g = parseGradient(css).gradients[0];
    const result = scoreParsed(g);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const located = Object.fromEntries(result.issues.map((i) => [i.code, css.slice(i.range!.start, i.range!.end)]));
    expect(located).toEqual({
      "lightness/reversal": "lime",
      "hue/wide-arc": "red, lime, blue",
      "chroma/muddy-midpoint": "lime, blue",
    });
    const plain = score(g.document!);
    expect(plain.status).toBe("ok");
    if (plain.status !== "ok") return;
    expect(result.score).toBe(plain.score);
    expect(result.issues.map((i) => ({ ...i, range: undefined }))).toEqual(plain.issues.map((i) => ({ ...i, range: undefined })));
  });

  it("every issue range lies inside the gradient and covers its stops", () => {
    const r = prng(11);
    for (let k = 0; k < 150; k++) {
      const n = 2 + Math.floor(r() * 6);
      const css = `x{y:linear-gradient(${Math.floor(r() * 360)}deg, ${Array.from({ length: n }, () => randomHex(r)).join(" , ")})}`;
      const g = parseGradient(css).gradients[0];
      const result = scoreParsed(g);
      expect(result.status).toBe("ok");
      if (result.status !== "ok") continue;
      for (const issue of result.issues) {
        expect(issue.range).toBeDefined();
        expect(issue.range!.start).toBeGreaterThanOrEqual(g.range.start);
        expect(issue.range!.end).toBeLessThanOrEqual(g.range.end);
        for (const i of issue.stopIndices ?? []) {
          expect(issue.range!.start).toBeLessThanOrEqual(g.stopRanges[i].start);
          expect(issue.range!.end).toBeGreaterThanOrEqual(g.stopRanges[i].end);
        }
        if (!issue.stopIndices) expect(issue.range).toEqual(g.range);
      }
    }
  });

  it("uses the shared range of a double-position stop", () => {
    const css = "linear-gradient(90deg, #ffffff 0% 50%, #000000 50% 100%)";
    const g = parseGradient(css).gradients[0];
    const result = scoreParsed(g);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.analysis.hasHardStops).toBe(true);
    for (const issue of result.issues) {
      expect(["#ffffff 0% 50%", "#000000 50% 100%", "#ffffff 0% 50%, #000000 50% 100%", css]).toContain(
        css.slice(issue.range!.start, issue.range!.end),
      );
    }
  });

  it.each<[string, string]>([
    ["linear-gradient(var(--a), blue)", "var"],
    ["radial-gradient(red, blue)", "unsupported-kind"],
    ["-webkit-linear-gradient(top, red, blue)", "legacy-syntax"],
    ["linear-gradient(red 10px, blue)", "length-position"],
    ["linear-gradient(red, blue", "unbalanced"],
    ["linear-gradient(rgba(0,0,0,.5), blue)", "alpha"],
    ["linear-gradient(transparent, black)", "alpha"],
    ["repeating-linear-gradient(red 0%, blue 10%)", "repeating"],
    ["linear-gradient(red)", "too-few-stops"],
    ["linear-gradient(red -10%, blue)", "position-range"],
  ])("%s is unscorable: %s", (css, code) => {
    const result = scoreParsed(parseGradient(css).gradients[0]);
    expect(result.status === "unscorable" && result.code).toBe(code);
  });

  it.each([null, undefined, 1, "x", {}, { document: null }])("junk input %j is unscorable", (junk) => {
    const result = scoreParsed(junk as never);
    expect(result.status === "unscorable" && result.code).toBe("invalid-document");
  });
});

// ── refine ────────────────────────────────────────────────────────────────────

describe("refine", () => {
  it("refines, never lowers the score and agrees with refineGradient", () => {
    const d = parse("linear-gradient(45deg, red, lime, blue)");
    const out = refine(d);
    expect(out.refined).toBe(true);
    expect(out.declined).toBeUndefined();
    expect(out.before).toEqual(score(d));
    expect(out.after).toEqual(score(out.document));
    const legacy = refineGradient([
      { id: 0, color: "#ff0000", position: 0 },
      { id: 1, color: "#00ff00", position: 50 },
      { id: 2, color: "#0000ff", position: 100 },
    ]);
    expect(out.before.status === "ok" && out.before.score).toBe(legacy.before);
    expect(out.after.status === "ok" && out.after.score).toBe(legacy.after);
    expect(out.document.stops.map((s) => s.color)).toEqual(legacy.stops.map((s) => s.color));
    expect(out.document.stops.map((s) => s.position)).toEqual(legacy.stops.map((s) => s.position / 100));
    expect(out.document.angle).toBe(45);
    expect(out.document).not.toBe(d);
  });

  it("keeps ids, angle and interpolation", () => {
    const d = doc(
      [{ color: "#ff0000", id: "a" }, { color: "#00ff00", id: "b" }, { color: "#0000ff", id: "c" }],
      { angle: 12, interpolation: { space: "oklch", hue: "longer" } },
    );
    const out = refine(d);
    expect(out.document.stops.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(out.document.angle).toBe(12);
    expect(out.document.interpolation).toEqual({ space: "oklch", hue: "longer" });
    for (const s of out.document.stops) expect(s.alpha).toBeUndefined();
  });

  it("random documents: after ≥ before, output valid and scorable", () => {
    const r = prng(99);
    let refined = 0;
    for (let k = 0; k < 200; k++) {
      const stops = Array.from({ length: 2 + Math.floor(r() * 6) }, () => {
        const s: Stop = { color: randomHex(r) };
        if (r() < 0.3) s.position = Math.round(r() * 100) / 100;
        return s;
      });
      const d = doc(stops);
      const out = refine(d);
      expect(out.before.status).toBe("ok");
      expect(out.after.status).toBe("ok");
      if (out.before.status !== "ok" || out.after.status !== "ok") continue;
      expect(out.after.score).toBeGreaterThanOrEqual(out.before.score);
      if (out.refined) {
        refined++;
        expect(out.document.stops).toHaveLength(stops.length);
        for (const s of out.document.stops) {
          expect(s.color).toMatch(/^#[0-9a-f]{6}$/);
          expect(s.position).toBeGreaterThanOrEqual(0);
          expect(s.position).toBeLessThanOrEqual(1);
        }
        expect(score(out.document)).toEqual(out.after);
      } else {
        expect(out.document).toBe(d);
        expect(out.declined).toBeDefined();
        expect(out.after).toEqual(out.before);
      }
    }
    expect(refined).toBeGreaterThan(50);
  });

  it("declines a gradient whose stops all share one position", () => {
    const d = parse("linear-gradient(red 50%, blue 50%)");
    const out = refine(d);
    expect(out.refined).toBe(false);
    expect(out.document).toBe(d);
    expect(out.declined!.code).toBe("single-position");
    expect(out.declined!.reason.length).toBeGreaterThan(0);
  });

  it("keeps hard stops hard", () => {
    const d = parse("linear-gradient(90deg, #ff0000 0% 30%, #0000ff 30% 100%)");
    const out = refine(d);
    const after = score(out.document);
    expect(after.status === "ok" && after.analysis.hasHardStops).toBe(true);
  });

  it.each<[string, GradientDocument | null]>([
    ["alpha", doc([{ color: "#000000", alpha: 0.5 }, { color: "#ffffff" }])],
    ["repeating", doc([{ color: "#000000" }, { color: "#ffffff" }], { repeating: true })],
    ["one stop", doc([{ color: "#000000" }])],
    ["invalid colour", doc([{ color: "nope" }, { color: "#ffffff" }])],
    ["null", null],
  ])("declines unscorable input (%s) and returns it unchanged", (_name, d) => {
    const out = refine(d as GradientDocument);
    expect(out.refined).toBe(false);
    expect(out.document).toBe(d);
    expect(out.declined!.code).toBe("unscorable");
    expect(out.before.status).toBe("unscorable");
    expect(out.after).toEqual(out.before);
  });
});

// ── toCSS ─────────────────────────────────────────────────────────────────────

describe("toCSS", () => {
  it.each<[string, GradientDocument, object | undefined, string]>([
    ["auto positions", doc([{ color: "#ff0000" }, { color: "#0000ff" }]), undefined, "linear-gradient(90deg, #ff0000, #0000ff)"],
    ["explicit positions", doc([{ color: "#ff0000", position: 0 }, { color: "#0000ff", position: 1 }]), undefined, "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)"],
    ["fractional positions", doc([{ color: "#ff0000", position: 0.125 }, { color: "#0000ff", position: 1 / 3 }]), undefined, "linear-gradient(90deg, #ff0000 12.5%, #0000ff 33.3333%)"],
    ["binary noise", doc([{ color: "#ff0000", position: 0.07 }, { color: "#0000ff", position: 0.57 }]), undefined, "linear-gradient(90deg, #ff0000 7%, #0000ff 57%)"],
    ["angle", doc([{ color: "#ff0000" }, { color: "#0000ff" }], { angle: 0 }), undefined, "linear-gradient(0deg, #ff0000, #0000ff)"],
    ["negative zero angle", doc([{ color: "#ff0000" }, { color: "#0000ff" }], { angle: -0 }), undefined, "linear-gradient(0deg, #ff0000, #0000ff)"],
    ["negative angle", doc([{ color: "#ff0000" }, { color: "#0000ff" }], { angle: -45.5 }), undefined, "linear-gradient(-45.5deg, #ff0000, #0000ff)"],
    ["tiny angle", doc([{ color: "#ff0000" }, { color: "#0000ff" }], { angle: 1e-9 }), undefined, "linear-gradient(0deg, #ff0000, #0000ff)"],
    ["lower-cases hex", doc([{ color: "#FF00AA" }, { color: "#0000FF" }]), undefined, "linear-gradient(90deg, #ff00aa, #0000ff)"],
    ["alpha", doc([{ color: "#ff0000", alpha: 0.5 }, { color: "#0000ff", alpha: 0, position: 1 }]), undefined, "linear-gradient(90deg, rgb(255 0 0 / 0.5), rgb(0 0 255 / 0) 100%)"],
    ["alpha 1 prints hex", doc([{ color: "#ff0000", alpha: 1 }, { color: "#0000ff" }]), undefined, "linear-gradient(90deg, #ff0000, #0000ff)"],
    ["alpha rounding", doc([{ color: "#102030", alpha: 1 / 3 }, { color: "#0000ff" }]), undefined, "linear-gradient(90deg, rgb(16 32 48 / 0.3333), #0000ff)"],
    ["repeating", doc([{ color: "#ff0000", position: 0 }, { color: "#0000ff", position: 0.1 }], { repeating: true }), undefined, "repeating-linear-gradient(90deg, #ff0000 0%, #0000ff 10%)"],
    ["document order, unsorted", doc([{ color: "#ff0000", position: 0.8 }, { color: "#0000ff", position: 0.2 }]), undefined, "linear-gradient(90deg, #ff0000 80%, #0000ff 20%)"],
    ["hard stop", doc([{ color: "#ff0000", position: 0.5 }, { color: "#0000ff", position: 0.5 }]), undefined, "linear-gradient(90deg, #ff0000 50%, #0000ff 50%)"],
    ["one stop", doc([{ color: "#ff0000" }]), undefined, "linear-gradient(90deg, #ff0000)"],
    ["in oklab", doc([{ color: "#ff0000" }, { color: "#0000ff" }], { interpolation: { space: "oklab" } }), undefined, "linear-gradient(90deg in oklab, #ff0000, #0000ff)"],
    ["in oklch", doc([{ color: "#ff0000" }, { color: "#0000ff" }], { interpolation: { space: "oklch" } }), undefined, "linear-gradient(90deg in oklch, #ff0000, #0000ff)"],
    ["in oklch longer hue", doc([{ color: "#ff0000" }, { color: "#0000ff" }], { interpolation: { space: "oklch", hue: "longer" } }), undefined, "linear-gradient(90deg in oklch longer hue, #ff0000, #0000ff)"],
    ["shorter hue is the default", doc([{ color: "#ff0000" }, { color: "#0000ff" }], { interpolation: { space: "oklch", hue: "shorter" } }), undefined, "linear-gradient(90deg in oklch, #ff0000, #0000ff)"],
    ["hue ignored outside oklch", doc([{ color: "#ff0000" }, { color: "#0000ff" }], { interpolation: { space: "oklab", hue: "longer" } }), undefined, "linear-gradient(90deg in oklab, #ff0000, #0000ff)"],
    ["srgb prints no clause", doc([{ color: "#ff0000" }, { color: "#0000ff" }], { interpolation: { space: "srgb" } }), undefined, "linear-gradient(90deg, #ff0000, #0000ff)"],
    ["option overrides the document", doc([{ color: "#ff0000" }, { color: "#0000ff" }], { interpolation: { space: "oklab" } }), { interpolation: { space: "oklch", hue: "decreasing" } }, "linear-gradient(90deg in oklch decreasing hue, #ff0000, #0000ff)"],
    ["option can force sRGB", doc([{ color: "#ff0000" }, { color: "#0000ff" }], { interpolation: { space: "oklab" } }), { interpolation: { space: "srgb" } }, "linear-gradient(90deg, #ff0000, #0000ff)"],
    ["unknown space prints no clause", doc([{ color: "#ff0000" }, { color: "#0000ff" }]), { interpolation: { space: "hsl; } body { x: y" } }, "linear-gradient(90deg, #ff0000, #0000ff)"],
  ])("%s", (_name, d, opts, css) => {
    expect(toCSS(d, opts as never)).toBe(css);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["a string", "x"],
    ["no stops", doc([])],
    ["radial", { kind: "radial", angle: 0, stops: [{ color: "#ffffff" }] }],
    ["NaN angle", doc([{ color: "#ffffff" }, { color: "#000000" }], { angle: NaN })],
    ["string angle", doc([{ color: "#ffffff" }, { color: "#000000" }], { angle: "90deg" as never })],
    ["invalid colour", doc([{ color: "red; } body { display: none" }, { color: "#000000" }])],
    ["short hex", doc([{ color: "#fff" }, { color: "#000000" }])],
    ["invalid alpha", doc([{ color: "#ffffff", alpha: 3 }, { color: "#000000" }])],
    ["NaN position", doc([{ color: "#ffffff", position: NaN }, { color: "#000000" }])],
  ])("returns null for %s", (_name, bad) => {
    expect(toCSS(bad as GradientDocument)).toBeNull();
    expect(toCSSWithFallback(bad as GradientDocument)).toBeNull();
  });

  it("never prints exponent notation or NaN", () => {
    const css = toCSS(doc([{ color: "#ffffff", position: 1e-7, alpha: 1e-7 }, { color: "#000000", position: 123456.789 }], { angle: 1e8 }));
    expect(css).toBe("linear-gradient(100000000deg, rgb(255 255 255 / 0) 0%, #000000 12345678.9%)");
    expect(toCSS(doc([{ color: "#ffffff" }, { color: "#000000" }], { angle: 1e21 }))).toBeNull();
    expect(toCSS(doc([{ color: "#ffffff" }, { color: "#000000", position: 1e21 }]))).toBeNull();
  });
});

describe("toCSSWithFallback", () => {
  const d = doc([{ color: "#ff0000" }, { color: "#0000ff" }]);

  it("emits an sRGB fallback, then the native OKLAB gradient", () => {
    const css = toCSSWithFallback(d)!;
    const lines = css.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("background: linear-gradient(90deg in oklab, #ff0000, #0000ff);");
    expect(lines[0]).toMatch(/^background: linear-gradient\(90deg, #ff0000 0%, .* #0000ff 100%\);$/);
    const found = parseGradient(css).gradients;
    expect(found).toHaveLength(2);
    expect(found[0].document!.stops).toHaveLength(16);
    expect(found[0].document!.interpolation).toBeUndefined();
    expect(found[1].document!.interpolation).toEqual({ space: "oklab" });
  });

  it("the fallback stops are the gradient sampled in the target space", () => {
    const fallback = parseGradient(toCSSWithFallback(d, "background", 5)!).gradients[0].document!;
    expect(fallback.stops.map((s) => s.color)).toEqual(bakeStops(d, 5).map((s) => s.color));
    const lch = doc(d.stops, { interpolation: { space: "oklch", hue: "longer" } });
    const css = toCSSWithFallback(lch, "background", 5)!;
    expect(css.split("\n")[1]).toBe("background: linear-gradient(90deg in oklch longer hue, #ff0000, #0000ff);");
    expect(parseGradient(css).gradients[0].document!.stops.map((s) => s.color)).toEqual(
      bakeStops(lch, 5, { interpolation: { space: "oklch", hue: "longer" } }).map((s) => s.color),
    );
  });

  it("needs no fallback for an sRGB document", () => {
    expect(toCSSWithFallback(doc(d.stops, { interpolation: { space: "srgb" } }))).toBe("background: linear-gradient(90deg, #ff0000, #0000ff);");
  });

  it.each<[string, string]>([
    ["background-image", "background-image"],
    ["--my-gradient", "--my-gradient"],
    ["-webkit-mask-image", "-webkit-mask-image"],
    ["mask", "mask"],
    ["x; } body { display: none", "background"],
    ["", "background"],
    ["9lives", "background"],
  ])("property %j → %s", (property, used) => {
    for (const line of toCSSWithFallback(d, property)!.split("\n")) expect(line.startsWith(`${used}: linear-gradient(`)).toBe(true);
    expect(toCSSWithFallback(d, 5 as never)!.startsWith("background: ")).toBe(true);
  });
});

// ── sampleGradient / bakeStops ────────────────────────────────────────────────

describe("sampleGradient", () => {
  const bw = doc([{ color: "#000000" }, { color: "#ffffff" }]);

  it("returns the end stops at and beyond the ends", () => {
    for (const t of [-5, 0]) expect(sampleGradient(bw, t)).toEqual({ color: "#000000", alpha: 1 });
    for (const t of [1, 5]) expect(sampleGradient(bw, t)).toEqual({ color: "#ffffff", alpha: 1 });
    const inset = doc([{ color: "#ff0000", position: 0.2 }, { color: "#0000ff", position: 0.8 }]);
    expect(sampleGradient(inset, 0.1)).toEqual({ color: "#ff0000", alpha: 1 });
    expect(sampleGradient(inset, 0.9)).toEqual({ color: "#0000ff", alpha: 1 });
  });

  it("interpolates in OKLAB by default: the black→white midpoint is OKLAB L = 0.5", () => {
    expect(sampleGradient(bw, 0.5)).toEqual({ color: "#636363", alpha: 1 });
    expect(sampleGradient(bw, 0.5, { interpolation: { space: "oklch" } })).toEqual({ color: "#636363", alpha: 1 });
    expect(sampleGradient(bw, 0.5, { interpolation: { space: "srgb" } })).toEqual({ color: "#808080", alpha: 1 });
  });

  it("sRGB midpoint of red and blue is the channel average", () => {
    const rb = doc([{ color: "#ff0000" }, { color: "#0000ff" }]);
    expect(sampleGradient(rb, 0.5, { interpolation: { space: "srgb" } })!.color).toBe("#800080");
    expect(sampleGradient(rb, 0.5)!.color).not.toBe("#800080");
  });

  it("at a hard stop the later colour wins; just before it the earlier one", () => {
    const hard = doc([{ color: "#ff0000", position: 0 }, { color: "#ff0000", position: 0.5 }, { color: "#0000ff", position: 0.5 }, { color: "#0000ff", position: 1 }]);
    expect(sampleGradient(hard, 0.5)!.color).toBe("#0000ff");
    expect(sampleGradient(hard, 0.4999)!.color).toBe("#ff0000");
    expect(sampleGradient(hard, 0.75)!.color).toBe("#0000ff");
    const first = doc([{ color: "#ff0000", position: 0 }, { color: "#0000ff", position: 0 }, { color: "#00ff00", position: 1 }]);
    expect(sampleGradient(first, 0)!.color).toBe("#0000ff");
    expect(sampleGradient(first, -1)!.color).toBe("#ff0000");
  });

  it("premultiplies alpha: fading to transparent keeps the visible colour", () => {
    const fade = doc([{ color: "#ff0000" }, { color: "#000000", alpha: 0 }]);
    for (const space of ["srgb", "oklab", "oklch"] as const) {
      const mid = sampleGradient(fade, 0.5, { interpolation: { space } })!;
      expect(mid.alpha).toBeCloseTo(0.5, 12);
      expect(mid.color).toBe("#ff0000");
    }
    const both = doc([{ color: "#ff0000", alpha: 0 }, { color: "#0000ff", alpha: 0 }]);
    expect(sampleGradient(both, 0.5)!.alpha).toBe(0);
    expect(sampleGradient(both, 0.5)!.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("weights colours by alpha", () => {
    const d = doc([{ color: "#ff0000", alpha: 1 }, { color: "#0000ff", alpha: 0.25 }]);
    const mid = sampleGradient(d, 0.5, { interpolation: { space: "srgb" } })!;
    expect(mid.alpha).toBeCloseTo(0.625, 12);
    // (255·0.5·1) / 0.625 = 204, (255·0.5·0.25) / 0.625 = 51
    expect(mid.color).toBe("#cc0033");
  });

  it("oklch hue paths: shorter and longer go opposite ways round", () => {
    const d = doc([{ color: "#ff0000" }, { color: "#0000ff" }]);
    const mid = (hue: "shorter" | "longer" | "increasing" | "decreasing"): string =>
      sampleGradient(d, 0.5, { interpolation: { space: "oklch", hue } })!.color;
    const channels = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    // Red (29°) to blue (264°): shorter/decreasing pass through magenta, longer/increasing through green.
    expect(mid("shorter")).toBe(mid("decreasing"));
    expect(mid("longer")).toBe(mid("increasing"));
    expect(mid("shorter")).not.toBe(mid("longer"));
    const [r1, g1] = channels(mid("shorter"));
    const [r2, g2] = channels(mid("longer"));
    expect(r1).toBeGreaterThan(g1);
    expect(g2).toBeGreaterThan(r2);
  });

  it("an achromatic stop takes the other stop's hue in oklch (no detour through hue 0)", () => {
    const d = doc([{ color: "#ffffff" }, { color: "#0000ff" }]);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(sampleGradient(d, 0.5, { interpolation: { space: "oklch" } })!.color.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it("always returns an in-gamut #rrggbb and an alpha in 0-1", () => {
    const r = prng(5);
    for (let k = 0; k < 300; k++) {
      const stops = Array.from({ length: 2 + Math.floor(r() * 4) }, () => {
        const s: Stop = { color: randomHex(r) };
        if (r() < 0.4) s.alpha = Math.round(r() * 100) / 100;
        if (r() < 0.4) s.position = Math.round(r() * 100) / 100;
        return s;
      });
      const space = (["srgb", "oklab", "oklch"] as const)[k % 3];
      const hue = (["shorter", "longer", "increasing", "decreasing"] as const)[k % 4];
      const s = sampleGradient(doc(stops), r() * 1.4 - 0.2, { interpolation: { space, hue } })!;
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(s.alpha).toBeGreaterThanOrEqual(0);
      expect(s.alpha).toBeLessThanOrEqual(1);
    }
  });

  it.each<[string, unknown, number]>([
    ["null document", null, 0.5],
    ["empty document", doc([]), 0.5],
    ["invalid colour", doc([{ color: "red" }, { color: "#000000" }]), 0.5],
    ["invalid alpha", doc([{ color: "#ffffff", alpha: 9 }, { color: "#000000" }]), 0.5],
    ["NaN t", doc([{ color: "#ffffff" }, { color: "#000000" }]), NaN],
    ["infinite t", doc([{ color: "#ffffff" }, { color: "#000000" }]), Infinity],
    ["string t", doc([{ color: "#ffffff" }, { color: "#000000" }]), "0.5" as never],
  ])("returns null for %s", (_name, d, t) => {
    expect(sampleGradient(d as GradientDocument, t)).toBeNull();
  });

  it("a one-stop document is a flat colour", () => {
    expect(sampleGradient(doc([{ color: "#123456", alpha: 0.5 }]), 0.3)).toEqual({ color: "#123456", alpha: 0.5 });
  });

  it("falls back to OKLAB for an unknown space", () => {
    expect(sampleGradient(bw, 0.5, { interpolation: { space: "hsl" as never } })).toEqual(sampleGradient(bw, 0.5));
  });
});

describe("bakeStops", () => {
  const rb = doc([{ color: "#ff0000" }, { color: "#0000ff" }]);

  it.each([2, 3, 5, 8, 9, 16, 33])("n = %d: n stops, the ends are the original stops, evenly spaced", (n) => {
    const out = bakeStops(rb, n);
    expect(out).toHaveLength(n);
    expect(out[0]).toEqual({ color: "#ff0000", position: 0 });
    expect(out[n - 1]).toEqual({ color: "#0000ff", position: 1 });
    out.forEach((s, i) => {
      expect(s.position).toBeCloseTo(i / (n - 1), 12);
      expect(s.color).toBe(sampleGradient(rb, s.position!)!.color);
      expect(s.alpha).toBeUndefined();
    });
  });

  it.each([0, 1, 2, -3, NaN, Infinity, "8" as never, undefined as never])("n = %s never drops original stops", (n) => {
    const three = doc([{ color: "#ff0000" }, { color: "#00ff00" }, { color: "#0000ff" }]);
    expect(bakeStops(three, n)).toEqual([
      { color: "#ff0000", position: 0 },
      { color: "#00ff00", position: 0.5 },
      { color: "#0000ff", position: 1 },
    ]);
  });

  it("keeps every original stop exactly, in order", () => {
    const r = prng(21);
    for (let k = 0; k < 100; k++) {
      const stops = Array.from({ length: 2 + Math.floor(r() * 5) }, () => {
        const s: Stop = { color: randomHex(r) };
        if (r() < 0.5) s.position = Math.round(r() * 100) / 100;
        if (r() < 0.3) s.alpha = Math.round(r() * 100) / 100;
        return s;
      });
      const d = doc(stops);
      const resolved = resolveStops(d);
      const n = 2 + Math.floor(r() * 30);
      const out = bakeStops(d, n);
      expect(out.length).toBeGreaterThanOrEqual(resolved.length);
      expect(out.length).toBeLessThanOrEqual(Math.max(n, resolved.length));
      expect(out[0].color).toBe(resolved[0].color);
      expect(out[0].position).toBe(resolved[0].position);
      expect(out[out.length - 1].color).toBe(resolved[resolved.length - 1].color);
      expect(out[out.length - 1].position).toBe(resolved[resolved.length - 1].position);
      let j = 0;
      for (const s of out) {
        if (j < resolved.length && s.position === resolved[j].position && s.color === resolved[j].color) j++;
        expect(s.color).toMatch(/^#[0-9a-f]{6}$/);
      }
      expect(j).toBe(resolved.length);
      for (let i = 1; i < out.length; i++) expect(out[i].position!).toBeGreaterThanOrEqual(out[i - 1].position!);
    }
  });

  it("shares extra samples by segment length and gives hard stops none", () => {
    const d = doc([
      { color: "#ff0000", position: 0 },
      { color: "#00ff00", position: 0.75 },
      { color: "#000000", position: 0.75 },
      { color: "#0000ff", position: 1 },
    ]);
    const out = bakeStops(d, 12);
    expect(out).toHaveLength(12);
    expect(out.filter((s) => s.position! > 0 && s.position! < 0.75)).toHaveLength(6);
    expect(out.filter((s) => s.position! > 0.75 && s.position! < 1)).toHaveLength(2);
    expect(out.filter((s) => s.position === 0.75).map((s) => s.color)).toEqual(["#00ff00", "#000000"]);
    const scored = score(doc(out));
    expect(scored.status === "ok" && scored.analysis.hasHardStops).toBe(true);
  });

  it("is alpha-aware (premultiplied)", () => {
    const fade = doc([{ color: "#ff0000" }, { color: "#000000", alpha: 0 }]);
    const out = bakeStops(fade, 5);
    expect(out.map((s) => s.color)).toEqual(["#ff0000", "#ff0000", "#ff0000", "#ff0000", "#000000"]);
    expect(out.map((s) => s.alpha)).toEqual([undefined, 0.75, 0.5, 0.25, 0]);
  });

  it("baked stops, drawn in sRGB, stay close to the OKLAB gradient", () => {
    // Channels near 0 are the worst case (the sRGB curve is steepest there),
    // hence the looser bound for pure red → blue.
    for (const [d, tolerance] of [[doc([{ color: "#3b82f6" }, { color: "#ec4899" }, { color: "#fde68a" }]), 3], [rb, 12]] as const) {
      const baked = doc(bakeStops(d, 17));
      for (let i = 0; i <= 100; i++) {
        const want = sampleGradient(d, i / 100)!.color;
        const got = sampleGradient(baked, i / 100, { interpolation: { space: "srgb" } })!.color;
        for (const c of [1, 3, 5]) {
          expect(Math.abs(parseInt(want.slice(c, c + 2), 16) - parseInt(got.slice(c, c + 2), 16))).toBeLessThanOrEqual(tolerance);
        }
      }
    }
  });

  it("honours the interpolation option", () => {
    expect(bakeStops(rb, 3, { interpolation: { space: "srgb" } })[1].color).toBe("#800080");
    expect(bakeStops(rb, 3)[1].color).toBe(sampleGradient(rb, 0.5)!.color);
  });

  it("caps the number of stops", () => {
    expect(bakeStops(rb, 1e9).length).toBe(4096);
  });

  it.each([null, "x", doc([]), doc([{ color: "nope" }, { color: "#000000" }])])("returns [] for invalid document %j", (bad) => {
    expect(bakeStops(bad as GradientDocument, 8)).toEqual([]);
  });
});

// ── complement ────────────────────────────────────────────────────────────────

describe("complement", () => {
  it.each(["#ff0000", "#3b82f6", "#808080", "#ffffff", "#000000", "#123456"])("agrees with complementHex for %s", (hex) => {
    expect(complement(hex)).toBe(complementHex(hex));
    expect(complement(hex)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it.each<[string, string]>([
    ["red", "#ff0000"],
    ["#F00", "#ff0000"],
    ["rgb(255 0 0 / 50%)", "#ff0000"],
    ["hsl(0, 100%, 50%)", "#ff0000"],
    ["  rebeccapurple ", "#663399"],
  ])("accepts any supported syntax: %s", (css, hex) => {
    expect(complement(css)).toBe(complementHex(hex));
  });

  it.each(["", "bleu", "var(--x)", "currentColor", "linear-gradient(red, blue)", "#12", null, undefined, 5, {}])(
    "returns null for %j",
    (bad) => {
      expect(complement(bad as string)).toBeNull();
    },
  );

  it("mirrors lightness for greys", () => {
    expect(complement("white")).toBe("#000000");
    expect(complement("black")).toBe("#ffffff");
  });
});
