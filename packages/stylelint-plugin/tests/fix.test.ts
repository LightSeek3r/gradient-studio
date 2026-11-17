import { describe, expect, it } from "vitest";
import { parseGradient, scoreParsed } from "@opal42/gradient";
import { GAPS, RAINBOW, RED_BLUE, ROUGH, SMOOTH, lint, wrap } from "./helpers";

const min = (n: number, secondary?: object) => ({ "opal42/min-score": secondary ? [n, secondary] : n });
const codes = (c: string[], secondary?: object) => ({ "opal42/no-finding": secondary ? [c, secondary] : c });

/** The smoothness score of the only gradient in `css`. */
function scoreOf(css: string): number {
  const { gradients } = parseGradient(css);
  expect(gradients).toHaveLength(1);
  const r = scoreParsed(gradients[0]);
  if (r.status !== "ok") throw new Error(`unscorable: ${r.code}`);
  return r.score;
}

describe("autofix: opal42/min-score", () => {
  it("without --fix the source is never changed", async () => {
    const code = wrap(ROUGH);
    const r = await lint(code, min(70));
    expect(r.output).toBe(code);
    expect(r.warnings).toHaveLength(1);
  });

  it("rewrites only the stops that need it, exactly (targeted fix)", async () => {
    const r = await lint(wrap(ROUGH), min(70), { fix: true });
    expect(r.output).toBe(wrap("linear-gradient(90deg, #00a600, #00ff00 50%, #006900)"));
    expect(r.warnings).toHaveLength(0);
  });

  it("goes as far as needed for a higher threshold", async () => {
    expect((await lint(wrap(ROUGH), min(90), { fix: true })).output).toBe(wrap("linear-gradient(90deg, #00a600, #009000 50%, #006900)"));
    // After the first fix all three stops are greens of ONE hue (equal to ~1e-13°). Which of them
    // `hue/narrow-arc` names used to depend on Math.cbrt/atan2 noise (Node 22 and 24 differed).
    // Under the D8 tie rule (docs/DETERMINISM.md) a single tie group names its lowest and highest
    // index, [0, 2], and the cheapest fix edits stop 3; it scores 100, like the old answer.
    expect((await lint(wrap(ROUGH), min(99), { fix: true })).output).toBe(wrap("linear-gradient(90deg, #00a600, #009000 50%, #4b5f00)"));
  });

  it("keeps named colours that it does not change and writes the changed one as hex", async () => {
    expect((await lint(wrap(RED_BLUE), min(90), { fix: true })).output).toBe(wrap("linear-gradient(#fc0046, blue)"));
  });

  it("moves a stop position when that is the fix", async () => {
    expect((await lint(wrap(GAPS), min(85), { fix: true })).output).toBe(wrap("linear-gradient(90deg, #ff0000 0%, #ff8800 38%, #ffff00 100%)"));
  });

  it("the fixed gradient scores strictly higher and reaches the threshold", async () => {
    for (const [g, m] of [[ROUGH, 70], [ROUGH, 95], [RED_BLUE, 100], [GAPS, 100], [RAINBOW, 90]] as const) {
      const out = (await lint(wrap(g), min(m), { fix: true })).output;
      const body = out.split("\n")[1].replace(/^\s*background:\s*|;$/g, "");
      expect(scoreOf(body)).toBeGreaterThan(scoreOf(g));
      expect(scoreOf(body)).toBeGreaterThanOrEqual(m);
    }
  });

  it("is idempotent: a second --fix pass changes nothing and reports nothing", async () => {
    for (const [g, m] of [[ROUGH, 70], [ROUGH, 99], [RED_BLUE, 90], [GAPS, 85]] as const) {
      const first = await lint(wrap(g), min(m), { fix: true });
      const second = await lint(first.output, min(m), { fix: true });
      expect(second.output).toBe(first.output);
      expect(second.warnings).toHaveLength(0);
    }
  });

  it("does not change a gradient that already passes", async () => {
    const code = wrap(ROUGH);
    expect((await lint(code, min(58), { fix: true })).output).toBe(code);
  });

  it("offers no fix when no rewrite reaches the threshold: source unchanged, problem still reported", async () => {
    const code = wrap(RAINBOW);
    const r = await lint(code, min(100), { fix: true });
    expect(r.output).toBe(code);
    expect(r.warnings).toHaveLength(1);
  });

  it("keeps direction, interpolation clause, whitespace and comments byte for byte (an unchanged stop keeps its text)", async () => {
    const code = "a {\n  background: linear-gradient(\n    in oklch 90deg, /* start */\n    #ff0000,\n    #00ff00   50%, /* mid */\n    #0000ff /* end */\n  );\n}\n";
    const r = await lint(code, min(70), { fix: true });
    expect(r.output).toBe(
      "a {\n  background: linear-gradient(\n    in oklch 90deg, /* start */\n    #00a600,\n    #00ff00   50%, /* mid */\n    #006900 /* end */\n  );\n}\n",
    );
  });

  it("keeps the other layers of a background shorthand, url() included", async () => {
    const code = `a {\n  background: url(img/a.png) center / cover no-repeat, ${ROUGH};\n}\n`;
    const r = await lint(code, min(70), { fix: true });
    expect(r.output).toBe(
      "a {\n  background: url(img/a.png) center / cover no-repeat, linear-gradient(90deg, #00a600, #00ff00 50%, #006900);\n}\n",
    );
  });

  it("keeps !important and surrounding declarations", async () => {
    const code = `a {\n  color: red;\n  background-image: ${ROUGH} !important;\n  margin: 0;\n}\n`;
    const r = await lint(code, min(70), { fix: true });
    expect(r.output).toBe(
      "a {\n  color: red;\n  background-image: linear-gradient(90deg, #00a600, #00ff00 50%, #006900) !important;\n  margin: 0;\n}\n",
    );
  });

  it("fixes custom properties and declarations in @media", async () => {
    const code = `@media (min-width: 1px) {\n  :root { --hero: ${ROUGH}; }\n}\n`;
    const r = await lint(code, min(70), { fix: true });
    expect(r.output).toBe("@media (min-width: 1px) {\n  :root { --hero: linear-gradient(90deg, #00a600, #00ff00 50%, #006900); }\n}\n");
  });

  it("fixes each declaration independently", async () => {
    const code = `a { background: ${ROUGH}; }\nb { background: ${ROUGH}; }\nc { background: ${SMOOTH}; }\n`;
    const r = await lint(code, min(70), { fix: true });
    const g = "linear-gradient(90deg, #00a600, #00ff00 50%, #006900)";
    expect(r.output).toBe(`a { background: ${g}; }\nb { background: ${g}; }\nc { background: ${SMOOTH}; }\n`);
  });

  describe("never touches", () => {
    it("a declaration with more than one gradient (problems are still reported)", async () => {
      const code = wrap(`${ROUGH}, ${RED_BLUE}`);
      const r = await lint(code, min(90), { fix: true });
      expect(r.output).toBe(code);
      expect(r.warnings).toHaveLength(2);
    });

    it("a gradient with a colour hint", async () => {
      const code = wrap("linear-gradient(red, 30%, blue)");
      const r = await lint(code, min(95), { fix: true });
      expect(r.output).toBe(code);
      expect(r.warnings).toHaveLength(1);
    });

    it("a gradient with a double-position stop", async () => {
      const code = wrap("linear-gradient(#ff0000 0% 20%, #00ff00 50%, #0000ff)");
      const r = await lint(code, min(95), { fix: true });
      expect(r.output).toBe(code);
      expect(r.warnings).toHaveLength(1);
    });

    it("hard stops, even when they are scored (skipHardStops: false)", async () => {
      const code = wrap("linear-gradient(red 50%, blue 50%)");
      const r = await lint(code, min(100, { skipHardStops: false }), { fix: true });
      expect(r.output).toBe(code);
      expect(r.warnings).toHaveLength(1);
    });

    it("translucent gradients, even when they are scored (skipAlpha: false)", async () => {
      const code = wrap("linear-gradient(#ff0000, #00ff00 50%, rgb(0 0 255 / 0.5))");
      const r = await lint(code, min(100, { skipAlpha: false }), { fix: true });
      expect(r.output).toBe(code);
      expect(r.warnings).toHaveLength(1);
    });

    it.each([
      ["var()", "linear-gradient(90deg, var(--a), #00ff00 50%, #0000ff)"],
      ["calc()", "linear-gradient(90deg, #ff0000, #00ff00 calc(50% + 1px), #0000ff)"],
      ["radial", "radial-gradient(#ff0000, #00ff00, #0000ff)"],
      ["conic", "conic-gradient(#ff0000, #00ff00, #0000ff)"],
      ["repeating", "repeating-linear-gradient(90deg, #ff0000 0%, #00ff00 10%, #0000ff 20%)"],
      ["legacy prefixed", "-webkit-linear-gradient(left, #ff0000, #00ff00 50%, #0000ff)"],
      ["length positions", "linear-gradient(90deg, #ff0000 0px, #00ff00 50px, #0000ff 100px)"],
      ["color-mix()", "linear-gradient(90deg, color-mix(in srgb, red, blue), #00ff00, #0000ff)"],
      ["display-p3", "linear-gradient(90deg, color(display-p3 1 0 0), #00ff00, #0000ff)"],
    ])("a %s gradient", async (_n, gradient) => {
      const code = wrap(gradient);
      const r = await lint(code, min(100, { ignoreUnscorable: false }), { fix: true });
      expect(r.output).toBe(code);
    });

    it("a gradient inside a string", async () => {
      const code = `a { content: "${ROUGH}"; }`;
      expect((await lint(code, min(100), { fix: true })).output).toBe(code);
    });

    it("the declaration when stylelint's disableFix is set", async () => {
      const code = wrap(ROUGH);
      const r = await lint(code, min(70, { disableFix: true }), { fix: true });
      expect(r.output).toBe(code);
      expect(r.warnings).toHaveLength(1);
    });

    it("anything under a stylelint-disable comment", async () => {
      const code = `a {\n  /* stylelint-disable-next-line opal42/min-score */\n  background: ${ROUGH};\n}\n`;
      expect((await lint(code, min(70), { fix: true })).output).toBe(code);
    });
  });
});

describe("autofix: opal42/no-finding", () => {
  it("applies the targeted fix for the forbidden code", async () => {
    const r = await lint(wrap(ROUGH), codes(["hue/wide-arc"]), { fix: true });
    expect(r.output).toBe(wrap("linear-gradient(90deg, #00a600, #00ff00 50%, #006900)"));
    expect(r.warnings).toHaveLength(0);
  });

  it("applies one rewrite that removes several forbidden codes", async () => {
    const r = await lint(wrap(ROUGH), codes(["hue/wide-arc", "lightness/reversal", "chroma/muddy-midpoint"]), { fix: true });
    expect(r.output).toBe(wrap("linear-gradient(90deg, #ff0000, #689800 50%, #006912)"));
    expect(r.warnings).toHaveLength(0);
  });

  it("fixes a spacing finding by moving the stop", async () => {
    const r = await lint(wrap(GAPS), codes(["rhythm/uneven-gaps"]), { fix: true });
    expect(r.output).toBe(wrap("linear-gradient(90deg, #ff0000 0%, #ff8800 38%, #ffff00 100%)"));
  });

  it("leaves codes that are not forbidden alone", async () => {
    const code = wrap(ROUGH);
    const r = await lint(code, codes(["rhythm/uneven-gaps"]), { fix: true });
    expect(r.output).toBe(code);
  });

  it("a finding with no targeted fix stays reported and the source stays unchanged", async () => {
    const code = wrap(RAINBOW);
    const r = await lint(code, codes(["lightness/reversal"]), { fix: true });
    expect(r.output).toBe(code);
    expect(r.warnings).toHaveLength(1);
  });

  it("fixes what it can and keeps reporting what it cannot", async () => {
    const r = await lint(wrap(RAINBOW), codes(["lightness/reversal", "chroma/saturation-range"]), { fix: true });
    expect(r.warnings.map((w) => w.text.match(/finding (\S+)/)?.[1])).toEqual(["lightness/reversal"]);
    expect(r.output).not.toBe(wrap(RAINBOW));
    const body = r.output.split("\n")[1].replace(/^\s*background:\s*|;$/g, "");
    expect(scoreOf(body)).toBeGreaterThan(scoreOf(RAINBOW));
  });

  it("is idempotent", async () => {
    const rules = codes(["hue/wide-arc", "chroma/muddy-midpoint"]);
    const first = await lint(wrap(ROUGH), rules, { fix: true });
    const second = await lint(first.output, rules, { fix: true });
    expect(second.output).toBe(first.output);
    expect(second.warnings).toHaveLength(0);
  });

  it("does not fix a declaration with several gradients", async () => {
    const code = wrap(`${ROUGH}, ${RED_BLUE}`);
    const r = await lint(code, codes(["hue/wide-arc"]), { fix: true });
    expect(r.output).toBe(code);
    expect(r.warnings).toHaveLength(2);
  });
});

describe("autofix: both rules in one config", () => {
  it("the output after one pass satisfies both rules", async () => {
    const rules = { ...min(80), ...codes(["hue/wide-arc"]) };
    const first = await lint(wrap(ROUGH), rules, { fix: true });
    expect((await lint(first.output, rules)).warnings).toHaveLength(0);
  });
});
