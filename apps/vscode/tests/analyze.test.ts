import { describe, expect, it } from "vitest";
import {
  analyze,
  DEFAULT_SETTINGS,
  gradientAt,
  gradientsIn,
  LANGUAGE_IDS,
  lensTitle,
  normalizeSettings,
  skipWords,
  skippedLensTitle,
  utf8Length,
} from "../src/analyze";
import { lineCol } from "../src/report";
import { parseGradient } from "@opal42/gradient";
import { FLAT, ROUGH, SMOOTH, rng, slice } from "./helpers";

const css = (value: string) => `.a { background: ${value}; }`;

describe("finding and scoring gradients", () => {
  it("finds one gradient and maps its range onto the source text", () => {
    const text = css(ROUGH);
    const a = analyze(text, "css");
    expect(a.items).toHaveLength(1);
    expect(slice(text, a.items[0].range)).toBe(ROUGH);
    expect(a.items[0].status).toBe("scored");
    expect(a.items[0].score).toBe(58);
  });

  it("maps every stop range onto its stop text", () => {
    const text = css(ROUGH);
    const g = analyze(text, "css").items[0];
    expect(g.stopRanges.map((r) => slice(text, r))).toEqual(["#ff0000", "#00ff00 50%", "#0000ff"]);
  });

  it("puts each diagnostic on the stops that cause the finding", () => {
    const text = css(ROUGH);
    const g = analyze(text, "css").items[0];
    const by = Object.fromEntries(g.diagnostics.map((d) => [d.code, slice(text, d.range)]));
    expect(by["lightness/reversal"]).toBe("#00ff00 50%");
    expect(by["hue/wide-arc"]).toBe("#ff0000, #00ff00 50%, #0000ff");
    expect(by["chroma/muddy-midpoint"]).toBe("#00ff00 50%, #0000ff");
  });

  it("sets code, message and points on each diagnostic", () => {
    const g = analyze(css(ROUGH), "css").items[0];
    expect(g.diagnostics.map((d) => d.code)).toEqual(g.issues.map((i) => i.code));
    for (const d of g.diagnostics) expect(d.message).toMatch(/\(-\d+ points\)$/);
  });

  it("returns nothing for text without a gradient", () => {
    expect(analyze("a { color: red }", "css")).toEqual({ items: [], bytes: 16 });
  });

  it("returns nothing for an empty document", () => {
    expect(analyze("", "css").items).toEqual([]);
  });

  it("scores the same gradient the same way twice (deterministic)", () => {
    const text = css(ROUGH) + css(SMOOTH);
    expect(analyze(text, "css")).toEqual(analyze(text, "css"));
  });

  it("keeps document order across several gradients", () => {
    const text = css(SMOOTH) + css(ROUGH) + css(FLAT);
    const a = analyze(text, "css");
    expect(a.items.map((g) => g.index)).toEqual([0, 1, 2]);
    expect(a.items.map((g) => g.score)).toEqual([95, 58, 100]);
    expect(a.items[0].range.start).toBeLessThan(a.items[1].range.start);
  });

  it("finds two gradients on one line with separate ranges", () => {
    const text = `x { background: ${ROUGH}, ${SMOOTH}; }`;
    const a = analyze(text, "css");
    expect(a.items.map((g) => slice(text, g.range))).toEqual([ROUGH, SMOOTH]);
    expect(a.items.map((g) => g.lens?.range.start)).toEqual([a.items[0].range.start, a.items[1].range.start]);
  });

  it("scopes each stop range to its own gradient on a shared line", () => {
    const text = `x { background: ${ROUGH}, ${SMOOTH}; }`;
    const [first, second] = analyze(text, "css").items;
    for (const r of first.stopRanges) expect(r.end).toBeLessThanOrEqual(first.range.end);
    for (const r of second.stopRanges) expect(r.start).toBeGreaterThanOrEqual(second.range.start);
  });
});

describe("offsets with line endings and wide characters", () => {
  it("keeps UTF-16 offsets that slice the gradient out of CRLF text", () => {
    const text = `a {\r\n  color: red;\r\n  background: ${ROUGH};\r\n}\r\n`;
    const g = analyze(text, "css").items[0];
    expect(slice(text, g.range)).toBe(ROUGH);
    expect(lineCol(text, g.range.start)).toEqual({ line: 3, column: 15 });
  });

  it("maps stops of a multi-line gradient in CRLF text", () => {
    const text = `a {\r\n  background: linear-gradient(\r\n    90deg,\r\n    #ff0000,\r\n    #00ff00 50%,\r\n    #0000ff\r\n  );\r\n}`;
    const g = analyze(text, "css").items[0];
    expect(g.stopRanges.map((r) => slice(text, r))).toEqual(["#ff0000", "#00ff00 50%", "#0000ff"]);
    expect(g.stopRanges.map((r) => lineCol(text, r.start).line)).toEqual([4, 5, 6]);
    expect(g.stopRanges.map((r) => lineCol(text, r.start).column)).toEqual([5, 5, 5]);
  });

  it("counts a lone carriage return as a line break", () => {
    const text = `a {\r  background: ${ROUGH};\r}`;
    const g = analyze(text, "css").items[0];
    expect(lineCol(text, g.range.start)).toEqual({ line: 2, column: 15 });
  });

  it("handles LF, CRLF and CR the same way for ranges", () => {
    const body = `.a {\n  background: ${ROUGH};\n}\n`;
    const a = analyze(body, "css").items[0];
    const crlf = analyze(body.replace(/\n/g, "\r\n"), "css").items[0];
    const cr = analyze(body.replace(/\n/g, "\r"), "css").items[0];
    expect(crlf.range.start - a.range.start).toBe(1);
    expect(cr.range.start).toBe(a.range.start);
    expect(crlf.score).toBe(a.score);
    expect(cr.score).toBe(a.score);
  });

  it("uses UTF-16 offsets after CJK text (one unit per character)", () => {
    const text = `/* 渐变背景色 */\n.a { background: ${ROUGH}; }`;
    const g = analyze(text, "css").items[0];
    expect(slice(text, g.range)).toBe(ROUGH);
    expect(lineCol(text, g.range.start)).toEqual({ line: 2, column: 18 });
  });

  it("counts an astral emoji as two units, like the editor", () => {
    const text = `.a::after { content: "🎨🎨"; } .b { background: ${ROUGH}; }`;
    const g = analyze(text, "css").items[0];
    expect(slice(text, g.range)).toBe(ROUGH);
    const naive = text.indexOf("linear-gradient");
    expect(g.range.start).toBe(naive);
    expect([...text.slice(0, naive)].length).toBeLessThan(naive);
  });

  it("puts a diagnostic inside a multi-byte line at the right column", () => {
    const text = `.é { background: ${ROUGH}; }`;
    const g = analyze(text, "css").items[0];
    const d = g.diagnostics.find((x) => x.code === "lightness/reversal");
    expect(slice(text, d!.range)).toBe("#00ff00 50%");
    expect(lineCol(text, d!.range.start).column).toBe(text.indexOf("#00ff00") + 1);
  });

  it("measures the size cap in bytes, not characters", () => {
    const filler = "é".repeat(6 * 1024);
    const text = `/* ${filler} */ ${css(ROUGH)}`;
    expect(text.length).toBeLessThan(10 * 1024);
    expect(utf8Length(text)).toBeGreaterThan(10 * 1024);
    expect(analyze(text, "css", { maxFileSizeKB: 10 }).limit).toBe("size");
  });
});

describe("languages and embedding", () => {
  it("finds a gradient in a JS template string", () => {
    const text = "const s = `background: " + ROUGH + ";`;";
    const g = analyze(text, "javascript").items[0];
    expect(slice(text, g.range)).toBe(ROUGH);
    expect(g.score).toBe(58);
  });

  it("finds a gradient in a JSX style string", () => {
    const text = `const el = <div style={{ background: '${SMOOTH}' }} />;`;
    const g = analyze(text, "javascriptreact").items[0];
    expect(slice(text, g.range)).toBe(SMOOTH);
  });

  it("finds a gradient in an HTML style attribute", () => {
    const text = `<div style="background: ${ROUGH}"></div>`;
    const g = analyze(text, "html").items[0];
    expect(slice(text, g.range)).toBe(ROUGH);
  });

  it("finds a gradient in a Markdown fenced block", () => {
    const text = "# Notes\n\n```css\n.a { background: " + ROUGH + "; }\n```\n";
    const g = analyze(text, "markdown").items[0];
    expect(slice(text, g.range)).toBe(ROUGH);
    expect(lineCol(text, g.range.start).line).toBe(4);
  });

  it("skips a template expression and gives it no lens by default", () => {
    const text = "const s = `background: linear-gradient(${angle}deg, #ff0000, #0000ff)`;";
    const g = analyze(text, "typescript").items[0];
    expect(g.status).toBe("skipped");
    expect(g.skip?.code).toBe("preprocessor");
    expect(g.lens).toBeNull();
  });

  it.each(LANGUAGE_IDS.filter((l) => !["css", "scss", "less"].includes(l)))("scores a gradient inside a string in %s", (id) => {
    const text = `x = "background: ${ROUGH}"`;
    expect(analyze(text, id).items).toHaveLength(1);
  });

  it.each(["css", "scss", "less"])("ignores a gradient quoted inside a string value in %s", (id) => {
    const text = `.a::after { content: "${ROUGH}"; }`;
    expect(analyze(text, id).items).toHaveLength(0);
  });

  it("still finds an unquoted gradient next to a quoted one in CSS", () => {
    const text = `.a { content: "x"; background: ${ROUGH}; }`;
    expect(analyze(text, "css").items).toHaveLength(1);
  });

  it("ignores a gradient in a comment", () => {
    expect(analyze(`/* ${ROUGH} */ .a { color: red }`, "css").items).toHaveLength(0);
  });

  it("works for SCSS and Less sources", () => {
    expect(analyze(`$g: ${ROUGH};`, "scss").items[0].score).toBe(58);
    expect(analyze(`@g: ${ROUGH};`, "less").items[0].score).toBe(58);
  });
});

describe("lens", () => {
  it("writes neutral wording with the issue count", () => {
    expect(analyze(css(ROUGH), "css").items[0].lens?.title).toBe("Smoothness 58 - 3 issues");
    expect(analyze(css(SMOOTH), "css").items[0].lens?.title).toBe("Smoothness 95 - 1 issue");
    expect(analyze(css(FLAT), "css").items[0].lens?.title).toBe("Smoothness 100 - no issues");
  });

  it("formats titles", () => {
    expect(lensTitle(72, 2)).toBe("Smoothness 72 - 2 issues");
    expect(lensTitle(100, 0)).toBe("Smoothness 100 - no issues");
  });

  it("uses no verdict words", () => {
    const words = /\b(pass|fail|good|bad|poor|excellent|great|ugly|ok)\b/i;
    for (const v of [ROUGH, SMOOTH, FLAT]) {
      const g = analyze(css(v), "css", { showSkipped: true }).items[0];
      expect(g.lens?.title).not.toMatch(words);
    }
    expect(skippedLensTitle("var")).not.toMatch(words);
  });

  it("anchors the lens at the start of the gradient with zero width", () => {
    const g = analyze(css(ROUGH), "css").items[0];
    expect(g.lens?.range).toEqual({ start: g.range.start, end: g.range.start });
  });
});

describe("gradients that are not scored", () => {
  const cases: [string, string, string][] = [
    ["var()", "linear-gradient(var(--a), #fff)", "var"],
    ["calc()", "linear-gradient(red calc(10% + 2px), blue)", "calc"],
    ["transparency", "linear-gradient(rgba(0,0,0,.5), #fff)", "alpha"],
    ["hard stops", "linear-gradient(red 50%, blue 50%)", "hard-stops"],
    ["radial", "radial-gradient(red, blue)", "unsupported-kind"],
    ["repeating", "repeating-linear-gradient(red, blue 20px)", "length-position"],
    ["vendor prefix", "-webkit-linear-gradient(red, blue)", "legacy-syntax"],
    ["single stop", "linear-gradient(red)", "too-few-stops"],
  ];

  it.each(cases)("gives %s no lens and no diagnostics by default", (_n, value, code) => {
    const g = analyze(css(value), "css").items[0];
    expect(g.status).toBe("skipped");
    expect(g.skip?.code).toBe(code);
    expect(g.lens).toBeNull();
    expect(g.diagnostics).toEqual([]);
    expect(g.score).toBeUndefined();
  });

  it.each(cases)("gives %s a neutral lens when showSkipped is on", (_n, value, code) => {
    const g = analyze(css(value), "css", { showSkipped: true }).items[0];
    expect(g.lens?.title).toBe(`Not scored - ${skipWords(code)}`);
    expect(g.diagnostics).toEqual([]);
  });

  it("explains an unknown skip code with the code itself", () => {
    expect(skipWords("something-new")).toBe("something-new");
    expect(skipWords("constructor")).toBe("constructor");
  });

  it("does not look up prototype keys as skip words", () => {
    expect(skipWords("__proto__")).toBe("__proto__");
    expect(skipWords("toString")).toBe("toString");
  });

  it("defaults showSkipped to off", () => {
    expect(DEFAULT_SETTINGS.showSkipped).toBe(false);
  });
});

describe("severity and minScore", () => {
  it("has no default minScore", () => {
    expect(DEFAULT_SETTINGS.minScore).toBeUndefined();
    expect(normalizeSettings({}).minScore).toBeUndefined();
  });

  it("never reports an error without minScore", () => {
    const sev = analyze(css(ROUGH), "css").items[0].diagnostics.map((d) => d.severity);
    expect(new Set(sev)).toEqual(new Set(["warning"]));
    expect(sev).not.toContain("error");
  });

  it("maps info findings to info and error findings to warning", () => {
    const smooth = analyze(css(SMOOTH), "css").items[0];
    expect(smooth.issues.map((i) => i.severity)).toEqual(["info"]);
    expect(smooth.diagnostics.map((d) => d.severity)).toEqual(["info"]);
    const rough = analyze(css(ROUGH), "css").items[0];
    expect(rough.issues.map((i) => i.severity)).toContain("error");
    expect(rough.diagnostics.map((d) => d.severity)).not.toContain("error");
  });

  it("turns diagnostics into errors only below minScore", () => {
    const below = analyze(css(ROUGH), "css", { minScore: 70 }).items[0];
    expect(new Set(below.diagnostics.map((d) => d.severity))).toEqual(new Set(["error"]));
    const above = analyze(css(ROUGH), "css", { minScore: 50 }).items[0];
    expect(above.diagnostics.map((d) => d.severity)).not.toContain("error");
  });

  it("treats a score equal to minScore as not below", () => {
    const g = analyze(css(ROUGH), "css", { minScore: 58 }).items[0];
    expect(g.diagnostics.map((d) => d.severity)).not.toContain("error");
  });

  it("only changes severity, never the findings, lens or score", () => {
    const a = analyze(css(ROUGH), "css").items[0];
    const b = analyze(css(ROUGH), "css", { minScore: 99 }).items[0];
    expect(b.score).toBe(a.score);
    expect(b.lens).toEqual(a.lens);
    expect(b.diagnostics.map((d) => [d.code, d.range, d.message])).toEqual(a.diagnostics.map((d) => [d.code, d.range, d.message]));
  });

  it("ignores a minScore of null or garbage", () => {
    for (const v of [null, undefined, "70", Number.NaN, Infinity - Infinity]) {
      expect(normalizeSettings({ minScore: v }).minScore).toBeUndefined();
    }
  });
});

describe("settings", () => {
  it("clamps numbers into their ranges", () => {
    expect(normalizeSettings({ minScore: 250 }).minScore).toBe(100);
    expect(normalizeSettings({ minScore: -5 }).minScore).toBe(0);
    expect(normalizeSettings({ maxFileSizeKB: 99999 }).maxFileSizeKB).toBe(2000);
    expect(normalizeSettings({ maxFileSizeKB: 0 }).maxFileSizeKB).toBe(1);
  });

  it("falls back to defaults for wrong types", () => {
    const s = normalizeSettings({ showSkipped: "yes", maxFileSizeKB: "big", maxGradients: null });
    expect(s).toEqual({ ...DEFAULT_SETTINGS });
  });

  it("accepts null and undefined input", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("defaults the size cap to 500 KB", () => {
    expect(DEFAULT_SETTINGS.maxFileSizeKB).toBe(500);
  });
});

describe("limits and robustness", () => {
  it("does not analyse a document over the size cap", () => {
    const text = css(ROUGH) + " ".repeat(500 * 1024);
    const a = analyze(text, "css");
    expect(a.limit).toBe("size");
    expect(a.items).toEqual([]);
  });

  it("analyses a document just under the cap", () => {
    const text = css(ROUGH) + " ".repeat(500 * 1024 - css(ROUGH).length);
    expect(utf8Length(text)).toBe(500 * 1024);
    const a = analyze(text, "css");
    expect(a.limit).toBeUndefined();
    expect(a.items).toHaveLength(1);
  });

  it("honours a lower cap from settings", () => {
    const text = css(ROUGH) + " ".repeat(20 * 1024);
    expect(analyze(text, "css", { maxFileSizeKB: 10 }).limit).toBe("size");
    expect(analyze(text, "css", { maxFileSizeKB: 50 }).limit).toBeUndefined();
  });

  it("rejects a huge document without scanning it", () => {
    const text = "x".repeat(3 * 1024 * 1024);
    const t0 = Date.now();
    const a = analyze(text, "css");
    expect(a.limit).toBe("size");
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("caps the number of gradients analysed", () => {
    const text = Array.from({ length: 4000 }, () => css(ROUGH)).join("\n");
    expect(text.length).toBeLessThan(500 * 1024);
    const a = analyze(text, "css");
    expect(a.items).toHaveLength(DEFAULT_SETTINGS.maxGradients);
    expect(a.limit).toBe("count");
  });

  it("lets settings lower the gradient cap", () => {
    const text = Array.from({ length: 50 }, () => css(ROUGH)).join("\n");
    const a = analyze(text, "css", { maxGradients: 10 });
    expect(a.items).toHaveLength(10);
    expect(a.limit).toBe("count");
  });

  it("stops at the time budget and says so", () => {
    const text = Array.from({ length: 1200 }, () => css(ROUGH)).join("\n");
    const a = analyze(text, "css", { budgetMs: 0.0001 });
    expect(a.limit).toBe("time");
    expect(a.items.length).toBeLessThan(1200);
    expect(a.items.length).toBeGreaterThan(0);
  });

  it("finishes pathological nesting quickly", () => {
    const text = "linear-gradient(".repeat(20000);
    const t0 = Date.now();
    const a = analyze(text, "css");
    expect(Date.now() - t0).toBeLessThan(3000);
    for (const g of a.items) expect(g.status).toBe("skipped");
  });

  it("never throws on non-string input", () => {
    for (const v of [null, undefined, 42, {}, []]) {
      expect(() => analyze(v as unknown as string, "css")).not.toThrow();
      expect(analyze(v as unknown as string, "css").items).toEqual([]);
    }
  });

  it("never throws on random garbage that mentions gradients", () => {
    const rand = rng(7);
    const alphabet = ["linear-gradient(", "(", ")", ",", " ", "#fff", "50%", "var(--a)", "\n", "/*", "*/", '"', "'", "`", "${", "}", "calc(", "red", "deg"];
    for (let i = 0; i < 200; i++) {
      const text = Array.from({ length: 40 }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");
      expect(() => analyze(text, "javascript", { showSkipped: true })).not.toThrow();
    }
  });

  it("keeps every range inside the text and ordered", () => {
    const rand = rng(11);
    const alphabet = ["linear-gradient(", ")", ",", " ", "#ff0000", "#00ff00 50%", "90deg", "\r\n", "é", "🎨"];
    for (let i = 0; i < 100; i++) {
      const text = Array.from({ length: 30 }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");
      let last = -1;
      for (const g of analyze(text, "css", { showSkipped: true }).items) {
        expect(g.range.start).toBeGreaterThanOrEqual(last);
        expect(g.range.end).toBeLessThanOrEqual(text.length);
        last = g.range.start;
        for (const d of g.diagnostics) expect(d.range.end).toBeLessThanOrEqual(text.length);
      }
    }
  });

  it("agrees with the core parser on the ranges", () => {
    const text = css(ROUGH) + "\n" + css(SMOOTH);
    const core = parseGradient(text).gradients.map((g) => g.range);
    expect(analyze(text, "css").items.map((g) => g.range)).toEqual(core);
  });
});

describe("lookup helpers", () => {
  const text = css(ROUGH) + "\n" + css(SMOOTH);
  const items = analyze(text, "css").items;

  it("finds the gradient under an offset", () => {
    expect(gradientAt(items, items[0].range.start + 3)).toBe(items[0]);
    expect(gradientAt(items, items[1].range.end)).toBe(items[1]);
  });

  it("finds nothing between gradients", () => {
    expect(gradientAt(items, 2)).toBeUndefined();
  });

  it("finds the gradients a selection touches", () => {
    expect(gradientsIn(items, 0, text.length)).toHaveLength(2);
    expect(gradientsIn(items, items[1].range.start, items[1].range.start)).toEqual([items[1]]);
    expect(gradientsIn(items, 0, 1)).toEqual([]);
  });
});
