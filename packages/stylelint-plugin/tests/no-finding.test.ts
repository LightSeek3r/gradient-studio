import { describe, expect, it } from "vitest";
import { RAINBOW, RED_BLUE, ROUGH, SMOOTH, lint, slice, wrap } from "./helpers";

const rule = (codes: unknown, secondary?: object) => ({ "opal42/no-finding": secondary ? [codes, secondary] : codes });

describe("opal42/no-finding", () => {
  it("reports a forbidden finding at the exact stops it names", async () => {
    const code = wrap(ROUGH);
    const r = await lint(code, rule(["lightness/reversal"]));
    expect(r.warnings).toHaveLength(1);
    const [w] = r.warnings;
    expect(slice(code, w)).toBe("#00ff00 50%");
    expect([w.line, w.column, w.endLine, w.endColumn]).toEqual([2, 47, 2, 58]);
  });

  it("a finding that spans several stops is reported from the first to the last", async () => {
    const code = wrap(ROUGH);
    const [w] = (await lint(code, rule(["hue/wide-arc"]))).warnings;
    expect(slice(code, w)).toBe("#ff0000, #00ff00 50%, #0000ff");
    expect([w.line, w.column, w.endLine, w.endColumn]).toEqual([2, 38, 2, 67]);
  });

  it("cites the code and the points lost in the message", async () => {
    const [w] = (await lint(wrap(ROUGH), rule(["hue/wide-arc"]))).warnings;
    expect(w.text).toBe(
      "Unexpected smoothness finding hue/wide-arc (-20 points): Hue arc spans >180° — colors clash unexpectedly (opal42/no-finding)",
    );
  });

  it("reports every forbidden finding, one problem each, in source order", async () => {
    const code = wrap(ROUGH);
    const r = await lint(code, rule(["lightness/reversal", "hue/wide-arc", "chroma/muddy-midpoint"]));
    expect(r.warnings.map((w) => w.text.match(/finding (\S+)/)?.[1])).toEqual(["hue/wide-arc", "lightness/reversal", "chroma/muddy-midpoint"]);
  });

  it("only reports the codes that are listed", async () => {
    const r = await lint(wrap(ROUGH), rule(["rhythm/uneven-gaps", "hue/narrow-arc"]));
    expect(r.warnings).toHaveLength(0);
  });

  it("does not report gradients without findings", async () => {
    const r = await lint(wrap(SMOOTH), rule(["hue/wide-arc", "lightness/reversal"]));
    expect(r.warnings).toHaveLength(0);
  });

  it("accepts a single code as a string", async () => {
    const r = await lint(wrap(RED_BLUE), rule("hue/wide-arc"));
    expect(r.invalid).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });

  it("an empty list is a no-op", async () => {
    const r = await lint(wrap(ROUGH), rule([]));
    expect(r.invalid).toEqual([]);
    expect(r.warnings).toHaveLength(0);
  });

  describe("option validation", () => {
    it.each([
      ["an unknown code", ["hue/wide-arcs"]],
      ["a number", [3]],
      ["a dimension, not a code", ["hue"]],
      ["Object.prototype keys", ["constructor"]],
    ])("rejects %s", async (_n, value) => {
      const r = await lint(wrap(ROUGH), rule(value));
      expect(r.invalid.length).toBeGreaterThan(0);
    });

    it("rejects true (a list of codes is required)", async () => {
      const r = await lint(wrap(ROUGH), rule(true));
      expect(r.invalid.length).toBeGreaterThan(0);
    });

    it("ignoreUnscorable is not an option of this rule", async () => {
      const r = await lint(wrap(ROUGH), rule(["hue/wide-arc"], { ignoreUnscorable: false }));
      expect(r.invalid.length).toBeGreaterThan(0);
    });
  });

  describe("scope", () => {
    it("reports in custom properties, shorthand layers and nested at-rules", async () => {
      const code = `@media print {\n  :root { --a: ${ROUGH}; }\n  b { background: url(x.png), ${ROUGH}; }\n}\n`;
      const r = await lint(code, rule(["lightness/reversal"]));
      expect(r.warnings.map((w) => w.line)).toEqual([2, 3]);
      expect(r.warnings.map((w) => slice(code, w))).toEqual(["#00ff00 50%", "#00ff00 50%"]);
    });

    it("reports each gradient of a multi-layer declaration separately", async () => {
      const code = wrap(`${ROUGH}, ${RED_BLUE}`);
      const r = await lint(code, rule(["hue/wide-arc"]));
      expect(r.warnings).toHaveLength(2);
      expect(r.warnings.map((w) => slice(code, w))).toEqual(["#ff0000, #00ff00 50%, #0000ff", "red, blue"]);
    });

    it("skips hard stops and translucent gradients by default", async () => {
      const code = wrap("linear-gradient(red 50%, blue 50%), linear-gradient(#000, transparent)");
      expect((await lint(code, rule(["hue/wide-arc", "rhythm/edge-gap"]))).warnings).toHaveLength(0);
      const r = await lint(wrap("linear-gradient(red 50%, blue 50%)"), rule(["rhythm/edge-gap"], { skipHardStops: false }));
      expect(r.warnings).toHaveLength(1);
    });

    it("never looks at unscorable gradients", async () => {
      const code = wrap("linear-gradient(var(--a), var(--b)), radial-gradient(red, blue), repeating-linear-gradient(red 0%, blue 10%)");
      expect((await lint(code, rule(["hue/wide-arc"]))).warnings).toHaveLength(0);
    });

    it("properties filter applies", async () => {
      const code = `a { background: ${ROUGH}; --x: ${ROUGH}; }`;
      const r = await lint(code, rule(["hue/wide-arc"], { properties: ["/^--/"] }));
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].column).toBeGreaterThan(code.indexOf("--x"));
    });
  });

  it("the rainbow's reversal is reported with its points", async () => {
    const [w] = (await lint(wrap(RAINBOW), rule(["lightness/reversal"]))).warnings;
    expect(w.text).toContain("lightness/reversal (-48 points)");
  });
});
