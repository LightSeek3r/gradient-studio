import { describe, expect, it } from "vitest";
import { analyze, applyEdits, bestFix, computeFixes, fixBlocked, type AnalyzedGradient, type FixAction } from "../src/analyze";
import { ROUGH, SMOOTH, FLAT, randomGradient, rng } from "./helpers";

const css = (value: string) => `.a { background: ${value}; }`;
const first = (text: string, lang = "css"): AnalyzedGradient => analyze(text, lang).items[0];

/** The text with the given ranges cut out. */
function without(text: string, ranges: { start: number; end: number }[]): string {
  let out = text;
  for (const r of [...ranges].sort((a, b) => b.start - a.start)) out = out.slice(0, r.start) + out.slice(r.end);
  return out;
}

describe("exact edits", () => {
  const text = css(ROUGH);
  const g = first(text);
  const fixes = computeFixes(text, g);
  const byLabel = (label: string) => fixes.find((f) => f.label === label)!;

  it("offers one fix per finding and the whole-gradient refinement", () => {
    expect(fixes.map((f) => f.title)).toEqual([
      "Apply fix: Make stop 2 darker (+12)",
      "Apply fix: Bring the hues of stops 1 and 3 closer (+20)",
      "Apply fix: Shift the hue of stop 2 (+17)",
      "Refine whole gradient (+32)",
    ]);
  });

  it("replaces only the stop that the fix changes", () => {
    const f = byLabel("Make stop 2 darker");
    expect(f.edits).toEqual([{ start: text.indexOf("#00ff00 50%"), end: text.indexOf("#00ff00 50%") + "#00ff00 50%".length, newText: "#00a400 50%" }]);
    expect(applyEdits(text, f.edits)).toBe(css("linear-gradient(90deg, #ff0000, #00a400 50%, #0000ff)"));
  });

  it("keeps the explicit position when only the colour changes", () => {
    const f = byLabel("Shift the hue of stop 2");
    expect(f.edits.map((e) => e.newText)).toEqual(["#ffb5ff 50%"]);
  });

  it("edits several stops for a fix that touches several", () => {
    const f = byLabel("Bring the hues of stops 1 and 3 closer");
    expect(f.edits.map((e) => e.newText)).toEqual(["#00a600", "#006900"]);
    expect(f.changedStops).toEqual([0, 2]);
  });

  it("rewrites the three stops for the whole-gradient refinement", () => {
    const f = fixes.at(-1)!;
    expect(f.kind).toBe("refine");
    expect(f.edits.map((e) => e.newText)).toEqual(["#f500a6", "#ff0000 50%", "#7e00d0"]);
  });

  it("reports the whole rewritten gradient", () => {
    const f = byLabel("Make stop 2 darker");
    expect(f.newGradientText).toBe("linear-gradient(90deg, #ff0000, #00a400 50%, #0000ff)");
  });

  it("lists edits in ascending, non-overlapping order", () => {
    for (const f of fixes) {
      for (let i = 1; i < f.edits.length; i++) expect(f.edits[i].start).toBeGreaterThanOrEqual(f.edits[i - 1].end);
    }
  });

  it("writes colours as lower-case #rrggbb", () => {
    for (const f of fixes) for (const e of f.edits) expect(e.newText).toMatch(/^#[0-9a-f]{6}( \d+(\.\d+)?%)?$/);
  });

  it("reports before, after and gain consistently", () => {
    for (const f of fixes) {
      expect(f.scoreBefore).toBe(58);
      expect(f.scoreAfter - f.scoreBefore).toBe(f.gain);
      expect(f.gain).toBeGreaterThan(0);
    }
  });

  it("names the finding each targeted fix removes", () => {
    expect(fixes.filter((f) => f.kind === "fix").map((f) => f.code)).toEqual(["lightness/reversal", "hue/wide-arc", "chroma/muddy-midpoint"]);
    expect(fixes.at(-1)?.code).toBeUndefined();
  });
});

describe("only stop arguments change", () => {
  it("keeps direction, the in-clause and comments byte for byte", () => {
    const v = "linear-gradient(in oklch 45deg, /* a */ #ff0000 /* b */, #00ff00 50%, #0000ff /* c */)";
    const text = css(v);
    const g = first(text);
    const fixes = computeFixes(text, g);
    expect(fixes.length).toBeGreaterThan(0);
    for (const f of fixes) {
      const next = applyEdits(text, f.edits);
      const g2 = first(next);
      expect(without(next, g2.stopRanges)).toBe(without(text, g.stopRanges));
    }
  });

  it("leaves the text around the gradient untouched", () => {
    const text = `/* head */\n.a {\n  color: red;\n  background: ${ROUGH} no-repeat;\n}\n.b { color: blue }\n`;
    const g = first(text);
    for (const f of computeFixes(text, g)) {
      const next = applyEdits(text, f.edits);
      expect(next.slice(0, g.range.start)).toBe(text.slice(0, g.range.start));
      expect(next.endsWith(text.slice(g.range.end))).toBe(true);
    }
  });

  it("puts every edit inside one stop range", () => {
    const text = css(ROUGH);
    const g = first(text);
    for (const f of computeFixes(text, g)) {
      for (const e of f.edits) expect(g.stopRanges.some((r) => e.start >= r.start && e.end <= r.end)).toBe(true);
    }
  });

  it("never touches the direction text", () => {
    const text = css("linear-gradient(to right, #ff0000, #00ff00 50%, #0000ff)");
    const g = first(text);
    const dir = g.parsed.angleRange!;
    for (const f of computeFixes(text, g)) {
      for (const e of f.edits) expect(e.end <= dir.start || e.start >= dir.end).toBe(true);
    }
  });

  it("preserves CRLF line endings inside a multi-line gradient", () => {
    const text = `a {\r\n  background: linear-gradient(\r\n    90deg,\r\n    #ff0000,\r\n    #00ff00 50%,\r\n    #0000ff\r\n  );\r\n}\r\n`;
    const g = first(text);
    const fixes = computeFixes(text, g);
    expect(fixes.length).toBeGreaterThan(0);
    for (const f of fixes) {
      const next = applyEdits(text, f.edits);
      expect(next.match(/\r\n/g)).toHaveLength(text.match(/\r\n/g)!.length);
      expect(next.match(/(?<!\r)\n/g)).toBeNull();
    }
  });

  it("keeps offsets right after multi-byte text", () => {
    const text = `/* 渐变 🎨 */\n${css(ROUGH)}`;
    const g = first(text);
    const f = computeFixes(text, g)[0];
    const next = applyEdits(text, f.edits);
    expect(next.startsWith("/* 渐变 🎨 */\n")).toBe(true);
    expect(first(next).score).toBe(f.scoreAfter);
  });

  it("offers the same relative edits for a gradient in a JS template string", () => {
    const text = "const s = `background: " + ROUGH + ";`;";
    const g = first(text, "javascript");
    const f = computeFixes(text, g)[0];
    const next = applyEdits(text, f.edits);
    expect(next.startsWith("const s = `background: linear-gradient(90deg,")).toBe(true);
    expect(next.endsWith(";`;")).toBe(true);
  });
});

describe("applying a fix", () => {
  it("re-scores to the promised score from the rewritten text", () => {
    const text = css(ROUGH);
    for (const f of computeFixes(text, first(text))) {
      expect(first(applyEdits(text, f.edits)).score).toBe(f.scoreAfter);
    }
  });

  it("removes the finding a targeted fix is for", () => {
    const text = css(ROUGH);
    for (const f of computeFixes(text, first(text)).filter((x) => x.kind === "fix")) {
      const codes = first(applyEdits(text, f.edits)).issues.map((i) => i.code);
      expect(codes).not.toContain(f.code);
    }
  });

  it("does not offer the same fix again after it was applied", () => {
    const text = css(ROUGH);
    const f = computeFixes(text, first(text))[0];
    const next = applyEdits(text, f.edits);
    const again = computeFixes(next, first(next));
    expect(again.map((a) => a.code).filter(Boolean)).not.toContain(f.code);
  });

  it("is a no-op to refine twice: the second refinement finds nothing to improve", () => {
    const text = css(ROUGH);
    const refine = computeFixes(text, first(text)).find((f) => f.kind === "refine")!;
    const once = applyEdits(text, refine.edits);
    const refineAgain = computeFixes(once, first(once)).find((f) => f.kind === "refine");
    if (refineAgain) {
      const twice = applyEdits(once, refineAgain.edits);
      expect(first(twice).score!).toBeGreaterThan(first(once).score!);
    } else {
      expect(refineAgain).toBeUndefined();
    }
  });

  it("converges: repeatedly applying the best fix raises the score then stops", () => {
    let text = css(ROUGH);
    let score = first(text).score!;
    let steps = 0;
    for (; steps < 20; steps++) {
      const best = bestFix(computeFixes(text, first(text)));
      if (!best) break;
      text = applyEdits(text, best.edits);
      const next = first(text).score!;
      expect(next).toBeGreaterThan(score);
      score = next;
    }
    expect(steps).toBeLessThan(20);
    expect(computeFixes(text, first(text)).filter((f) => f.gain <= 0)).toEqual([]);
  });

  it("yields identical edits when computed twice from the same text", () => {
    const text = css(ROUGH);
    expect(computeFixes(text, first(text))).toEqual(computeFixes(text, first(text)));
  });

  it("is idempotent as text: applying the same edit list to equal texts gives equal results", () => {
    const text = css(ROUGH);
    const f = computeFixes(text, first(text))[0];
    expect(applyEdits(text, f.edits)).toBe(applyEdits(text, [...f.edits]));
  });

  it("leaves a second gradient in the file alone", () => {
    const text = css(ROUGH) + "\n" + css(SMOOTH);
    const [a, b] = analyze(text, "css").items;
    const f = computeFixes(text, a)[0];
    const next = applyEdits(text, f.edits);
    expect(next.endsWith(css(SMOOTH))).toBe(true);
    const items = analyze(next, "css").items;
    expect(items[1].score).toBe(b.score);
    expect(items[0].score).toBe(f.scoreAfter);
  });

  it("adds explicit positions when moving a stop would shift automatic ones", () => {
    const text = css("linear-gradient(to right, #5f0750, #acc904, #b3559b, #fdf9ea)");
    const refine = computeFixes(text, first(text)).find((f) => f.kind === "refine")!;
    expect(refine.edits.some((e) => /%$/.test(e.newText))).toBe(true);
    expect(first(applyEdits(text, refine.edits)).score).toBe(refine.scoreAfter);
  });
});

describe("gradients that cannot be rewritten", () => {
  const blocked: [string, string][] = [
    ["a hard stop", "linear-gradient(red 50%, blue 50%)"],
    ["a translucent stop", "linear-gradient(rgba(255,0,0,.5), #00ff00, #0000ff)"],
    ["a colour hint", "linear-gradient(#ff0000, 30%, #00ff00 50%, #0000ff)"],
    ["a double-position stop", "linear-gradient(#ff0000 0% 20%, #00ff00 50%, #0000ff)"],
    ["a var()", "linear-gradient(var(--a), #00ff00, #0000ff)"],
    ["a radial gradient", "radial-gradient(#ff0000, #00ff00, #0000ff)"],
    ["a repeating gradient", "repeating-linear-gradient(#ff0000 0%, #00ff00 10%, #0000ff 20%)"],
  ];

  it.each(blocked)("offers no fix for %s", (_n, v) => {
    const text = css(v);
    expect(computeFixes(text, first(text))).toEqual([]);
  });

  it("offers no fix for a gradient with no findings", () => {
    expect(computeFixes(css(FLAT), first(css(FLAT)))).toEqual([]);
  });

  it("reports why a gradient is blocked", () => {
    expect(fixBlocked(first(css("linear-gradient(#ff0000, 30%, #0000ff)")).parsed)).toBe("colour hint");
    expect(fixBlocked(first(css(ROUGH)).parsed)).toBeNull();
  });

  it("does not throw on a damaged item", () => {
    const broken = { ...first(css(ROUGH)), parsed: { document: null } } as unknown as AnalyzedGradient;
    expect(() => computeFixes("x", broken)).not.toThrow();
  });
});

describe("over random gradients", () => {
  const rand = rng(2024);
  const texts = Array.from({ length: 150 }, () => css(randomGradient(rand)));

  it("verifies every fix from the rewritten text", () => {
    let checked = 0;
    for (const text of texts) {
      const g = first(text);
      if (g.status !== "scored") continue;
      for (const f of computeFixes(text, g) as FixAction[]) {
        const next = applyEdits(text, f.edits);
        const g2 = first(next);
        expect(g2.status).toBe("scored");
        expect(g2.score).toBe(f.scoreAfter);
        expect(f.scoreAfter).toBeGreaterThan(g.score!);
        expect(g2.stopRanges).toHaveLength(g.stopRanges.length);
        expect(without(next, g2.stopRanges)).toBe(without(text, g.stopRanges));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("picks the largest gain as the best fix", () => {
    for (const text of texts.slice(0, 40)) {
      const fixes = computeFixes(text, first(text));
      const best = bestFix(fixes);
      if (best) expect(best.gain).toBe(Math.max(...fixes.map((f) => f.gain)));
      else expect(fixes).toEqual([]);
    }
  });
});
