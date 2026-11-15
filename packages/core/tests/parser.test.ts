// Table-driven tests for the CSS gradient scanner/parser (spec/parser.md).

import { describe, expect, it } from "vitest";
import { parseCssColor, parseGradient, type ParsedGradient, type Stop } from "../src/index";

/** The single gradient of `css`, with the offset invariants every result must satisfy. */
function one(css: string): ParsedGradient {
  const { gradients } = parseGradient(css);
  expect(gradients).toHaveLength(1);
  checkRanges(css, gradients[0]);
  return gradients[0];
}

function checkRanges(css: string, g: ParsedGradient): void {
  const text = css.slice(g.range.start, g.range.end);
  expect(text).toMatch(/^(-webkit-|-moz-|-o-|-ms-)?(repeating-)?((linear|radial|conic)-)?gradient\(/i);
  if (g.skipped?.code !== "unbalanced") expect(text.endsWith(")")).toBe(true);
  for (const r of g.stopRanges) {
    expect(r.start).toBeGreaterThan(g.range.start);
    expect(r.end).toBeLessThan(g.range.end);
    const s = css.slice(r.start, r.end);
    expect(s).toBe(s.trim());
    expect(s.length).toBeGreaterThan(0);
  }
  if (g.document) {
    expect(g.skipped).toBeUndefined();
    expect(g.stopRanges).toHaveLength(g.document.stops.length);
  } else {
    expect(g.skipped).toBeDefined();
  }
  if (g.angleRange) {
    expect(g.angleRange.start).toBeGreaterThan(g.range.start);
    expect(g.angleRange.end).toBeLessThan(g.range.end);
  }
}

const stopsOf = (css: string): Stop[] => {
  const g = one(css);
  expect(g.skipped).toBeUndefined();
  return g.document!.stops;
};

// ── Angles and directions ─────────────────────────────────────────────────────

describe("linear-gradient direction", () => {
  it.each<[string, number]>([
    ["linear-gradient(red, blue)", 180],
    ["linear-gradient(0deg, red, blue)", 0],
    ["linear-gradient(45deg, red, blue)", 45],
    ["linear-gradient(-45deg, red, blue)", -45],
    ["linear-gradient(+90deg, red, blue)", 90],
    ["linear-gradient(135.5deg, red, blue)", 135.5],
    ["linear-gradient(.5turn, red, blue)", 180],
    ["linear-gradient(0.25turn, red, blue)", 90],
    ["linear-gradient(1turn, red, blue)", 360],
    ["linear-gradient(100grad, red, blue)", 90],
    ["linear-gradient(200grad, red, blue)", 180],
    ["linear-gradient(3.141592653589793rad, red, blue)", 180],
    ["linear-gradient(0, red, blue)", 0],
    ["linear-gradient(-0deg, red, blue)", 0],
    ["linear-gradient(450deg, red, blue)", 450],
    ["linear-gradient(1e2deg, red, blue)", 100],
    ["linear-gradient(90DEG, red, blue)", 90],
    ["linear-gradient(to top, red, blue)", 0],
    ["linear-gradient(to right, red, blue)", 90],
    ["linear-gradient(to bottom, red, blue)", 180],
    ["linear-gradient(to left, red, blue)", 270],
    ["linear-gradient(TO RIGHT, red, blue)", 90],
    ["linear-gradient(to top right, red, blue)", 45],
    ["linear-gradient(to right top, red, blue)", 45],
    ["linear-gradient(to bottom right, red, blue)", 135],
    ["linear-gradient(to right bottom, red, blue)", 135],
    ["linear-gradient(to bottom left, red, blue)", 225],
    ["linear-gradient(to left bottom, red, blue)", 225],
    ["linear-gradient(to top left, red, blue)", 315],
    ["linear-gradient(to left top, red, blue)", 315],
    ["linear-gradient(  to   right  ,red,blue)", 90],
    ["linear-gradient(in oklab, red, blue)", 180],
    ["linear-gradient(90deg in oklch, red, blue)", 90],
    ["linear-gradient(in oklch 90deg, red, blue)", 90],
    ["linear-gradient(in srgb to left, red, blue)", 270],
  ])("%s → %d°", (css, angle) => {
    const g = one(css);
    expect(g.skipped).toBeUndefined();
    expect(g.document!.angle).toBeCloseTo(angle, 10);
    expect(Object.is(g.document!.angle, -0)).toBe(false);
    expect(g.kind).toBe("linear");
    expect(g.repeating).toBe(false);
  });

  it.each<[string, string | undefined]>([
    ["linear-gradient(red, blue)", undefined],
    ["linear-gradient(45deg, red, blue)", "45deg"],
    ["linear-gradient( to  bottom   right , red, blue)", "to  bottom   right"],
    ["linear-gradient(to left in oklch, red, blue)", "to left"],
    ["linear-gradient(in oklch .25turn, red, blue)", ".25turn"],
    ["linear-gradient(in oklab, red, blue)", undefined],
  ])("angleRange of %s", (css, text) => {
    const g = one(css);
    expect(g.angleRange && css.slice(g.angleRange.start, g.angleRange.end)).toBe(text);
  });

  it("warns that a corner keyword depends on the box", () => {
    const g = one("linear-gradient(to top right, red, blue)");
    expect(g.warnings.map((w) => w.code)).toEqual(["corner-angle"]);
    expect(one("linear-gradient(to right, red, blue)").warnings).toEqual([]);
  });

  it.each<[string, object | undefined]>([
    ["linear-gradient(red, blue)", undefined],
    ["linear-gradient(in srgb, red, blue)", { space: "srgb" }],
    ["linear-gradient(in oklab, red, blue)", { space: "oklab" }],
    ["linear-gradient(in oklch, red, blue)", { space: "oklch" }],
    ["linear-gradient(in OKLCH, red, blue)", { space: "oklch" }],
    ["linear-gradient(in oklch shorter hue, red, blue)", { space: "oklch", hue: "shorter" }],
    ["linear-gradient(in oklch longer hue, red, blue)", { space: "oklch", hue: "longer" }],
    ["linear-gradient(in oklch increasing hue, red, blue)", { space: "oklch", hue: "increasing" }],
    ["linear-gradient(to right in oklch decreasing hue, red, blue)", { space: "oklch", hue: "decreasing" }],
  ])("interpolation of %s", (css, interpolation) => {
    expect(one(css).document!.interpolation).toEqual(interpolation);
  });

  it.each<[string, string]>([
    ["linear-gradient(to, red, blue)", "syntax"],
    ["linear-gradient(to middle, red, blue)", "syntax"],
    ["linear-gradient(to top bottom, red, blue)", "syntax"],
    ["linear-gradient(to left right, red, blue)", "syntax"],
    ["linear-gradient(45, red, blue)", "syntax"],
    ["linear-gradient(45px, red, blue)", "syntax"],
    ["linear-gradient(45deg 90deg, red, blue)", "syntax"],
    ["linear-gradient(in, red, blue)", "syntax"],
    ["linear-gradient(in bogus, red, blue)", "syntax"],
    ["linear-gradient(in oklab longer hue, red, blue)", "syntax"],
    ["linear-gradient(in oklch longer, red, blue)", "syntax"],
    ["linear-gradient(in oklch in oklab, red, blue)", "syntax"],
    ["linear-gradient(in hsl, red, blue)", "interpolation-space"],
    ["linear-gradient(in hsl longer hue, red, blue)", "interpolation-space"],
    ["linear-gradient(in srgb-linear, red, blue)", "interpolation-space"],
    ["linear-gradient(in lch, red, blue)", "interpolation-space"],
    ["linear-gradient(in display-p3, red, blue)", "interpolation-space"],
    ["linear-gradient(calc(45deg + 10deg), red, blue)", "calc"],
    ["linear-gradient(calc(1turn / 8) in oklch, red, blue)", "calc"],
    ["linear-gradient(var(--angle), red, blue)", "var"],
    ["linear-gradient(to right var(--x), red, blue)", "var"],
    ["linear-gradient(${angle}deg, red, blue)", "preprocessor"],
    ["linear-gradient($angle, red, blue)", "preprocessor"],
  ])("%s is skipped as %s", (css, code) => {
    const g = one(css);
    expect(g.document).toBeNull();
    expect(g.skipped!.code).toBe(code);
    expect(g.skipped!.reason.length).toBeGreaterThan(0);
  });
});

// ── Colours ───────────────────────────────────────────────────────────────────

describe("stop colours", () => {
  it.each<[string, string, number?]>([
    ["#f00", "#ff0000"],
    ["#F00", "#ff0000"],
    ["#abc", "#aabbcc"],
    ["#f008", "#ff0000", 0x88 / 255],
    ["#ffff", "#ffffff"],
    ["#0000", "#000000", 0],
    ["#ff8800", "#ff8800"],
    ["#FF8800", "#ff8800"],
    ["#ff880080", "#ff8800", 0x80 / 255],
    ["#ff8800ff", "#ff8800"],
    ["#00000000", "#000000", 0],
    ["rgb(255, 0, 0)", "#ff0000"],
    ["rgb(255,0,0)", "#ff0000"],
    ["RGB(255, 0, 0)", "#ff0000"],
    ["rgb( 12 , 34 , 56 )", "#0c2238"],
    ["rgb(100%, 0%, 50%)", "#ff0080"],
    ["rgb(300, -20, 127.5)", "#ff0080"],
    ["rgb(255, 0, 0, 0.5)", "#ff0000", 0.5],
    ["rgba(255, 0, 0, 0.5)", "#ff0000", 0.5],
    ["rgba(255, 0, 0, .25)", "#ff0000", 0.25],
    ["rgba(255, 0, 0, 50%)", "#ff0000", 0.5],
    ["rgba(255, 0, 0, 1)", "#ff0000"],
    ["rgba(255, 0, 0, 7)", "#ff0000"],
    ["rgba(255, 0, 0, -1)", "#ff0000", 0],
    ["rgba(0,0,0,0)", "#000000", 0],
    ["rgba(255, 0, 0)", "#ff0000"],
    ["rgb(255 0 0)", "#ff0000"],
    ["rgb(255 0 0 / 0.5)", "#ff0000", 0.5],
    ["rgb(255 0 0 / 50%)", "#ff0000", 0.5],
    ["rgb(255 0 0/.5)", "#ff0000", 0.5],
    ["rgba(255 0 0 / 100%)", "#ff0000"],
    ["rgb(100% 0% 0%)", "#ff0000"],
    ["rgb(50% 128 0)", "#808000"],
    ["rgb(1e2 0 0)", "#640000"],
    ["rgb(59 130 246 / 0.8)", "#3b82f6", 0.8],
    ["hsl(0, 100%, 50%)", "#ff0000"],
    ["hsl(120, 100%, 50%)", "#00ff00"],
    ["hsl(240, 100%, 50%)", "#0000ff"],
    ["hsl(120, 100%, 25%)", "#008000"],
    ["hsl(210, 100%, 50%)", "#0080ff"],
    ["hsl(0, 0%, 50%)", "#808080"],
    ["hsl(0, 0%, 100%)", "#ffffff"],
    ["hsl(0, 0%, 0%)", "#000000"],
    ["hsl(360, 100%, 50%)", "#ff0000"],
    ["hsl(-120, 100%, 50%)", "#0000ff"],
    ["hsl(480, 100%, 50%)", "#00ff00"],
    ["hsl(60, 100%, 50%)", "#ffff00"],
    ["hsl(180, 100%, 50%)", "#00ffff"],
    ["hsl(300, 100%, 50%)", "#ff00ff"],
    ["hsl(120deg, 100%, 50%)", "#00ff00"],
    ["hsl(0.5turn, 100%, 50%)", "#00ffff"],
    ["hsl(200grad, 100%, 50%)", "#00ffff"],
    ["hsl(3.141592653589793rad, 100%, 50%)", "#00ffff"],
    ["hsla(0, 100%, 50%, 0.3)", "#ff0000", 0.3],
    ["hsla(0, 100%, 50%, 30%)", "#ff0000", 0.3],
    ["hsl(0 100% 50%)", "#ff0000"],
    ["hsl(0 100% 50% / 0.5)", "#ff0000", 0.5],
    ["hsl(0deg 100% 50% / 50%)", "#ff0000", 0.5],
    ["hsl(0 100 50)", "#ff0000"],
    ["hsl(0, 150%, 50%)", "#ff0000"],
    ["red", "#ff0000"],
    ["RED", "#ff0000"],
    ["Blue", "#0000ff"],
    ["rebeccapurple", "#663399"],
    ["RebeccaPurple", "#663399"],
    ["grey", "#808080"],
    ["gray", "#808080"],
    ["cyan", "#00ffff"],
    ["aqua", "#00ffff"],
    ["lightgoldenrodyellow", "#fafad2"],
    ["white", "#ffffff"],
    ["black", "#000000"],
    ["transparent", "#000000", 0],
    ["TRANSPARENT", "#000000", 0],
    ["oklab(1 0 0)", "#ffffff"],
    ["oklab(0 0 0)", "#000000"],
    ["oklab(100% 0 0)", "#ffffff"],
    ["oklab(0.5 0 0 / 0.5)", "#636363", 0.5],
    ["oklch(1 0 0)", "#ffffff"],
    ["oklch(0 0 0)", "#000000"],
    ["oklch(100% 0 0deg)", "#ffffff"],
    ["oklch(0.5 0 180)", "#636363"],
    ["oklch(0.5 0 0 / 25%)", "#636363", 0.25],
    ["oklch(2 0 0)", "#ffffff"],
    ["OKLCH(1 0 0)", "#ffffff"],
  ])("%s → %s", (colour, hex, alpha) => {
    const expected: Stop = alpha === undefined ? { color: hex } : { color: hex, alpha };
    const css = `linear-gradient(${colour}, #123456)`;
    const g = one(css);
    expect(g.skipped).toBeUndefined();
    const s = g.document!.stops[0];
    expect(s.color).toBe(expected.color);
    if (expected.alpha === undefined) expect(s.alpha).toBeUndefined();
    else expect(s.alpha).toBeCloseTo(expected.alpha, 10);
    expect(css.slice(g.stopRanges[0].start, g.stopRanges[0].end)).toBe(colour);
    expect(g.document!.stops[1]).toEqual({ color: "#123456" });
    // parseCssColor agrees with the gradient parser.
    const direct = parseCssColor(colour);
    expect(direct?.color).toBe(hex);
    expect(direct?.alpha).toBeCloseTo(alpha ?? 1, 10);
  });

  it.each<[string, [number, number, number]]>([
    // The sRGB primaries in OKLCH / OKLAB (CSS Color 4 reference values).
    ["oklch(0.627955 0.257683 29.2339)", [255, 0, 0]],
    ["oklch(0.86644 0.294827 142.495)", [0, 255, 0]],
    ["oklch(0.452014 0.313214 264.052)", [0, 0, 255]],
    ["oklch(62.7955% 0.257683 29.2339deg)", [255, 0, 0]],
    ["oklab(0.627955 0.224863 0.125846)", [255, 0, 0]],
    ["oklab(0.86644 -0.233888 0.179498)", [0, 255, 0]],
    ["oklab(0.452014 -0.032457 -0.311528)", [0, 0, 255]],
    ["oklab(62.7955% 56.21575% 31.4615%)", [255, 0, 0]],
    ["oklch(0.627955 64.42075% 29.2339)", [255, 0, 0]],
    // Tailwind CSS v4 palette.
    ["oklch(63.7% 0.237 25.331)", [0xfb, 0x2c, 0x36]],
    ["oklch(0.656 0.241 354.308)", [0xf6, 0x33, 0x9a]],
  ])("%s ≈ rgb(%j)", (colour, rgb) => {
    const s = stopsOf(`linear-gradient(${colour}, #000)`)[0];
    const got = [1, 3, 5].map((i) => parseInt(s.color.slice(i, i + 2), 16));
    for (let i = 0; i < 3; i++) expect(Math.abs(got[i] - rgb[i])).toBeLessThanOrEqual(2);
    expect(s.alpha).toBeUndefined();
  });

  it("gamut-maps out-of-sRGB oklch (chroma reduced, hue and lightness kept) and warns", () => {
    const css = "linear-gradient(oklch(0.7 0.4 150), black)";
    const g = one(css);
    expect(g.document!.stops[0].color).toMatch(/^#[0-9a-f]{6}$/);
    expect(g.warnings).toHaveLength(1);
    expect(g.warnings[0].code).toBe("gamut-mapped");
    expect(css.slice(g.warnings[0].range!.start, g.warnings[0].range!.end)).toBe("oklch(0.7 0.4 150)");
    expect(one("linear-gradient(oklch(0.7 0.1 150), black)").warnings).toEqual([]);
  });

  it("keeps alpha only when below 1", () => {
    expect(stopsOf("linear-gradient(rgb(0 0 0 / 1), rgb(0 0 0 / 0.999))")).toEqual([
      { color: "#000000" },
      { color: "#000000", alpha: 0.999 },
    ]);
  });
});

// ── Structured skips ──────────────────────────────────────────────────────────

describe("skip codes", () => {
  it.each<[string, string]>([
    ["var(--brand)", "var"],
    ["var(--brand, #f00)", "var"],
    ["VAR(--x)", "var"],
    ["rgb(var(--r), 0, 0)", "var"],
    ["rgb(var(--rgb) / 0.5)", "var"],
    ["rgb(0 0 0 / var(--tw-bg-opacity))", "var"],
    ["hsl(var(--h) 50% 50%)", "var"],
    ["oklch(var(--l) 0.1 20)", "var"],
    ["calc(1 + 2)", "calc"],
    ["rgb(calc(255 / 2), 0, 0)", "calc"],
    ["hsl(calc(180 + 20) 50% 50%)", "calc"],
    ["rgb(min(255, 300) 0 0)", "calc"],
    ["rgb(clamp(0, 10, 255) 0 0)", "calc"],
    ["env(--x)", "env"],
    ["rgb(env(--r) 0 0)", "env"],
    ["currentColor", "currentColor"],
    ["currentcolor", "currentColor"],
    ["CURRENTCOLOR", "currentColor"],
    ["color-mix(in srgb, red, blue)", "color-mix"],
    ["color-mix(in oklch, red 20%, blue)", "color-mix"],
    ["rgb(from red r g b)", "relative-color"],
    ["rgb(from var(--c) r g b / 50%)", "relative-color"],
    ["hsl(from red h s l)", "relative-color"],
    ["oklch(from red l c h)", "relative-color"],
    ["oklab(from red l a b)", "relative-color"],
    ["lab(from red l a b)", "relative-color"],
    ["lch(from red l c h)", "relative-color"],
    ["color(from red srgb r g b)", "relative-color"],
    ["lab(50% 40 59.5)", "lab-lch"],
    ["lab(50 40 59.5 / 0.5)", "lab-lch"],
    ["lch(52.2% 72.2 50)", "lab-lch"],
    ["LCH(52.2% 72.2 50)", "lab-lch"],
    ["color(display-p3 1 0 0)", "color-function"],
    ["color(srgb 1 0 0)", "color-function"],
    ["color(rec2020 1 0 0 / 0.5)", "color-function"],
    ["color(xyz-d65 0.4 0.2 0.1)", "color-function"],
    ["Canvas", "system-color"],
    ["canvastext", "system-color"],
    ["ButtonFace", "system-color"],
    ["Highlight", "system-color"],
    ["LinkText", "system-color"],
    ["AccentColor", "system-color"],
    ["GrayText", "system-color"],
    ["window", "system-color"],
    ["bleu", "unknown-color"],
    ["constructor", "unknown-color"],
    ["__proto__", "unknown-color"],
    ["toString", "unknown-color"],
    ["hasOwnProperty", "unknown-color"],
    ["inherit", "unknown-color"],
    ["#ff", "unknown-color"],
    ["#fffff", "unknown-color"],
    ["#fffffff", "unknown-color"],
    ["#fffffffff", "unknown-color"],
    ["#ggg", "unknown-color"],
    ["#", "unknown-color"],
    ["rgb()", "unknown-color"],
    ["rgb(255, 0)", "unknown-color"],
    ["rgb(255 0)", "unknown-color"],
    ["rgb(255, 0, 0, 1, 1)", "unknown-color"],
    ["rgb(255 0 0 0.5)", "unknown-color"],
    ["rgb(255, 0, 0 / 0.5)", "unknown-color"],
    ["rgb(255 0, 0)", "unknown-color"],
    ["rgb(100%, 0, 0)", "unknown-color"],
    ["rgb(255px 0 0)", "unknown-color"],
    ["rgb(255 0 0 / 0.5px)", "unknown-color"],
    ["rgb(none 0 0)", "unknown-color"],
    ["rgb(red 0 0)", "unknown-color"],
    ["rgb(#f00)", "unknown-color"],
    ["rgb(rgb(1 2 3) 0 0)", "unknown-color"],
    ["hsl(0, 100, 50)", "unknown-color"],
    ["hsl(0px 100% 50%)", "unknown-color"],
    ["hsl(0 100% 50% 1)", "unknown-color"],
    ["hsl(none 100% 50%)", "unknown-color"],
    ["oklch(0.5, 0.1, 20)", "unknown-color"],
    ["oklch(0.5 0.1)", "unknown-color"],
    ["oklch(0.5 0.1 20px)", "unknown-color"],
    ["oklch(0.5 0.1 none)", "unknown-color"],
    ["oklab(0.5 0.1deg 0)", "unknown-color"],
    ["hwb(0 0% 0%)", "unknown-color"],
    ["light-dark(red, blue)", "unknown-color"],
    ["device-cmyk(0 1 1 0)", "unknown-color"],
    ["theme(colors.red.500)", "unknown-color"],
    ["'red'", "unknown-color"],
    ["$brand", "preprocessor"],
    ["@brand", "preprocessor"],
    ["${brand}", "preprocessor"],
    ["#{$brand}", "preprocessor"],
    ["${p => p.theme.primary}", "preprocessor"],
    ["rgb($r, 0, 0)", "preprocessor"],
    ["rgba($brand, 0.5)", "preprocessor"],
    ["rgb(#{$r} 0 0)", "preprocessor"],
  ])("colour %s → %s", (colour, code) => {
    for (const css of [`linear-gradient(${colour}, blue)`, `linear-gradient(90deg, red 0%, ${colour} 100%)`]) {
      const g = one(css);
      expect(g.document).toBeNull();
      expect(g.skipped!.code).toBe(code);
      expect(g.skipped!.reason.length).toBeGreaterThan(0);
    }
    const css = `linear-gradient(90deg, red 0%, ${colour} 100%)`;
    expect(one(css).stopRanges.map((r) => css.slice(r.start, r.end))).toEqual(["red 0%", `${colour} 100%`]);
    expect(parseCssColor(colour)).toBeNull();
  });

  it.each<[string, string]>([
    ["linear-gradient(red 10px, blue)", "length-position"],
    ["linear-gradient(red, blue 100px)", "length-position"],
    ["linear-gradient(red 1em, blue 2em)", "length-position"],
    ["linear-gradient(red 0%, blue 5rem)", "length-position"],
    ["linear-gradient(red 10vw, blue 50vh)", "length-position"],
    ["linear-gradient(red, 10px, blue)", "length-position"],
    ["linear-gradient(red 0 10px, blue 10px 20px)", "length-position"],
    ["linear-gradient(red 1cm, blue)", "length-position"],
    ["linear-gradient(red 10%, blue calc(100% - 10px))", "calc"],
    ["linear-gradient(red calc(10%), blue)", "calc"],
    ["linear-gradient(red 0% calc(10%), blue)", "calc"],
    ["linear-gradient(red 0% 5% calc(10%), blue)", "calc"],
    ["linear-gradient(red var(--p), blue)", "var"],
    ["linear-gradient(red, blue var(--tw-gradient-to-position))", "var"],
    ["linear-gradient(to right, var(--tw-gradient-stops))", "var"],
    ["linear-gradient(var(--tw-gradient-stops))", "var"],
    ["linear-gradient(red, blue env(--x))", "env"],
    ["linear-gradient(red $p, blue)", "preprocessor"],
    ["linear-gradient(red ${p}%, blue)", "preprocessor"],
    ["linear-gradient(red #{$p}, blue)", "preprocessor"],
    ["linear-gradient(red 10, blue)", "syntax"],
    ["linear-gradient(red 10deg, blue)", "syntax"],
    ["linear-gradient(red 10% 20% 30%, blue)", "syntax"],
    ["linear-gradient(red blue, blue)", "syntax"],
    ["linear-gradient(red / 2, blue)", "syntax"],
    ["linear-gradient()", "syntax"],
    ["linear-gradient(45deg)", "syntax"],
    ["linear-gradient(to right)", "syntax"],
    ["linear-gradient(,)", "syntax"],
    ["linear-gradient(red,, blue)", "syntax"],
    ["linear-gradient(red, blue,)", "syntax"],
    ["linear-gradient(, red, blue)", "syntax"],
    ["linear-gradient(50%, red, blue)", "syntax"],
    ["linear-gradient(red, blue, 50%)", "syntax"],
    ["linear-gradient(red, 20%, 30%, blue)", "syntax"],
    ["linear-gradient(red, blue, 45deg)", "syntax"],
    ["linear-gradient(linear-gradient(red, blue), blue)", "syntax"],
  ])("%s → %s", (css, code) => {
    const { gradients } = parseGradient(css);
    const g = gradients[0];
    checkRanges(css, g);
    expect(g.range).toEqual({ start: 0, end: css.length });
    expect(g.document).toBeNull();
    expect(g.skipped!.code).toBe(code);
  });

  it.each<[string, "linear" | "radial" | "conic", boolean, string[]]>([
    ["radial-gradient(red, blue)", "radial", false, ["red", "blue"]],
    ["radial-gradient(circle, red 0%, blue 100%)", "radial", false, ["red 0%", "blue 100%"]],
    ["radial-gradient(circle at center, #fff, #000)", "radial", false, ["#fff", "#000"]],
    ["radial-gradient(ellipse farthest-corner at 20% 30%, red, 40%, blue)", "radial", false, ["red", "blue"]],
    ["radial-gradient(50% 50% at 50% 50%, rgba(0,0,0,.5) 0, transparent 100%)", "radial", false, ["rgba(0,0,0,.5) 0", "transparent 100%"]],
    ["radial-gradient(100px, red, blue)", "radial", false, ["red", "blue"]],
    ["radial-gradient(at top left, red, blue)", "radial", false, ["red", "blue"]],
    ["radial-gradient(closest-side, var(--a), var(--b))", "radial", false, ["var(--a)", "var(--b)"]],
    ["radial-gradient(in oklab, red, blue)", "radial", false, ["red", "blue"]],
    ["repeating-radial-gradient(circle, red, blue 10px)", "radial", true, ["red", "blue 10px"]],
    ["conic-gradient(red, blue)", "conic", false, ["red", "blue"]],
    ["conic-gradient(from 45deg, red, blue)", "conic", false, ["red", "blue"]],
    ["conic-gradient(from 0.25turn at 50% 50%, red 0deg, blue 180deg, red 360deg)", "conic", false, ["red 0deg", "blue 180deg", "red 360deg"]],
    ["conic-gradient(at 0% 30%, red 10%, yellow 30%, #1e90ff 50%)", "conic", false, ["red 10%", "yellow 30%", "#1e90ff 50%"]],
    ["conic-gradient(#fff 0.25turn, #000 0.25turn 0.5turn, #fff 0.5turn 0.75turn, #000 0.75turn)", "conic", false, ["#fff 0.25turn", "#000 0.25turn 0.5turn", "#fff 0.5turn 0.75turn", "#000 0.75turn"]],
    ["repeating-conic-gradient(red 0 25%, blue 0 50%)", "conic", true, ["red 0 25%", "blue 0 50%"]],
    ["RADIAL-GRADIENT(red, blue)", "radial", false, ["red", "blue"]],
  ])("%s → unsupported-kind", (css, kind, repeating, stops) => {
    const g = one(css);
    expect(g.kind).toBe(kind);
    expect(g.repeating).toBe(repeating);
    expect(g.document).toBeNull();
    expect(g.skipped!.code).toBe("unsupported-kind");
    expect(g.range).toEqual({ start: 0, end: css.length });
    expect(g.stopRanges.map((r) => css.slice(r.start, r.end))).toEqual(stops);
  });

  it.each<[string, string, "linear" | "radial" | "conic", boolean]>([
    ["-webkit-linear-gradient(top, red, blue)", "-webkit-", "linear", false],
    ["-webkit-linear-gradient(left, #fff 0%, #000 100%)", "-webkit-", "linear", false],
    ["-webkit-linear-gradient(45deg, red, blue)", "-webkit-", "linear", false],
    ["-moz-linear-gradient(top, red, blue)", "-moz-", "linear", false],
    ["-o-linear-gradient(top, red, blue)", "-o-", "linear", false],
    ["-ms-linear-gradient(top, red, blue)", "-ms-", "linear", false],
    ["-webkit-radial-gradient(center, ellipse cover, red, blue)", "-webkit-", "radial", false],
    ["-moz-radial-gradient(center, ellipse cover, red, blue)", "-moz-", "radial", false],
    ["-webkit-repeating-linear-gradient(45deg, red, blue 10px)", "-webkit-", "linear", true],
    ["-moz-repeating-radial-gradient(red, blue 10px)", "-moz-", "radial", true],
    ["-webkit-gradient(linear, left top, left bottom, from(#fff), to(#000))", "-webkit-", "linear", false],
    ["-webkit-gradient(linear, 0 0, 0 100%, color-stop(0, #fff), color-stop(1, #000))", "-webkit-", "linear", false],
    ["-webkit-gradient(radial, 50% 50%, 0, 50% 50%, 100, from(red), to(blue))", "-webkit-", "radial", false],
    ["-WEBKIT-LINEAR-GRADIENT(top, red, blue)", "-webkit-", "linear", false],
  ])("%s → legacy-syntax", (css, prefix, kind, repeating) => {
    const g = one(css);
    expect(g.skipped!.code).toBe("legacy-syntax");
    expect(g.document).toBeNull();
    expect(g.vendorPrefix).toBe(prefix);
    expect(g.kind).toBe(kind);
    expect(g.repeating).toBe(repeating);
    expect(g.range).toEqual({ start: 0, end: css.length });
  });

  it("has no vendorPrefix on standard functions", () => {
    expect("vendorPrefix" in one("linear-gradient(red, blue)")).toBe(false);
  });

  it("too-many-stops: 32 are parsed, 33 are skipped, maxStops is configurable", () => {
    const make = (n: number): string => `linear-gradient(${Array.from({ length: n }, (_, i) => `#${i.toString(16).padStart(6, "0")}`).join(", ")})`;
    expect(one(make(32)).document!.stops).toHaveLength(32);
    const g = one(make(33));
    expect(g.skipped!.code).toBe("too-many-stops");
    expect(g.stopRanges).toHaveLength(33);
    expect(parseGradient(make(33), { maxStops: 40 }).gradients[0].document!.stops).toHaveLength(33);
    expect(parseGradient(make(3), { maxStops: 2 }).gradients[0].skipped!.code).toBe("too-many-stops");
    // Double-position stops count twice.
    const doubles = `linear-gradient(${Array.from({ length: 17 }, (_, i) => `red ${i}% ${i + 1}%`).join(", ")})`;
    expect(one(doubles).skipped!.code).toBe("too-many-stops");
  });

  it("too-long and unbalanced", () => {
    const long = `linear-gradient(red, ${"/* pad */".repeat(20)} blue)`;
    expect(parseGradient(long, { maxLength: 50 }).gradients[0].skipped!.code).toBe("too-long");
    expect(parseGradient(long).gradients[0].document).not.toBeNull();
    const open = "a { background: linear-gradient(red, blue; }";
    const g = one(open);
    expect(g.skipped!.code).toBe("unbalanced");
    expect(open.slice(g.range.start, g.range.end)).toBe("linear-gradient(");
  });

  it("too-deep: a gradient holding more than 64 nested parentheses", () => {
    const g = one(`linear-gradient(red, ${"calc(".repeat(70)}1${")".repeat(70)}, blue)`);
    expect(g.skipped!.code).toBe("too-deep");
    const ok = one(`linear-gradient(red, ${"calc(".repeat(10)}1${")".repeat(10)}, blue)`);
    expect(ok.skipped!.code).toBe("calc");
  });

  it("truncates input beyond maxInputLength", () => {
    const css = "linear-gradient(red, blue) ".repeat(10);
    const r = parseGradient(css, { maxInputLength: 60 });
    expect(r.truncated).toBe(true);
    expect(r.gradients.filter((g) => g.document)).toHaveLength(2);
    expect(parseGradient(css).truncated).toBeUndefined();
  });
});

// ── Stops and positions ───────────────────────────────────────────────────────

describe("colour stops", () => {
  it.each<[string, Stop[]]>([
    ["linear-gradient(red, blue)", [{ color: "#ff0000" }, { color: "#0000ff" }]],
    ["linear-gradient(red 0%, blue 100%)", [{ color: "#ff0000", position: 0 }, { color: "#0000ff", position: 1 }]],
    ["linear-gradient(red 0, blue 100%)", [{ color: "#ff0000", position: 0 }, { color: "#0000ff", position: 1 }]],
    ["linear-gradient(red 25%, blue)", [{ color: "#ff0000", position: 0.25 }, { color: "#0000ff" }]],
    ["linear-gradient(red, lime 30%, blue)", [{ color: "#ff0000" }, { color: "#00ff00", position: 0.3 }, { color: "#0000ff" }]],
    ["linear-gradient(0% red, 100% blue)", [{ color: "#ff0000", position: 0 }, { color: "#0000ff", position: 1 }]],
    ["linear-gradient(red 12.5%, blue 87.5%)", [{ color: "#ff0000", position: 0.125 }, { color: "#0000ff", position: 0.875 }]],
    ["linear-gradient(red .5%, blue 99.5%)", [{ color: "#ff0000", position: 0.005 }, { color: "#0000ff", position: 0.995 }]],
    ["linear-gradient(red 0% 50%, blue 50% 100%)", [
      { color: "#ff0000", position: 0 },
      { color: "#ff0000", position: 0.5 },
      { color: "#0000ff", position: 0.5 },
      { color: "#0000ff", position: 1 },
    ]],
    ["linear-gradient(red 50%, blue 50%)", [{ color: "#ff0000", position: 0.5 }, { color: "#0000ff", position: 0.5 }]],
    ["linear-gradient(10% 20% red, blue)", [{ color: "#ff0000", position: 0.1 }, { color: "#ff0000", position: 0.2 }, { color: "#0000ff" }]],
    ["linear-gradient(rgba(0,0,0,.5) 0% 40%, transparent)", [
      { color: "#000000", alpha: 0.5, position: 0 },
      { color: "#000000", alpha: 0.5, position: 0.4 },
      { color: "#000000", alpha: 0 },
    ]],
    ["linear-gradient(red 80%, blue 20%)", [{ color: "#ff0000", position: 0.8 }, { color: "#0000ff", position: 0.2 }]],
    ["linear-gradient(red,blue)", [{ color: "#ff0000" }, { color: "#0000ff" }]],
    ["linear-gradient(\n\tred\n\t,\n\tblue\n)", [{ color: "#ff0000" }, { color: "#0000ff" }]],
    ["linear-gradient(red/* a */, /* b */blue /* c */ 50%, green)", [{ color: "#ff0000" }, { color: "#0000ff", position: 0.5 }, { color: "#008000" }]],
    ["linear-gradient(red)", [{ color: "#ff0000" }]],
    ["linear-gradient(red 20% 80%)", [{ color: "#ff0000", position: 0.2 }, { color: "#ff0000", position: 0.8 }]],
  ])("%s", (css, stops) => {
    expect(stopsOf(css)).toEqual(stops);
  });

  it("warns about out-of-range positions and keeps them", () => {
    const g = one("linear-gradient(red -10%, blue 120%)");
    expect(g.document!.stops).toEqual([{ color: "#ff0000", position: -0.1 }, { color: "#0000ff", position: 1.2 }]);
    expect(g.warnings.map((w) => w.code)).toEqual(["position-out-of-range", "position-out-of-range"]);
  });

  it("ignores colour hints with a located warning", () => {
    const css = "linear-gradient(to right, red, 30%, blue 80%, 90%, lime)";
    const g = one(css);
    expect(g.document!.stops).toEqual([{ color: "#ff0000" }, { color: "#0000ff", position: 0.8 }, { color: "#00ff00" }]);
    expect(g.warnings.map((w) => [w.code, css.slice(w.range!.start, w.range!.end)])).toEqual([
      ["color-hint-ignored", "30%"],
      ["color-hint-ignored", "90%"],
    ]);
    expect(g.stopRanges.map((r) => css.slice(r.start, r.end))).toEqual(["red", "blue 80%", "lime"]);
  });

  it("stopRanges: a double-position stop yields two stops sharing one range", () => {
    const css = "  linear-gradient( 45deg ,  #fff 0% 25% ,rgb(0 0 0 / 50%)  50%,hsl(0, 100%, 50%)  )";
    const g = one(css);
    expect(css.slice(g.range.start, g.range.end)).toBe(css.trim());
    expect(g.stopRanges.map((r) => css.slice(r.start, r.end))).toEqual([
      "#fff 0% 25%",
      "#fff 0% 25%",
      "rgb(0 0 0 / 50%)  50%",
      "hsl(0, 100%, 50%)",
    ]);
    expect(g.stopRanges[0]).toBe(g.stopRanges[1]);
  });

  it("repeating-linear-gradient parses to a repeating document", () => {
    const g = one("repeating-linear-gradient(45deg, red 0%, red 10%, blue 10%, blue 20%)");
    expect(g.repeating).toBe(true);
    expect(g.document!.repeating).toBe(true);
    expect(g.document!.stops).toHaveLength(4);
    expect("repeating" in one("linear-gradient(red, blue)").document!).toBe(false);
    expect(one("repeating-linear-gradient(red, blue 20px)").skipped!.code).toBe("length-position");
  });

  it("uses UTF-16 offsets after non-BMP characters", () => {
    const css = "/* 🌈 */ .é { background: linear-gradient(red, blue) } 😀 linear-gradient(lime, black)";
    const { gradients } = parseGradient(css);
    expect(gradients.map((g) => css.slice(g.range.start, g.range.end))).toEqual([
      "linear-gradient(red, blue)",
      "linear-gradient(lime, black)",
    ]);
  });
});

// ── Scanner contexts ──────────────────────────────────────────────────────────

describe("scanner", () => {
  const texts = (css: string): string[] => {
    const { gradients } = parseGradient(css);
    for (const g of gradients) checkRanges(css, g);
    return gradients.map((g) => css.slice(g.range.start, g.range.end));
  };

  it.each<[string, string, string[]]>([
    ["declaration", ".a { background: linear-gradient(red, blue); }", ["linear-gradient(red, blue)"]],
    ["background-image", ".a{background-image:linear-gradient(red,blue)}", ["linear-gradient(red,blue)"]],
    ["!important", ".a { background: linear-gradient(red, blue) !important }", ["linear-gradient(red, blue)"]],
    ["upper case", ".a { background: LINEAR-GRADIENT(red, blue) }", ["LINEAR-GRADIENT(red, blue)"]],
    ["mixed case", ".a { background: Linear-Gradient(RED, Blue) }", ["Linear-Gradient(RED, Blue)"]],
    ["two rules", ".a{background:linear-gradient(red,blue)}.b{background:linear-gradient(lime,black)}", ["linear-gradient(red,blue)", "linear-gradient(lime,black)"]],
    ["CSS comment", "/* linear-gradient(red, blue) */ .a { color: red }", []],
    ["comment between", ".a { /* x */ background: linear-gradient(red, blue) /* linear-gradient(a, b) */ }", ["linear-gradient(red, blue)"]],
    ["unterminated comment", ".a{} /* linear-gradient(red, blue)", []],
    ["JS line comment", "// linear-gradient(red, blue)\nconst a = 1;", []],
    ["after a line comment", "// note\nconst a = 'linear-gradient(red, blue)';", ["linear-gradient(red, blue)"]],
    ["SCSS line comment in a rule", ".a {\n  // background: linear-gradient(red, blue);\n  color: red;\n}", []],
    ["URL scheme is not a comment", "a { b: url(http://x.test/a.png), linear-gradient(red, blue) }", ["linear-gradient(red, blue)"]],
    ["protocol-relative URL", "a { b: url(//x.test/a.png), linear-gradient(red, blue) }", ["linear-gradient(red, blue)"]],
    ["URL with parentheses", "a { b: url(a\\(1\\).png), linear-gradient(red, blue) }", ["linear-gradient(red, blue)"]],
    ["quoted URL", 'a { b: url("a(1.png"), linear-gradient(red, blue) }', ["linear-gradient(red, blue)"]],
    ["data URL with semicolons", "a { b: url(data:image/png;base64,AAAA), linear-gradient(red, blue) }", ["linear-gradient(red, blue)"]],
    ["gradient-looking URL", "a { b: url(linear-gradient(red, blue).png) }", []],
    ["prose URL", "see https://example.test/x and linear-gradient(red, blue)", ["linear-gradient(red, blue)"]],
    ["double-quoted JS string", 'const g = "linear-gradient(red, blue)";', ["linear-gradient(red, blue)"]],
    ["single-quoted JS string", "const g = 'linear-gradient(red, blue)';", ["linear-gradient(red, blue)"]],
    ["string argument", 'el.style.setProperty("background", "linear-gradient(red, blue)")', ["linear-gradient(red, blue)"]],
    ["nested call", "css(wrap('linear-gradient(red, blue)'))", ["linear-gradient(red, blue)"]],
    ["template literal", "const g = `linear-gradient(red, blue)`;", ["linear-gradient(red, blue)"]],
    ["template with expressions", "const g = `linear-gradient(${a}deg, ${c1}, ${c2})`;", ["linear-gradient(${a}deg, ${c1}, ${c2})"]],
    ["styled-components", "const B = styled.div`\n  background: linear-gradient(to right, #fff, #000);\n`;", ["linear-gradient(to right, #fff, #000)"]],
    ["JS object", "const s = { background: 'linear-gradient(red, blue)', color: 'red' };", ["linear-gradient(red, blue)"]],
    ["JSX style", '<div style={{ backgroundImage: "linear-gradient(red, blue)" }} />', ["linear-gradient(red, blue)"]],
    ["HTML style attribute", '<div style="background: linear-gradient(red, blue)"></div>', ["linear-gradient(red, blue)"]],
    ["HTML single-quoted attribute", "<div style='background: linear-gradient(red, blue)'></div>", ["linear-gradient(red, blue)"]],
    ["multi-line HTML attribute", '<div style="color: red;\n  background: linear-gradient(\n    red,\n    blue)"></div>', ["linear-gradient(\n    red,\n    blue)"]],
    ["Tailwind arbitrary value (found, then skipped: to_right is not CSS)", '<div class="bg-[linear-gradient(to_right,red,blue)]">', ["linear-gradient(to_right,red,blue)"]],
    ["Markdown inline code", "Use `linear-gradient(red, blue)` for this.", ["linear-gradient(red, blue)"]],
    ["Markdown fence", "```css\n.a { background: linear-gradient(red, blue); }\n```", ["linear-gradient(red, blue)"]],
    ["Markdown prose with apostrophes", "Don't use it; it's linear-gradient(red, blue) that's wrong.", ["linear-gradient(red, blue)"]],
    ["string holding a comment opener", 'a::before { content: "/*"; background: linear-gradient(red, blue) }', ["linear-gradient(red, blue)"]],
    ["string holding a parenthesis", 'a::before { content: "("; background: linear-gradient(red, blue) }', ["linear-gradient(red, blue)"]],
    ["escaped quote", 'a::before { content: "\\""; background: linear-gradient(red, blue) }', ["linear-gradient(red, blue)"]],
    ["longer identifier", "a { b: my-linear-gradient(red, blue) }", []],
    ["identifier suffix", "a { b: linear-gradientx(red, blue) }", []],
    ["underscore prefix", "a { b: _linear-gradient(red, blue) }", []],
    ["SCSS variable", "a { b: $linear-gradient(red, blue) }", []],
    ["Less mixin", ".linear-gradient(red, blue);", []],
    ["at-rule name", "@linear-gradient(red, blue);", []],
    ["space before the parenthesis", "a { b: linear-gradient (red, blue) }", []],
    ["bare word", "the linear-gradient function", []],
    ["gradient( alone", "a { b: gradient(red, blue) }", []],
    ["SCSS mixin include", "@include x(linear-gradient(red, blue));", ["linear-gradient(red, blue)"]],
    ["inside image-set", "a { b: image-set(linear-gradient(red, blue) 1x) }", ["linear-gradient(red, blue)"]],
    ["inside cross-fade", "a { b: cross-fade(linear-gradient(red, blue), url(a.png), 50%) }", ["linear-gradient(red, blue)"]],
    ["mask shorthand", "a { mask: linear-gradient(#000, transparent) }", ["linear-gradient(#000, transparent)"]],
    ["custom property", ":root { --g: linear-gradient(red, blue); }", ["linear-gradient(red, blue)"]],
    ["@supports", "@supports (background: linear-gradient(in oklch, red, blue)) { a { b: c } }", ["linear-gradient(in oklch, red, blue)"]],
    ["start of text", "linear-gradient(red, blue)", ["linear-gradient(red, blue)"]],
    ["after a colon without space", "background:linear-gradient(red, blue)", ["linear-gradient(red, blue)"]],
    ["after a comma", "a,linear-gradient(red, blue)", ["linear-gradient(red, blue)"]],
    ["empty", "", []],
    ["no gradient", ".a { color: red; background: url(a.png) no-repeat }", []],
  ])("%s", (_name, css, expected) => {
    expect(texts(css)).toEqual(expected);
  });

  it("multi-layer background: every gradient is its own result, url() and sizes ignored", () => {
    const css =
      ".hero { background: linear-gradient(rgba(0,0,0,.6), rgba(0,0,0,.2)) top / 100% 50% no-repeat, url(hero(1).jpg) center / cover, radial-gradient(circle at 10% 20%, #fff, transparent 40%), linear-gradient(to right, #f00 0%, #00f 100%) fixed, #000; }";
    const { gradients } = parseGradient(css);
    expect(gradients.map((g) => css.slice(g.range.start, g.range.end))).toEqual([
      "linear-gradient(rgba(0,0,0,.6), rgba(0,0,0,.2))",
      "radial-gradient(circle at 10% 20%, #fff, transparent 40%)",
      "linear-gradient(to right, #f00 0%, #00f 100%)",
    ]);
    expect(gradients.map((g) => g.kind)).toEqual(["linear", "radial", "linear"]);
    expect(gradients[0].document!.stops).toEqual([{ color: "#000000", alpha: 0.6 }, { color: "#000000", alpha: 0.2 }]);
    expect(gradients[1].skipped!.code).toBe("unsupported-kind");
    expect(gradients[2].document).toEqual({
      kind: "linear",
      angle: 90,
      stops: [{ color: "#ff0000", position: 0 }, { color: "#0000ff", position: 1 }],
    });
  });

  it("orders results by start offset, including nested ones", () => {
    const css = "a{b:linear-gradient(red, linear-gradient(lime, blue))} c{d:conic-gradient(red, blue)}";
    const { gradients } = parseGradient(css);
    expect(gradients.map((g) => g.range.start)).toEqual([...gradients.map((g) => g.range.start)].sort((x, y) => x - y));
    expect(gradients.map((g) => g.skipped?.code)).toEqual(["syntax", undefined, "unsupported-kind"]);
  });

  it.each<[string, string]>([
    ["end of declaration", "a { b: linear-gradient(red, blue; c: d }"],
    ["end of rule", "a { b: linear-gradient(red, blue }"],
    ["end of text", "linear-gradient(red, blue"],
    ["closing quote", '<p style="background: linear-gradient(red, blue">x</p>'],
    ["closing backtick", "const a = `linear-gradient(red, blue`;"],
    ["new block", "a { b: linear-gradient(red { c: d } }"],
  ])("unclosed at %s → unbalanced, and scanning continues", (_name, css) => {
    const all = css + " x { y: linear-gradient(lime, black) }";
    const { gradients } = parseGradient(all);
    expect(gradients).toHaveLength(2);
    expect(gradients[0].skipped!.code).toBe("unbalanced");
    expect(all.slice(gradients[0].range.start, gradients[0].range.end)).toBe("linear-gradient(");
    expect(gradients[1].document!.stops).toEqual([{ color: "#00ff00" }, { color: "#000000" }]);
  });

  it("does not look for gradients below 64 open parentheses", () => {
    expect(parseGradient(`${"(".repeat(64)}linear-gradient(red, blue)${")".repeat(64)}`).gradients).toEqual([]);
    expect(parseGradient(`${"(".repeat(63)}linear-gradient(red, blue)${")".repeat(63)}`).gradients).toHaveLength(1);
  });

  it.each([null, undefined, 42, {}, [], true, Symbol.iterator])("non-string input %s yields no gradients", (input) => {
    expect(parseGradient(input as unknown as string)).toEqual({ gradients: [] });
  });

  it("tolerates junk options", () => {
    const css = "linear-gradient(red, blue)";
    for (const opts of [null, {}, { maxStops: NaN }, { maxStops: -1 }, { maxLength: "x" }, { maxInputLength: Infinity }]) {
      expect(parseGradient(css, opts as never).gradients[0].document).not.toBeNull();
    }
  });

  it("is deterministic and does not share state between calls", () => {
    const css = "a{b:linear-gradient(to right, red 0% 10%, 20%, oklch(0.7 0.1 20 / 0.5))}";
    const a = parseGradient(css);
    a.gradients[0].document!.stops[0].color = "#mutated";
    expect(parseGradient(css)).toEqual(parseGradient(css));
    expect(parseGradient(css).gradients[0].document!.stops[0].color).toBe("#ff0000");
  });
});

describe("parseCssColor", () => {
  it.each(["", " ", "red blue", "red,", "linear-gradient(red, blue)", "#fff #000", "rgb(1 2 3) x", "x".repeat(300)])(
    "%j is not one colour",
    (text) => {
      expect(parseCssColor(text)).toBeNull();
    },
  );

  it.each([null, undefined, 1, {}])("non-string %s", (v) => {
    expect(parseCssColor(v as unknown as string)).toBeNull();
  });

  it("trims whitespace and comments", () => {
    expect(parseCssColor("  #FFF  ")).toEqual({ color: "#ffffff", alpha: 1 });
    expect(parseCssColor("/* c */ transparent")).toEqual({ color: "#000000", alpha: 0 });
  });
});
