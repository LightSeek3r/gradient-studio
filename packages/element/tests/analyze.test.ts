import { describe, expect, it } from "vitest";
import { V1_FINDING_CODES } from "@opal42/gradient";
import { analyzeCss, isSafeGradient, MAX_INPUT_LENGTH, refineCss, swatchBackgrounds } from "../src/analyze";
import { createTranslate, DEFAULT_MESSAGES, parseMessagesJson } from "../src/messages";
import { ALPHA, RADIAL, ROUGH, SMOOTH, VARS } from "./helpers";

describe("analyzeCss: states", () => {
  it("scores a scorable gradient", () => {
    const r = analyzeCss(SMOOTH);
    expect(r.status).toBe("ok");
    expect(r.score).toBeGreaterThan(0);
    expect(Number.isInteger(r.score)).toBe(true);
    expect(r.invalid).toBeNull();
    expect(r.skipped).toBeNull();
  });
  it("lists coded findings for a rough gradient", () => {
    const r = analyzeCss(ROUGH);
    expect(r.status).toBe("ok");
    expect(r.findings.length).toBeGreaterThan(0);
    for (const f of r.findings) expect(Object.keys(V1_FINDING_CODES)).toContain(f.code);
  });
  it("reports empty and whitespace-only text as empty", () => {
    expect(analyzeCss("").status).toBe("empty");
    expect(analyzeCss("  \n\t ").status).toBe("empty");
    expect(analyzeCss(null).status).toBe("empty");
    expect(analyzeCss(undefined).status).toBe("empty");
  });
  it("reports text without a gradient as invalid", () => {
    const r = analyzeCss("color: red;");
    expect(r.status).toBe("invalid");
    expect(r.invalid?.code).toBe("no-gradient");
    expect(r.score).toBeNull();
  });
  it("reports unsupported kinds as skipped with a reason", () => {
    const r = analyzeCss(RADIAL);
    expect(r.status).toBe("skipped");
    expect(r.skipped?.code).toBe("unsupported-kind");
    expect(r.skipped?.reason.length).toBeGreaterThan(0);
    expect(r.swatch).toEqual([]);
    expect(r.css).toBeNull();
  });
  it("skips var() gradients and keeps no swatch", () => {
    const r = analyzeCss(VARS);
    expect(r.status).toBe("skipped");
    expect(r.skipped?.code).toBe("var");
    expect(r.swatch).toEqual([]);
  });
  it("skips translucent gradients but still paints them", () => {
    const r = analyzeCss(ALPHA);
    expect(r.status).toBe("skipped");
    expect(r.skipped?.code).toBe("alpha");
    expect(r.swatch.length).toBeGreaterThan(0);
  });
  it("skips repeating gradients", () => {
    const r = analyzeCss("repeating-linear-gradient(90deg, #ff0000 0%, #0000ff 20%)");
    expect(r.status).toBe("skipped");
    expect(r.skipped?.code).toBe("repeating");
  });
  it("skips legacy syntax", () => {
    expect(analyzeCss("-webkit-linear-gradient(top, #fff, #000)").status).toBe("skipped");
  });
  it("reports an unclosed gradient as skipped", () => {
    expect(analyzeCss("linear-gradient(90deg, #fff, #000").skipped?.code).toBe("unbalanced");
  });
});

describe("analyzeCss: several gradients and index", () => {
  const multi = `a { background: ${RADIAL}; } b { background: ${SMOOTH}; } c { background: ${ROUGH}; }`;
  it("shows the first scorable one by default", () => {
    const r = analyzeCss(multi);
    expect(r.gradients).toBe(3);
    expect(r.index).toBe(1);
    expect(r.status).toBe("ok");
  });
  it("shows the first gradient when none is scorable", () => {
    const r = analyzeCss(`${RADIAL} ${VARS}`);
    expect(r.index).toBe(0);
    expect(r.status).toBe("skipped");
  });
  it("picks by index", () => {
    expect(analyzeCss(multi, { index: 2 }).index).toBe(2);
    expect(analyzeCss(multi, { index: 0 }).status).toBe("skipped");
  });
  it("different indexes can give different scores", () => {
    expect(analyzeCss(multi, { index: 1 }).score).not.toBe(analyzeCss(multi, { index: 2 }).score);
  });
  it("rejects an index out of range, negative or fractional as invalid", () => {
    for (const index of [3, 99, -1, 1.5, Number.NaN]) {
      const r = analyzeCss(multi, { index });
      expect(r.status).toBe("invalid");
      expect(r.invalid?.code).toBe("index-out-of-range");
    }
  });
  it("accepts index null as automatic", () => {
    expect(analyzeCss(multi, { index: null }).index).toBe(1);
  });
});

describe("analyzeCss: fixes", () => {
  it("proposes the best fix with a positive gain", () => {
    const r = analyzeCss("linear-gradient(90deg,#ff0000,#0000ff)", { withFix: true });
    expect(r.fix).not.toBeNull();
    expect(r.fix!.gain).toBeGreaterThan(0);
    expect(r.fix!.after).toBe(r.fix!.before + r.fix!.gain);
    expect(isSafeGradient(r.fix!.css)).toBe(true);
    expect(r.fix!.swatch.length).toBeGreaterThan(0);
  });
  it("computes no fix unless asked", () => {
    expect(analyzeCss("linear-gradient(90deg,#ff0000,#0000ff)").fix).toBeNull();
  });
  it("has no fix when there are no findings", () => {
    const r = analyzeCss(SMOOTH, { withFix: true });
    if (r.findings.length === 0) expect(r.fix).toBeNull();
  });
});

describe("refineCss", () => {
  it("returns CSS for a scorable gradient and never lowers the score", () => {
    const css = refineCss(ROUGH);
    expect(css).not.toBeNull();
    expect(analyzeCss(css!).score!).toBeGreaterThanOrEqual(analyzeCss(ROUGH).score!);
  });
  it("returns null when nothing is scorable", () => {
    expect(refineCss("")).toBeNull();
    expect(refineCss(RADIAL)).toBeNull();
    expect(refineCss("nonsense")).toBeNull();
  });
  it("honours the index", () => {
    expect(refineCss(`${SMOOTH} ${ROUGH}`, 1)).not.toBeNull();
    expect(refineCss(`${SMOOTH} ${ROUGH}`, 7)).toBeNull();
  });
});

describe("normalised css, stops and swatch", () => {
  it("rebuilds the CSS from the document", () => {
    const r = analyzeCss("LINEAR-GRADIENT( 90DEG , RED , BLUE )");
    expect(r.css).toBe("linear-gradient(90deg, #ff0000, #0000ff)");
    expect(r.stops).toEqual(["#ff0000", "#0000ff"]);
  });
  it("gives an sRGB fallback before a native oklab value", () => {
    const r = analyzeCss("linear-gradient(90deg in oklab, #ff0000, #0000ff)");
    expect(r.swatch).toHaveLength(2);
    expect(r.swatch[0]).not.toContain("oklab");
    expect(r.swatch[1]).toContain("in oklab");
  });
  it("gives one value for plain sRGB gradients", () => {
    expect(analyzeCss(SMOOTH).swatch).toHaveLength(1);
  });
  it("swatchBackgrounds returns [] for an invalid document", () => {
    expect(swatchBackgrounds({ kind: "linear", angle: 0, stops: [] })).toEqual([]);
    expect(swatchBackgrounds({ kind: "linear", angle: 0, stops: [{ color: "javascript:x" }, { color: "#fff" }] })).toEqual([]);
  });
});

describe("isSafeGradient allow-list", () => {
  it("accepts what toCSS prints", () => {
    for (const s of [SMOOTH, "linear-gradient(0deg, #000000, #ffffff)", "linear-gradient(45.5deg in oklch longer hue, #000000 0%, rgb(1 2 3 / 0.5) 50%, #ffffff)"]) {
      expect(isSafeGradient(s)).toBe(true);
    }
  });
  it("rejects anything else", () => {
    const bad = [
      "linear-gradient(90deg, url(javascript:alert(1)), #fff)",
      "linear-gradient(90deg, #fff, #000); background: url(x)",
      "linear-gradient(90deg, #fff, #000)}</style><script>",
      "linear-gradient(90deg, red, #000000)",
      "linear-gradient(90deg, #fff, #000000)",
      "linear-gradient(90deg, #ffffff, #000000) !important",
      "linear-gradient(90deg, #ffffff, #000000\\)",
      "url(x)",
      "",
      42,
      null,
      "x".repeat(5000),
    ];
    for (const b of bad) expect(isSafeGradient(b)).toBe(false);
  });
});

describe("input cap", () => {
  it("the cap is 20 KB", () => {
    expect(MAX_INPUT_LENGTH).toBe(20 * 1024);
  });
  it("flags and truncates larger input", () => {
    const r = analyzeCss(`${SMOOTH} ${"/* x */ ".repeat(5000)}`);
    expect(r.truncated).toBe(true);
    expect(r.status).toBe("ok");
  });
  it("does not see a gradient that starts after the cap", () => {
    const r = analyzeCss(`${" ".repeat(MAX_INPUT_LENGTH)}${SMOOTH}`);
    expect(r.truncated).toBe(true);
    expect(r.status).toBe("empty");
  });
  it("an input of exactly the cap is not truncated", () => {
    const pad = " ".repeat(MAX_INPUT_LENGTH - SMOOTH.length);
    expect(analyzeCss(SMOOTH + pad).truncated).toBe(false);
    expect(analyzeCss(SMOOTH + pad + " ").truncated).toBe(true);
  });
  it("coerces non-strings", () => {
    expect(analyzeCss(12345).status).toBe("invalid");
    expect(analyzeCss({ toString: () => SMOOTH }).status).toBe("ok");
  });
});

describe("messages", () => {
  it("has a name and a sentence for every v1 finding code", () => {
    for (const code of Object.keys(V1_FINDING_CODES)) {
      expect(DEFAULT_MESSAGES[`rule.${code}.name`], code).toBeTruthy();
      expect(DEFAULT_MESSAGES[`rule.${code}.measures`], code).toBeTruthy();
    }
  });
  it("uses no verdict words (PLAN D5)", () => {
    const verdicts = /\b(excellent|good|bad|poor|great|terrible|ugly|beautiful|quality|fail|pass(ed)?)\b/i;
    for (const [k, v] of Object.entries(DEFAULT_MESSAGES)) expect(v, k).not.toMatch(verdicts);
  });
  it("fills placeholders and keeps unknown ones", () => {
    const t = createTranslate();
    expect(t("group.ok", { label: "A", score: 5 })).toBe("A: smoothness score 5 out of 100");
    expect(t("fix.gain", { n: 3 })).toContain("{before}");
  });
  it("lets a host override and ignores non-strings", () => {
    const t = createTranslate({ "score.name": "Indice", "score.outOf": 5, bogus: "x" });
    expect(t("score.name")).toBe("Indice");
    expect(t("score.outOf")).toBe("out of 100");
    expect(t.has("bogus")).toBe(true);
  });
  it("falls back to the key tail for unknown keys", () => {
    expect(createTranslate()("nope.thing")).toBe("thing");
  });
  it("tolerates garbage overrides", () => {
    for (const bad of [null, undefined, 5, "x", [1, 2]]) expect(createTranslate(bad)("score.name")).toBe("Smoothness score");
  });
  it("parses the JSON attribute safely", () => {
    expect(parseMessagesJson('{"score.name":"S"}')).toEqual({ "score.name": "S" });
    expect(parseMessagesJson("{bad")).toBeNull();
    expect(parseMessagesJson("[1]")).toBeNull();
    expect(parseMessagesJson(null)).toBeNull();
    expect(parseMessagesJson("x".repeat(30_000))).toBeNull();
    expect(parseMessagesJson('{"a":1}')).toBeNull();
  });
  it("does not pollute prototypes through __proto__ keys", () => {
    const parsed = parseMessagesJson('{"__proto__":"x","score.name":"S"}');
    expect(({} as Record<string, unknown>).score).toBeUndefined();
    expect(Object.getPrototypeOf(parsed ?? {})).toBe(Object.prototype);
  });
});
