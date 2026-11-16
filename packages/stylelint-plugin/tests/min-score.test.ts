import { describe, expect, it } from "vitest";
import { GAPS, RAINBOW, RED_BLUE, ROUGH, SMOOTH, lint, slice, wrap } from "./helpers";

const rule = (n: unknown, secondary?: object) => ({ "opal42/min-score": secondary ? [n, secondary] : n });

describe("opal42/min-score", () => {
  it("reports a gradient below the threshold with its score, the minimum and the largest deductions", async () => {
    const r = await lint(wrap(ROUGH), rule(70));
    expect(r.invalid).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].text).toBe(
      "Gradient smoothness score 58 is below the minimum 70; largest deductions: hue/wide-arc -20, lightness/reversal -12, chroma/muddy-midpoint -10 (opal42/min-score)",
    );
    expect(r.warnings[0].rule).toBe("opal42/min-score");
  });

  it("locates the whole gradient function: line, column, endLine, endColumn", async () => {
    const code = wrap(ROUGH);
    const [w] = (await lint(code, rule(70))).warnings;
    expect([w.line, w.column, w.endLine, w.endColumn]).toEqual([2, 15, 2, 68]);
    expect(slice(code, w)).toBe(ROUGH);
  });

  it("is inclusive: a score equal to the threshold passes, one above fails", async () => {
    expect((await lint(wrap(ROUGH), rule(58))).warnings).toHaveLength(0);
    expect((await lint(wrap(ROUGH), rule(59))).warnings).toHaveLength(1);
  });

  it("passes gradients at or above the threshold", async () => {
    expect((await lint(wrap(SMOOTH), rule(100))).warnings).toHaveLength(0);
    expect((await lint(wrap(RED_BLUE), rule(87))).warnings).toHaveLength(0);
  });

  it("a threshold of 0 never reports", async () => {
    expect((await lint(wrap(RAINBOW), rule(0))).warnings).toHaveLength(0);
  });

  it("lists at most three deductions, biggest first", async () => {
    const [w] = (await lint(wrap(RAINBOW), rule(100))).warnings;
    expect(w.text).toContain(
      "Gradient smoothness score 45 is below the minimum 100; largest deductions: lightness/reversal -48, hue/wide-arc -20, chroma/saturation-range -5",
    );
  });

  it("uses the neutral wording: smoothness score, never quality", async () => {
    const [w] = (await lint(wrap(ROUGH), rule(100))).warnings;
    expect(w.text.toLowerCase()).toContain("smoothness score");
    expect(w.text.toLowerCase()).not.toContain("quality");
  });

  describe("option validation: the threshold has no default", () => {
    it.each([
      ["true", true],
      ["a string", "70"],
      ["above 100", 101],
      ["negative", -1],
      ["NaN", Number.NaN],
    ])("rejects %s", async (_n, value) => {
      const r = await lint(wrap(ROUGH), rule(value));
      expect(r.invalid.length).toBeGreaterThan(0);
      expect(r.warnings).toHaveLength(0);
    });

    it("rejects an unknown secondary option", async () => {
      const r = await lint(wrap(ROUGH), rule(70, { nope: true }));
      expect(r.invalid[0].text).toContain('Invalid option name "nope"');
    });

    it("rejects a non-boolean secondary option", async () => {
      const r = await lint(wrap(ROUGH), rule(70, { skipAlpha: "yes" }));
      expect(r.invalid.length).toBeGreaterThan(0);
    });

    it("null switches the rule off", async () => {
      expect((await lint(wrap(ROUGH), { "opal42/min-score": null })).warnings).toHaveLength(0);
    });
  });

  describe("what is scored", () => {
    it("scores gradients in custom properties", async () => {
      const code = ":root {\n  --hero: linear-gradient(90deg, #ff0000, #00ff00 50%, #0000ff);\n}\n";
      const [w] = (await lint(code, rule(70))).warnings;
      expect(slice(code, w)).toBe(ROUGH);
      expect([w.line, w.column]).toEqual([2, 11]);
    });

    it("scores a custom property written without a space after the colon", async () => {
      const code = `:root{--hero:${ROUGH}}`;
      const [w] = (await lint(code, rule(70))).warnings;
      expect(slice(code, w)).toBe(ROUGH);
    });

    it("scores the gradient layer of a background shorthand with url()", async () => {
      const code = `a {\n  background: url(img/a.png) center / cover no-repeat, ${ROUGH}, #fff;\n}\n`;
      const [w] = (await lint(code, rule(70))).warnings;
      expect(slice(code, w)).toBe(ROUGH);
    });

    it("does not look inside url()", async () => {
      const code = 'a { background: url("data:image/svg+xml;utf8,<svg>linear-gradient(red,blue)</svg>"); }';
      expect((await lint(code, rule(100))).warnings).toHaveLength(0);
    });

    it("scores declarations nested in @media, @supports and nested rules", async () => {
      const code = `@media (min-width: 600px) {\n  @supports (display: grid) {\n    .a {\n      & .b { background-image: ${ROUGH} !important; }\n    }\n  }\n}\n`;
      const [w] = (await lint(code, rule(70))).warnings;
      expect(w.line).toBe(4);
      expect(slice(code, w)).toBe(ROUGH);
    });

    it("reports each gradient of a multi-layer declaration with its own range", async () => {
      const code = wrap(`${ROUGH}, ${RED_BLUE}, ${SMOOTH}`);
      const r = await lint(code, rule(90));
      expect(r.warnings.map((w) => slice(code, w))).toEqual([ROUGH, RED_BLUE]);
      expect(r.warnings.map((w) => w.text.match(/score (\d+)/)?.[1])).toEqual(["58", "87"]);
    });

    it("locates a gradient that spans several lines", async () => {
      const code = `a {\n  background:\n    linear-gradient(\n      90deg,\n      #ff0000,\n      #00ff00 50%,\n      #0000ff\n    ),\n    ${SMOOTH};\n}\n`;
      const [w] = (await lint(code, rule(70))).warnings;
      expect([w.line, w.column, w.endLine, w.endColumn]).toEqual([3, 5, 8, 6]);
      expect(slice(code, w)).toBe("linear-gradient(\n      90deg,\n      #ff0000,\n      #00ff00 50%,\n      #0000ff\n    )");
    });

    it("locates correctly with comments in the value", async () => {
      const code = `a {\n  background: /* top */ linear-gradient(90deg, /* a */ #ff0000, #00ff00 50%, #0000ff); /* tail */\n}\n`;
      const [w] = (await lint(code, rule(70))).warnings;
      expect(slice(code, w)).toBe("linear-gradient(90deg, /* a */ #ff0000, #00ff00 50%, #0000ff)");
    });

    it("ignores gradients inside quoted strings", async () => {
      expect((await lint(`a { content: "${ROUGH}"; }`, rule(100))).warnings).toHaveLength(0);
    });

    it("never reports radial, conic, repeating or vendor-prefixed gradients by default", async () => {
      const code = wrap(
        "radial-gradient(red, blue), conic-gradient(red, lime, blue), repeating-linear-gradient(red 0 10px, blue 10px 20px), -webkit-linear-gradient(left, red, blue)",
      );
      expect((await lint(code, rule(100))).warnings).toHaveLength(0);
    });
  });

  describe("options", () => {
    const VAR = "linear-gradient(90deg, var(--a), var(--b))";
    const ALPHA = "linear-gradient(#000, transparent)";
    const STRIPES = "linear-gradient(red 50%, blue 50%)";

    it("ignoreUnscorable (default true) leaves unscorable gradients alone", async () => {
      expect((await lint(wrap(VAR), rule(100))).warnings).toHaveLength(0);
    });

    it("ignoreUnscorable: false reports them with the skip code", async () => {
      const code = wrap(VAR);
      const [w] = (await lint(code, rule(100, { ignoreUnscorable: false }))).warnings;
      expect(w.text).toBe("Gradient was not scored (var: var() cannot be resolved statically) (opal42/min-score)");
      expect(slice(code, w)).toBe(VAR);
    });

    it("ignoreUnscorable: false also reports radial and repeating gradients", async () => {
      const r = await lint(
        wrap("radial-gradient(red, blue), repeating-linear-gradient(red 0%, blue 20%)"),
        rule(0, { ignoreUnscorable: false }),
      );
      expect(r.warnings.map((w) => w.text.match(/\((\S+?):/)?.[1])).toEqual(["unsupported-kind", "repeating"]);
    });

    it("skipAlpha (default true) skips translucent gradients, even with ignoreUnscorable: false", async () => {
      expect((await lint(wrap(ALPHA), rule(100))).warnings).toHaveLength(0);
      expect((await lint(wrap(ALPHA), rule(100, { ignoreUnscorable: false }))).warnings).toHaveLength(0);
    });

    it("skipAlpha: false scores the colour channels only", async () => {
      const r = await lint(wrap(ALPHA), rule(100, { skipAlpha: false }));
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].text).toMatch(/^Gradient smoothness score \d+ is below the minimum 100/);
    });

    it("skipHardStops (default true) skips stripes", async () => {
      expect((await lint(wrap(STRIPES), rule(100))).warnings).toHaveLength(0);
    });

    it("skipHardStops: false scores them (v1 numbers are not adjusted for stripes)", async () => {
      const r = await lint(wrap(STRIPES), rule(100, { skipHardStops: false }));
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].text).toContain("score 67");
    });

    it("properties: an exact name, case-insensitive for normal properties", async () => {
      const code = `a { background: ${ROUGH}; border-image: ${ROUGH}; }`;
      const r = await lint(code, rule(70, { properties: ["Border-Image"] }));
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].column).toBe(code.indexOf("border-image") + "border-image: ".length + 1);
    });

    it("properties: a /regex/ string and a RegExp", async () => {
      const code = `a { background: ${ROUGH}; --x: ${ROUGH}; mask-image: ${ROUGH}; }`;
      expect((await lint(code, rule(70, { properties: ["/^--/"] }))).warnings).toHaveLength(1);
      expect((await lint(code, rule(70, { properties: [/image$/] }))).warnings).toHaveLength(1);
      expect((await lint(code, rule(70, { properties: ["background", "/^--/", /image$/] }))).warnings).toHaveLength(3);
    });

    it("properties: custom property names match exactly (case-sensitive)", async () => {
      const code = `a { --Hero: ${ROUGH}; }`;
      expect((await lint(code, rule(70, { properties: ["--hero"] }))).warnings).toHaveLength(0);
      expect((await lint(code, rule(70, { properties: ["--Hero"] }))).warnings).toHaveLength(1);
    });

    it("the standard severity secondary option works", async () => {
      const r = await lint(wrap(ROUGH), rule(70, { severity: "warning" }));
      expect(r.warnings[0].severity).toBe("warning");
      expect(r.errored).toBe(false);
    });
  });

  it("boundary check on a second fixture (74 passes, 75 fails)", async () => {
    expect((await lint(wrap(GAPS), rule(74))).warnings).toHaveLength(0);
    expect((await lint(wrap(GAPS), rule(75))).warnings).toHaveLength(1);
  });

  it("respects stylelint-disable comments", async () => {
    const code = `a {\n  /* stylelint-disable-next-line opal42/min-score */\n  background: ${ROUGH};\n  background-image: ${ROUGH};\n}\n`;
    const r = await lint(code, rule(70));
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].line).toBe(4);
  });
});
