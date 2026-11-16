import { describe, expect, it } from "vitest";
import { callTool, TOOLS } from "../src/handlers";
import { errorText, RGB_CSS, SMOOTH_CSS, score, sc } from "./helpers";

describe("score_gradient: valid input", () => {
  it("scores the classic red-green-blue gradient and reports coded, located issues", () => {
    const out = sc(score({ css: RGB_CSS }));
    expect(out.scoringModel).toBe("v1");
    expect(out.gradientCount).toBe(1);
    const g = out.gradients[0];
    expect(g.status).toBe("scored");
    expect(g.score).toBe(58);
    expect(g.issues.map((i: { code: string }) => i.code)).toEqual(["lightness/reversal", "hue/wide-arc", "chroma/muddy-midpoint"]);
    expect(out.summary).toEqual({ scored: 1, skipped: 0, scoreMin: 58, scoreMax: 58 });
  });

  it("gives every issue its stops (index, colour, position) and its source range", () => {
    const g = sc(score({ css: RGB_CSS })).gradients[0];
    const reversal = g.issues[0];
    expect(reversal.stops).toEqual([{ index: 1, color: "#00ff00", positionPercent: 50 }]);
    expect(RGB_CSS.slice(reversal.range.start, reversal.range.end)).toBe("#00ff00 50%");
    expect(reversal.loc).toEqual({ line: 1, col: reversal.range.start + 1 });
    const muddy = g.issues[2];
    expect(muddy.segmentPercent).toEqual({ start: 50, end: 100 });
    expect(RGB_CSS.slice(g.range.start, g.range.end)).toBe("linear-gradient(90deg,#ff0000,#00ff00 50%,#0000ff)");
  });

  it("reports points kept per dimension with their budgets, summing to the score", () => {
    const g = sc(score({ css: RGB_CSS })).gradients[0];
    expect(g.dimensions).toEqual({
      lightness: { points: 18, of: 30 },
      chroma: { points: 10, of: 20 },
      hue: { points: 10, of: 30 },
      spacing: { points: 20, of: 20 },
    });
    const d = Object.values(g.dimensions) as { points: number; of: number }[];
    expect(d.reduce((a, x) => a + x.points, 0)).toBe(g.score);
    expect(d.reduce((a, x) => a + x.of, 0)).toBe(100);
  });

  it("returns an integer score in 0-100 for a smooth gradient", () => {
    const g = sc(score({ css: SMOOTH_CSS })).gradients[0];
    expect(Number.isInteger(g.score)).toBe(true);
    expect(g.score).toBeGreaterThanOrEqual(0);
    expect(g.score).toBeLessThanOrEqual(100);
    expect(g.score).toBeGreaterThan(58);
  });

  it("scores structured stops exactly like the equivalent CSS", () => {
    const fromStops = sc(
      score({ stops: [{ color: "#ff0000", position: 0 }, { color: "#00ff00", position: 50 }, { color: "#0000ff", position: 100 }], angle: 90 }),
    ).gradients[0];
    expect(fromStops.score).toBe(58);
    expect(fromStops.css).toBe("linear-gradient(90deg, #ff0000 0%, #00ff00 50%, #0000ff 100%)");
    expect(fromStops.range).toBeUndefined();
    expect(fromStops.issues[0].range).toBeUndefined();
    expect(fromStops.issues[0].stops[0]).toEqual({ index: 1, color: "#00ff00", positionPercent: 50 });
  });

  it("accepts named, hsl, rgb and oklch colours in stops and resolves automatic positions", () => {
    const g = sc(score({ stops: [{ color: "navy" }, { color: "hsl(210 80% 50%)" }, { color: "rgb(200 220 255)" }, { color: "oklch(0.95 0.02 250)" }] })).gradients[0];
    expect(g.status).toBe("scored");
    expect(g.css).toMatch(/^linear-gradient\(180deg, #000080, /);
  });

  it("includes the in-oklch clause of an interpolation argument in the printed CSS", () => {
    const g = sc(score({ stops: [{ color: "red" }, { color: "blue" }], interpolation: "oklch" })).gradients[0];
    expect(g.css).toBe("linear-gradient(180deg in oklch, #ff0000, #0000ff)");
  });

  it("examines every gradient in a stylesheet, in source order", () => {
    const css = `.a{background:${SMOOTH_CSS}}\n.b{background:linear-gradient(90deg,#ff0000,#00ff00 50%,#0000ff)}`;
    const out = sc(score({ css }));
    expect(out.gradientCount).toBe(2);
    expect(out.gradients.map((g: { index: number }) => g.index)).toEqual([0, 1]);
    expect(out.gradients[1].score).toBe(58);
    expect(out.gradients[1].loc).toEqual({ line: 2, col: 15 });
  });

  it("counts lines for CRLF and lone CR line endings, and columns in UTF-16 units", () => {
    const css = `/* \u{1F600} */\r\n.a{\rbackground:${SMOOTH_CSS}}`;
    const g = sc(score({ css })).gradients[0];
    expect(css.slice(g.range.start, g.range.end)).toBe(SMOOTH_CSS);
    expect(g.loc.line).toBe(3);
    expect(g.loc.col).toBe("background:".length + 1);
  });

  it("flags hard stops without judging them", () => {
    const g = sc(score({ css: "linear-gradient(90deg, #ff0000 50%, #0000ff 50%)" })).gradients[0];
    expect(g.hasHardStops).toBe(true);
    expect(g.status).toBe("scored");
  });

  it("passes parser warnings through (colour hints are ignored, not guessed)", () => {
    const g = sc(score({ css: "linear-gradient(#ff0000, 30%, #0000ff)" })).gradients[0];
    expect(g.warnings.map((w: { code: string }) => w.code)).toContain("color-hint-ignored");
  });

  it("is deterministic: identical calls give byte-identical results", () => {
    const a = JSON.stringify(score({ css: RGB_CSS + SMOOTH_CSS }));
    const b = JSON.stringify(score({ css: RGB_CSS + SMOOTH_CSS }));
    expect(a).toBe(b);
  });

  it("returns the same data as text and as structuredContent", () => {
    const r = score({ css: RGB_CSS });
    expect(JSON.parse((r.content[0] as { text: string }).text)).toEqual(r.structuredContent);
  });

  it("uses neutral wording: a smoothness score, never a verdict", () => {
    const out = sc(score({ css: RGB_CSS }));
    expect(out.note).toMatch(/smoothness score/i);
    expect(out.note).toMatch(/not a quality verdict/i);
    expect(out.note).toMatch(/no pass threshold/i);
    const verdict = /\b(excellent|good|great|poor|bad|ugly|beautiful|terrible)\b/i;
    expect(out.note).not.toMatch(verdict);
    for (const t of TOOLS) expect(`${t.title} ${t.description}`).not.toMatch(verdict);
  });
});

describe("score_gradient: skipped and empty input", () => {
  const skip = (css: string) => sc(score({ css })).gradients[0];

  it.each([
    ["var()", "linear-gradient(var(--a), blue)", "var"],
    ["translucent stops", "linear-gradient(red, transparent)", "alpha"],
    ["radial gradients", "radial-gradient(red, blue)", "unsupported-kind"],
    ["conic gradients", "conic-gradient(red, blue)", "unsupported-kind"],
    ["repeating gradients", "repeating-linear-gradient(red, blue 10px)", "length-position"],
    ["vendor prefixes", "-webkit-linear-gradient(red, blue)", "legacy-syntax"],
    ["currentColor", "linear-gradient(currentColor, blue)", "currentColor"],
    ["color-mix()", "linear-gradient(color-mix(in srgb, red, blue), blue)", "color-mix"],
    ["calc()", "linear-gradient(red calc(10% + 5px), blue)", "calc"],
    ["wide-gamut colours", "linear-gradient(color(display-p3 1 0 0), blue)", "color-function"],
  ])("reports %s as skipped with code %s", (_name, css, code) => {
    const g = skip(css);
    expect(g.status).toBe("skipped");
    expect(g.skipped.code).toBe(code);
    expect(typeof g.skipped.reason).toBe("string");
    expect(g.score).toBeUndefined();
  });

  it("scores a repeating gradient that has percentage stops as skipped with the repeating code", () => {
    const g = skip("repeating-linear-gradient(red 0%, blue 20%)");
    expect(g.status).toBe("skipped");
    expect(g.skipped.code).toBe("repeating");
  });

  it("reports a translucent stop from structured input as skipped, not as an error", () => {
    const g = sc(score({ stops: [{ color: "rgb(255 0 0 / 0.5)" }, { color: "blue" }] })).gradients[0];
    expect(g.status).toBe("skipped");
    expect(g.skipped.code).toBe("alpha");
  });

  it("mixes scored and skipped gradients in one summary", () => {
    const out = sc(score({ css: `${SMOOTH_CSS}; radial-gradient(red, blue); ${RGB_CSS}` }));
    expect(out.summary.scored).toBe(2);
    expect(out.summary.skipped).toBe(1);
    expect(out.summary.scoreMin).toBe(58);
  });

  it("answers 0 gradients (not an error) when the text holds none", () => {
    const r = score({ css: "a { color: red; background: url(x.png) }" });
    expect(r.isError).toBeUndefined();
    const out = sc(r);
    expect(out.gradientCount).toBe(0);
    expect(out.message).toMatch(/No .*gradient/);
    expect(out.summary.scoreMin).toBeNull();
  });
});

describe("score_gradient: invalid and huge input never throws", () => {
  it("requires exactly one of css and stops", () => {
    expect(errorText(score({}))).toMatch(/give `css`/);
    expect(errorText(score({ css: "x", stops: [{ color: "red" }, { color: "blue" }] }))).toMatch(/not both/);
    expect(score({}).isError).toBe(true);
  });

  it("rejects css over 20,000 characters, accepts exactly 20,000", () => {
    const pad = (n: number) => " ".repeat(n - SMOOTH_CSS.length) + SMOOTH_CSS;
    const over = score({ css: pad(20_001) });
    expect(over.isError).toBe(true);
    expect(errorText(over)).toMatch(/css: too long \(20001 characters, the limit is 20000\)/);
    expect(score({ css: pad(20_000) }).isError).toBeUndefined();
  });

  it("examines at most 32 gradients and reports how many were left out", () => {
    const css = Array.from({ length: 40 }, (_, i) => `.g${i}{background:${SMOOTH_CSS}}`).join("\n");
    const out = sc(score({ css }));
    expect(out.gradientCount).toBe(32);
    expect(out.gradientsNotExamined).toBe(8);
    expect(out.gradients).toHaveLength(32);
  });

  it("rejects fewer than 2 and more than 32 structured stops", () => {
    expect(errorText(score({ stops: [{ color: "red" }] }))).toMatch(/stops: needs at least 2/);
    const many = Array.from({ length: 33 }, () => ({ color: "red" }));
    expect(errorText(score({ stops: many }))).toMatch(/stops: too many items \(33, the limit is 32\)/);
    expect(score({ stops: many.slice(0, 32) }).isError).toBeUndefined();
  });

  it("explains an unusable colour with its stop and a cut-down excerpt", () => {
    const e = errorText(score({ stops: [{ color: "red" }, { color: "var(--brand)" }] }));
    expect(e).toMatch(/stops\[1\]\.color: "var\(--brand\)" is not a supported CSS colour/);
    const long = errorText(score({ stops: [{ color: "red" }, { color: "x".repeat(150) }] }));
    expect(long.length).toBeLessThan(400);
    expect(errorText(score({ stops: [{ color: "red" }, { color: "x".repeat(201) }] }))).toMatch(/too long/);
  });

  it("rejects out-of-range positions, bad angles and unknown properties", () => {
    expect(errorText(score({ stops: [{ color: "red", position: -1 }, { color: "blue" }] }))).toMatch(/at least 0/);
    expect(errorText(score({ stops: [{ color: "red" }, { color: "blue" }], angle: 99999 }))).toMatch(/angle: must be at most 3600/);
    expect(errorText(score({ stops: [{ color: "red" }, { color: "blue" }], angle: "90" }))).toMatch(/angle: expected a finite number/);
    expect(errorText(score({ css: "x", model: "v2" }))).toMatch(/unknown property "model"/);
  });

  it.each([null, undefined, 5, "text", [], [1, 2], true])("never throws for non-object arguments (%j)", (args) => {
    const r = callTool("score_gradient", args);
    if (args === undefined || args === null) expect(errorText(r)).toMatch(/give `css`/);
    else expect(r.isError).toBe(true);
  });

  it("turns an exception inside argument handling into an error result", () => {
    const hostile = {
      get css(): string {
        throw new Error("boom");
      },
    };
    const r = callTool("score_gradient", hostile);
    expect(r.isError).toBe(true);
    expect(errorText(r)).toMatch(/internal error in score_gradient: boom/);
  });

  it("rejects unknown tool names, including prototype keys", () => {
    for (const name of ["nope", "constructor", "__proto__", "toString", "", 5, null]) {
      const r = callTool(name, {});
      expect(r.isError).toBe(true);
      expect(errorText(r)).toMatch(/unknown tool/);
    }
  });

  it("stays fast on pathological css", () => {
    const inputs = [
      "linear-gradient(".repeat(1250),
      "linear-gradient(red,".repeat(1000),
      "(".repeat(20_000),
      `linear-gradient(${"#ff0000,".repeat(2800)}#0000ff)`,
      "/*".repeat(10_000),
      "\u0000�\u{1F600}".repeat(5000),
    ];
    const t0 = performance.now();
    for (const css of inputs) {
      const r = score({ css });
      expect(r.content.length).toBeGreaterThan(0);
    }
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it("handles 32 gradients of 32 stops each within a few seconds", () => {
    const stops = Array.from({ length: 32 }, (_, i) => `hsl(${(i * 37) % 360} 70% ${30 + ((i * 11) % 50)}%)`).join(",");
    const css = Array.from({ length: 32 }, () => `linear-gradient(90deg,${stops})`).join(";");
    expect(css.length).toBeLessThan(20_000);
    const t0 = performance.now();
    const out = sc(score({ css }));
    expect(out.gradientCount).toBe(32);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
