import { describe, expect, it } from "vitest";
import postcssScss from "postcss-scss";
import postcssLess from "postcss-less";
import { RED_BLUE, ROUGH, SMOOTH, lint, slice } from "./helpers";

const min = (n: number) => ({ "opal42/min-score": n });
const finding = (c: string[]) => ({ "opal42/no-finding": c });
const FIXED = "linear-gradient(90deg, #00a600, #00ff00 50%, #006900)";

describe("source positions", () => {
  it("maps columns with tab indentation", async () => {
    const code = `a {\n\t\tbackground: ${ROUGH};\n}\n`;
    const [w] = (await lint(code, min(70))).warnings;
    expect(slice(code, w)).toBe(ROUGH);
    expect([w.line, w.column]).toEqual([2, 15]);
  });

  it("maps positions in CRLF files", async () => {
    const code = `a {\r\n  background:\r\n    linear-gradient(\r\n      90deg,\r\n      #ff0000,\r\n      #00ff00 50%,\r\n      #0000ff\r\n    );\r\n}\r\n`;
    const [w] = (await lint(code, min(70))).warnings;
    expect([w.line, w.column, w.endLine, w.endColumn]).toEqual([3, 5, 8, 6]);
    const f = (await lint(code, finding(["lightness/reversal"]))).warnings[0];
    expect([f.line, f.column, f.endLine, f.endColumn]).toEqual([6, 7, 6, 18]);
  });

  it("counts columns in UTF-16 units after astral characters", async () => {
    const code = `a { /* 🎨 */ background: ${ROUGH}; }`;
    const [w] = (await lint(code, min(70))).warnings;
    expect(slice(code, w)).toBe(ROUGH);
  });

  it("maps the offending stops of a gradient written across lines with comments", async () => {
    const code = `a {\n  background: linear-gradient(\n    90deg, /* dir */\n    #ff0000, /* a */\n    #00ff00 50%, // not a comment in CSS? no: plain CSS has none\n    #0000ff\n  );\n}\n`.replace(" // not a comment in CSS? no: plain CSS has none", " /* b */");
    const [w] = (await lint(code, finding(["lightness/reversal"]))).warnings;
    expect(slice(code, w)).toBe("#00ff00 50%");
    expect([w.line, w.column, w.endLine, w.endColumn]).toEqual([5, 5, 5, 16]);
  });
});

describe("SCSS (postcss-scss)", () => {
  const scss = { customSyntax: postcssScss };

  it("scores $variables and nested rules", async () => {
    const code = `$hero: ${ROUGH};\n.a {\n  &:hover {\n    background: ${RED_BLUE};\n  }\n}\n`;
    const r = await lint(code, min(90), scss);
    expect(r.warnings.map((w) => slice(code, w))).toEqual([ROUGH, RED_BLUE]);
    expect(r.warnings.map((w) => w.line)).toEqual([1, 4]);
  });

  it("locates stops after // comments", async () => {
    const code = `.a {\n  background: linear-gradient(\n    90deg, // direction\n    #ff0000, // first\n    #00ff00 50%, // mid\n    #0000ff // last\n  );\n}\n`;
    const r = await lint(code, finding(["lightness/reversal", "hue/wide-arc"]), scss);
    expect(r.warnings.map((w) => slice(code, w))).toEqual(["#ff0000, // first\n    #00ff00 50%, // mid\n    #0000ff", "#00ff00 50%"]);
    const [gradient] = (await lint(code, min(70), scss)).warnings;
    expect([gradient.line, gradient.column, gradient.endLine, gradient.endColumn]).toEqual([2, 15, 7, 4]);
  });

  it("fixes a gradient with // comments and keeps them", async () => {
    const code = `.a {\n  background: linear-gradient(\n    90deg, // direction\n    #ff0000, // first\n    #00ff00 50%, // mid\n    #0000ff // last\n  );\n}\n`;
    const r = await lint(code, min(70), { ...scss, fix: true });
    expect(r.output).toBe(
      `.a {\n  background: linear-gradient(\n    90deg, // direction\n    #00a600, // first\n    #00ff00 50%, // mid\n    #006900 // last\n  );\n}\n`,
    );
    expect(r.warnings).toHaveLength(0);
  });

  it("fixes a $variable and is idempotent", async () => {
    const code = `$hero: ${ROUGH};\n`;
    const first = await lint(code, min(70), { ...scss, fix: true });
    expect(first.output).toBe(`$hero: ${FIXED};\n`);
    expect((await lint(first.output, min(70), { ...scss, fix: true })).output).toBe(first.output);
  });

  it("skips what it cannot resolve: variables, interpolation, functions, maps", async () => {
    const code = [
      "$a: red; $b: blue; $dir: to right;",
      ".x {",
      "  a: linear-gradient($a, $b);",
      "  b: linear-gradient(#{$dir}, red, blue);",
      "  c: linear-gradient(to right, rgba($a, .5), transparent);",
      "  d: linear-gradient(darken($a, 10%), $b);",
      "  e: linear-gradient(90deg, $a 0%, #00ff00 50%, $b 100%);",
      "}",
    ].join("\n");
    const rules = { ...min(100), ...finding(["hue/wide-arc"]), "opal42/valid-gradient": true };
    expect((await lint(code, rules, { ...scss, fix: true })).warnings).toHaveLength(0);
    expect((await lint(code, rules, { ...scss, fix: true })).output).toBe(code);
  });

  it("scores a gradient inside an SCSS map value", async () => {
    const code = `$themes: (\n  hero: ${ROUGH},\n);\n`;
    const r = await lint(code, min(70), scss);
    expect(r.warnings.map((w) => slice(code, w))).toEqual([ROUGH]);
  });
});

describe("Less (postcss-less) - best effort", () => {
  const less = { customSyntax: postcssLess };

  it("scores declarations and @variables", async () => {
    const code = `@hero: ${ROUGH};\n.a {\n  background: ${RED_BLUE};\n}\n`;
    const r = await lint(code, min(90), less);
    expect(r.warnings.map((w) => slice(code, w))).toEqual([ROUGH, RED_BLUE]);
  });

  it("fixes declarations and @variables", async () => {
    const code = `@hero: ${ROUGH};\n.a { background: ${ROUGH}; }\n`;
    const r = await lint(code, min(70), { ...less, fix: true });
    expect(r.output).toBe(`@hero: ${FIXED};\n.a { background: ${FIXED}; }\n`);
  });

  it("skips @variables inside gradients", async () => {
    const code = `.a { background: linear-gradient(@from, @to); b: linear-gradient(90deg, @c 0%, #00ff00 50%, #0000ff); }\n`;
    expect((await lint(code, { ...min(100), "opal42/valid-gradient": true }, less)).warnings).toHaveLength(0);
  });
});

describe("plain CSS things", () => {
  it("does not report the same gradient twice for rules that share a declaration", async () => {
    const code = `a { background: ${ROUGH}; }`;
    const r = await lint(code, { ...min(70), ...finding(["hue/wide-arc"]) });
    expect(r.warnings.map((w) => w.rule).sort()).toEqual(["opal42/min-score", "opal42/no-finding"]);
  });

  it("a smooth gradient is clean under all three rules", async () => {
    const rules = { ...min(100), ...finding(["hue/wide-arc", "lightness/reversal", "chroma/muddy-midpoint"]), "opal42/valid-gradient": true };
    expect((await lint(`a { background: ${SMOOTH}; }`, rules)).warnings).toHaveLength(0);
  });
});
