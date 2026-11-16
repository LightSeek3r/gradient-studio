import { describe, expect, it } from "vitest";
import postcssScss from "postcss-scss";
import { ROUGH, lint, slice, wrap } from "./helpers";

const on = { "opal42/valid-gradient": true };

describe("opal42/valid-gradient", () => {
  it.each([
    ["an unknown direction side", "linear-gradient(to nowhere, red, blue)", "syntax", "'to' must be followed by a side"],
    ["a trailing comma", "linear-gradient(red, blue,)", "syntax", "empty argument"],
    ["an empty argument", "linear-gradient(red, , blue)", "syntax", "empty argument"],
    ["too many positions", "linear-gradient(red 10% 20% 30%, blue)", "syntax", "a colour stop is a colour and at most two positions"],
    ["a gradient inside a gradient", "linear-gradient(red, linear-gradient(blue, red))", "syntax", "a gradient cannot contain another gradient"],
  ])("reports %s at the exact range of the gradient", async (_n, gradient, codeName, reason) => {
    const code = wrap(gradient);
    const r = await lint(code, on);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].text).toBe(`Invalid gradient (${codeName}): ${reason} (opal42/valid-gradient)`);
    expect(slice(code, r.warnings[0])).toBe(gradient);
    expect(r.warnings[0].line).toBe(2);
    expect(r.warnings[0].column).toBe(15);
  });

  it("reports an unbalanced gradient (name and opening parenthesis)", async () => {
    // A custom property may hold a block; the scanner ends an open gradient at `{`.
    const code = ":root { --x: linear-gradient(red {a}, blue); }";
    const r = await lint(code, on);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].text).toContain("Invalid gradient (unbalanced)");
    expect(slice(code, r.warnings[0])).toBe("linear-gradient(");
  });

  it("reports each broken gradient of a declaration", async () => {
    const code = wrap(`linear-gradient(red,), ${ROUGH}, linear-gradient(to x, red, blue)`);
    const r = await lint(code, on);
    expect(r.warnings.map((w) => slice(code, w))).toEqual(["linear-gradient(red,)", "linear-gradient(to x, red, blue)"]);
  });

  it.each([
    ["valid gradients", ROUGH],
    ["var()", "linear-gradient(var(--a), red)"],
    ["calc()", "linear-gradient(red calc(10% + 5px), blue)"],
    ["length stops", "linear-gradient(red 10px, blue 20px)"],
    ["radial", "radial-gradient(circle at 50% 50%, red, blue)"],
    ["conic", "conic-gradient(from 90deg, red, blue)"],
    ["repeating", "repeating-linear-gradient(45deg, red 0 10px, blue 10px 20px)"],
    ["legacy -webkit-", "-webkit-linear-gradient(left, red, blue)"],
    ["-webkit-gradient()", "-webkit-gradient(linear, left top, left bottom, from(red), to(blue))"],
    ["color-mix()", "linear-gradient(color-mix(in oklab, red, blue), blue)"],
    ["wide-gamut colours", "linear-gradient(color(display-p3 1 0 0), lab(50% 40 59.5))"],
    ["hints", "linear-gradient(red, 30%, blue)"],
    ["interpolation space", "linear-gradient(in oklch longer hue, red, blue)"],
  ])("does not report %s (a limit of the scorer, not a mistake)", async (_n, gradient) => {
    expect((await lint(wrap(gradient), on)).warnings).toHaveLength(0);
  });

  it("does not report SCSS variables, functions and interpolation", async () => {
    const code = [
      "$a: red; $b: blue; $c: #123456; $d: to right;",
      ".x {",
      "  a: linear-gradient($a, $b);",
      "  b: linear-gradient(#{$d}, red, blue);",
      "  c: linear-gradient(to right, rgba($c, .5), transparent);",
      "  d: linear-gradient(darken($c, 10%), $c);",
      "  e: linear-gradient(to right, $a 0%, $b 100%);",
      "}",
    ].join("\n");
    expect((await lint(code, on, { customSyntax: postcssScss })).warnings).toHaveLength(0);
  });

  it("ignores gradients inside quoted strings", async () => {
    expect((await lint('a { content: "linear-gradient(to x, red, blue)"; }', on)).warnings).toHaveLength(0);
  });

  it("the properties option filters", async () => {
    const code = "a { background: linear-gradient(red,); mask-image: linear-gradient(blue,); }";
    const r = await lint(code, { "opal42/valid-gradient": [true, { properties: ["mask-image"] }] });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].column).toBeGreaterThan(code.indexOf("mask-image"));
  });

  it("only accepts true as primary option", async () => {
    expect((await lint(wrap(ROUGH), { "opal42/valid-gradient": "yes" })).invalid.length).toBeGreaterThan(0);
  });

  it("has no autofix", async () => {
    const code = wrap("linear-gradient(red,)");
    const r = await lint(code, on, { fix: true });
    expect(r.output).toBe(code);
    expect(r.warnings).toHaveLength(1);
  });
});
