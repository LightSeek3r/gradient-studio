// Tests for the thin adapter between core `parseGradient` and the editor's
// import (src/import/adapter.ts). Ported from the app's former own parser, so
// the observable accept/reject rules stay pinned; the cases where core
// deliberately differs are in the "differences from the former parser" block.
import { describe, expect, it } from "vitest";
import { parseGradient } from "@opal42/gradient";
import { looksLikeGradient, parseLinearGradient } from "../src/import/adapter";

function ok(input: string) {
  const r = parseLinearGradient(input);
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r;
}
function err(input: string) {
  const r = parseLinearGradient(input);
  if (r.ok) throw new Error(`expected an error, got ${JSON.stringify(r.gradient)}`);
  return r;
}
const positions = (input: string) => ok(input).gradient.stops.map((s) => s.position);
const colors = (input: string) => ok(input).gradient.stops.map((s) => s.color);
const angle = (input: string) => ok(input).gradient.angle;

describe("parseLinearGradient: accepted input", () => {
  it("parses the reference gradient", () => {
    const r = ok("linear-gradient(135deg, #ff6b6b 0%, #4ecdc4 50%, #1a535c 100%)");
    expect(r.gradient).toEqual({
      angle: 135,
      stops: [
        { color: "#ff6b6b", position: 0 },
        { color: "#4ecdc4", position: 50 },
        { color: "#1a535c", position: 100 },
      ],
    });
    expect(r.warnings).toEqual([]);
  });

  it("accepts a background: prefix and trailing semicolon", () => {
    expect(angle("background: linear-gradient(90deg, red, blue);")).toBe(90);
  });

  it("accepts background-image: with !important and several semicolons", () => {
    expect(colors("background-image: linear-gradient(red, blue) !important;;")).toEqual(["#ff0000", "#0000ff"]);
  });

  it("accepts a whole rule and takes its first gradient", () => {
    expect(colors(".hero { margin: 0; background: linear-gradient(red, blue); }")).toEqual(["#ff0000", "#0000ff"]);
  });

  it("is case-insensitive and tolerates newlines and comments", () => {
    expect(colors("LINEAR-GRADIENT(\n  45DEG, /* start */ RED,\n  Blue\n)")).toEqual(["#ff0000", "#0000ff"]);
  });

  it("defaults the angle to 180 (to bottom)", () => {
    expect(angle("linear-gradient(red, blue)")).toBe(180);
  });

  it.each([
    ["0.25turn", 90],
    ["0.5turn", 180],
    ["100grad", 90],
    ["3.14159265rad", 180],
    ["-90deg", 270],
    ["450deg", 90],
    ["0", 0],
    ["1.5708rad", 90],
  ])("converts the angle %s to %d°", (a, expected) => {
    expect(angle(`linear-gradient(${a}, red, blue)`)).toBe(expected);
  });

  it("warns when an angle had to be rounded", () => {
    const r = ok("linear-gradient(45.4deg, red, blue)");
    expect(r.gradient.angle).toBe(45);
    expect(r.warnings.join()).toMatch(/rounded/);
  });

  it("rejects a unitless non-zero angle", () => {
    // "45" is not an angle and not a colour.
    err("linear-gradient(45, red, blue)");
  });

  it.each([
    ["to top", 0],
    ["to right", 90],
    ["to bottom", 180],
    ["to left", 270],
  ])("converts %s", (dir, expected) => {
    const r = ok(`linear-gradient(${dir}, red, blue)`);
    expect(r.gradient.angle).toBe(expected);
    expect(r.warnings).toEqual([]);
  });

  it.each([
    ["to top right", 45],
    ["to right top", 45],
    ["to bottom right", 135],
    ["to bottom left", 225],
    ["to top left", 315],
  ])("converts the corner %s with an aspect-ratio warning", (dir, expected) => {
    const r = ok(`linear-gradient(${dir}, red, blue)`);
    expect(r.gradient.angle).toBe(expected);
    expect(r.warnings.join()).toMatch(/aspect ratio/);
  });

  it.each(["to top bottom", "to middle", "to", "to left right"])("rejects the direction %s", (dir) => {
    err(`linear-gradient(${dir}, red, blue)`);
  });

  it("parses rgb(), rgba(), hsl(), hsla(), named and short hex colours", () => {
    expect(
      colors("linear-gradient(rgb(255, 0, 0), rgb(0 128 0), hsl(240, 100%, 50%), hsl(60deg 100% 50%), rebeccapurple, #0f0)"),
    ).toEqual(["#ff0000", "#008000", "#0000ff", "#ffff00", "#663399", "#00ff00"]);
  });

  it("drops alpha with a warning (rgba, slash alpha, 8-digit hex)", () => {
    const r = ok("linear-gradient(rgba(255, 0, 0, 0.5), rgb(0 0 255 / 40%), #00ff0080)");
    expect(r.gradient.stops.map((s) => s.color)).toEqual(["#ff0000", "#0000ff", "#00ff00"]);
    expect(r.warnings.join()).toMatch(/Transparency was dropped from stops 1, 2, 3/);
  });

  it("does not warn for an explicit alpha of 1", () => {
    expect(ok("linear-gradient(rgba(255,0,0,1), #0000ffff)").warnings).toEqual([]);
  });

  it("replaces transparent by its neighbour's colour, with a warning", () => {
    const r = ok("linear-gradient(transparent, red)");
    expect(r.gradient.stops.map((s) => s.color)).toEqual(["#ff0000", "#ff0000"]);
    expect(r.warnings.join()).toMatch(/transparent/);
  });

  it("rejects an all-transparent gradient", () => {
    err("linear-gradient(transparent, transparent)");
  });

  it("auto-distributes missing positions: first 0, last 100, runs evenly", () => {
    expect(positions("linear-gradient(red, green, blue)")).toEqual([0, 50, 100]);
    expect(positions("linear-gradient(red, green, blue, white)")).toEqual([0, 33.33, 66.67, 100]);
    expect(positions("linear-gradient(red 20%, green, blue, white 80%)")).toEqual([20, 40, 60, 80]);
    expect(positions("linear-gradient(red, green 10%, blue)")).toEqual([0, 10, 100]);
  });

  it("clamps non-monotonic positions as browsers do, with a warning", () => {
    const r = ok("linear-gradient(red 50%, green 20%, blue)");
    expect(r.gradient.stops.map((s) => s.position)).toEqual([50, 50, 100]);
    expect(r.warnings.join()).toMatch(/Stop 2 came before/);
  });

  it("distributes after clamping (CSS fixup order)", () => {
    // blue has no position: it sits between green (clamped to 60) and white 100.
    expect(positions("linear-gradient(red 60%, green 10%, blue, white 100%)")).toEqual([60, 60, 80, 100]);
  });

  it("expands double-position stops into two stops", () => {
    const r = ok("linear-gradient(red 10% 30%, blue)");
    expect(r.gradient.stops).toEqual([
      { color: "#ff0000", position: 10 },
      { color: "#ff0000", position: 30 },
      { color: "#0000ff", position: 100 },
    ]);
  });

  it("accepts a bare 0 position", () => {
    expect(positions("linear-gradient(red 0, blue 100%)")).toEqual([0, 100]);
  });

  it("skips colour hints with a warning", () => {
    const r = ok("linear-gradient(red, 30%, blue)");
    expect(r.gradient.stops.map((s) => s.position)).toEqual([0, 100]);
    expect(r.warnings.join()).toMatch(/colour hint/);
  });

  it("rejects a colour hint at either end", () => {
    err("linear-gradient(30%, red, blue)");
    err("linear-gradient(red, blue, 30%)");
  });

  it.each(["in oklch", "in oklab", "in hsl longer hue", "in display-p3"])(
    "accepts the interpolation clause %s with a warning",
    (clause) => {
      const r = ok(`linear-gradient(${clause}, red, blue)`);
      expect(r.gradient.angle).toBe(180);
      expect(r.warnings.join()).toMatch(/sRGB/);
    },
  );

  it("accepts the interpolation clause before or after the direction", () => {
    expect(angle("linear-gradient(90deg in oklab, red, blue)")).toBe(90);
    expect(angle("linear-gradient(in oklab 90deg, red, blue)")).toBe(90);
    expect(angle("linear-gradient(to left in oklch, red, blue)")).toBe(270);
  });

  it("accepts in srgb silently", () => {
    expect(ok("linear-gradient(in srgb, red, blue)").warnings).toEqual([]);
  });

  it("rejects an unknown colour space", () => {
    expect(err("linear-gradient(in cmyk, red, blue)").error).toMatch(/colour space/);
  });

  it("imports the first of several layers, with a warning", () => {
    const r = ok("linear-gradient(red, blue), linear-gradient(90deg, green, white)");
    expect(r.gradient.angle).toBe(180);
    expect(r.warnings.join()).toMatch(/2 background layers/);
  });

  it("trims stops outside 0-100% exactly (sRGB at the edges)", () => {
    const r = ok("linear-gradient(#000000 -100%, #ffffff 100%)");
    // At 0% the sRGB mix is halfway: #808080.
    expect(r.gradient.stops).toEqual([
      { color: "#808080", position: 0 },
      { color: "#ffffff", position: 100 },
    ]);
    expect(r.warnings.join()).toMatch(/trimmed/);
  });

  it("does not treat words that are hex digits as colours", () => {
    expect(err("linear-gradient(bad, fed)").error).toMatch(/'bad' is not a recognised colour/);
  });

  it("allows exactly 10 stops", () => {
    const stops = Array.from({ length: 10 }, (_, i) => (i % 2 ? "red" : "blue")).join(", ");
    expect(ok(`linear-gradient(${stops})`).gradient.stops).toHaveLength(10);
  });
});

describe("parseLinearGradient: rejected input", () => {
  it.each([
    ["repeating-linear-gradient(red, blue 20%)", /repeating/],
    ["repeating-radial-gradient(red, blue)", /repeating/],
    ["radial-gradient(red, blue)", /Radial/],
    ["conic-gradient(red, blue)", /Conic/],
    ["-webkit-linear-gradient(left, red, blue)", /Vendor-prefixed/],
    ["-moz-linear-gradient(left, red, blue)", /Vendor-prefixed/],
    ["linear-gradient(var(--a), blue)", /var\(\) can't be imported/],
    ["linear-gradient(red, calc(1px + 2px))", /calc\(\)/],
    ["linear-gradient(currentColor, blue)", /currentColor depends on the page/],
    ["linear-gradient(color-mix(in srgb, red, blue), blue)", /color-mix\(\) colours are not supported/],
    ["linear-gradient(lab(50% 40 59), blue)", /lab\(\) colours/],
    ["linear-gradient(lch(50% 40 59), blue)", /lch\(\) colours/],
    ["linear-gradient(color(display-p3 1 0 0), blue)", /color\(\) colours/],
    ["linear-gradient(rgb(from red r g b), blue)", /Relative colours/],
    ["linear-gradient(hwb(120 0% 0%), blue)", /hwb\(\)/],
    ["linear-gradient(red 10px, blue)", /percentage.*px/],
    ["linear-gradient(red calc(10% + 5px), blue)", /calc\(\)/],
    ["linear-gradient(env(x), blue)", /env\(\)/],
    ["linear-gradient(Canvas, blue)", /System colour/],
    ["linear-gradient($a, blue)", /Sass\/Less/],
    ["linear-gradient(notacolour, blue)", /'notacolour' is not a recognised colour/],
    ["linear-gradient(#12, blue)", /hex/],
    ["linear-gradient(red)", /two colour stops/],
    ["linear-gradient()", /./],
    ["linear-gradient(red, blue", /parentheses/],
    ["linear-gradient(red, , blue)", /empty/],
    ["linear-gradient(red blue, green)", /valid linear-gradient/],
    ["url(a.png)", /linear-gradient/],
    ["my-linear-gradient(red, blue)", /linear-gradient/],
    ["", /Nothing/],
    ["#ff0000", /linear-gradient/],
  ])("rejects %s", (input, message) => {
    expect(err(input).error).toMatch(message);
  });

  it("rejects more than 10 stops with a count", () => {
    const stops = Array.from({ length: 11 }, () => "red").join(", ");
    expect(err(`linear-gradient(${stops})`).error).toMatch(/11 stops.*up to 10/);
  });

  it("counts double positions towards the cap", () => {
    const stops = Array.from({ length: 6 }, (_, i) => `red ${i * 10}% ${i * 10 + 5}%`).join(", ");
    expect(err(`linear-gradient(${stops})`).error).toMatch(/12 stops/);
  });

  it("never throws, even on hostile input", () => {
    for (const s of ["(((((", ")))", "linear-gradient(" + "(".repeat(5000), "x".repeat(20000), "\u0000", "linear-gradient(,)"]) {
      expect(() => parseLinearGradient(s)).not.toThrow();
      expect(parseLinearGradient(s).ok).toBe(false);
    }
  });
});

describe("looksLikeGradient", () => {
  it("detects gradient text", () => {
    expect(looksLikeGradient("background: linear-gradient(red, blue)")).toBe(true);
    expect(looksLikeGradient("radial-gradient (red, blue)")).toBe(true);
    expect(looksLikeGradient("#ff0000")).toBe(false);
  });
});

describe("differences from the former app parser (core is stricter or broader on purpose)", () => {
  it("imports oklab() and oklch() colours (core converts them), warning when gamut-mapped", () => {
    const r = ok("linear-gradient(oklch(0.6 0.1 30), oklab(0.5 0 0))");
    expect(r.gradient.stops.map((s) => s.color)).toEqual(["#b4685c", "#636363"]);
    expect(r.warnings).toEqual([]);
    const wide = ok("linear-gradient(oklch(0.7 0.4 150), blue)");
    expect(wide.warnings.join()).toMatch(/gamut-mapped/);
  });

  it("imports a gradient from a property that is not background (any declaration or rule)", () => {
    expect(colors("color: linear-gradient(red, blue)")).toEqual(["#ff0000", "#0000ff"]);
    expect(colors("--hero: linear-gradient(red, blue);")).toEqual(["#ff0000", "#0000ff"]);
  });

  it("accepts the position before the colour (core grammar: <color> && <position>)", () => {
    expect(positions("linear-gradient(50% red, blue)")).toEqual([50, 100]);
  });

  it("treats every alpha-0 colour as transparent, not just the keyword", () => {
    const r = ok("linear-gradient(rgba(255, 0, 0, 0), blue)");
    expect(r.gradient.stops.map((s) => s.color)).toEqual(["#0000ff", "#0000ff"]);
    expect(r.warnings.join()).toMatch(/Stop 1 was transparent/);
  });

  it("keeps the first gradient when the first layer is a plain colour or url()", () => {
    const r = ok("url(a.png) center / cover, linear-gradient(red, blue)");
    expect(r.gradient.stops).toHaveLength(2);
  });

  it("rejects the first gradient when it cannot be imported, even if a later one could", () => {
    const r = err("radial-gradient(red, blue), linear-gradient(red, blue)");
    expect(r.error).toMatch(/Radial/);
    expect(r.warnings.join()).toMatch(/2 background layers/);
  });

  it("keeps oklab/oklch interpolation out with a warning naming the hue method", () => {
    expect(ok("linear-gradient(in oklch longer hue, red, blue)").warnings.join()).toMatch(/"in oklch longer hue"/);
  });

  it("names an unsupported interpolation space in the warning", () => {
    const r = ok("linear-gradient(to right in hsl longer hue, red, blue)");
    expect(r.gradient.angle).toBe(90);
    expect(r.warnings.join()).toMatch(/"in hsl longer hue" interpolation was kept out/);
  });

  it("still rejects a malformed hue method", () => {
    err("linear-gradient(in oklch longer, red, blue)");
  });

  it("rejects repeating-linear-gradient even though core parses it", () => {
    const doc = parseGradient("repeating-linear-gradient(red, blue 20%)").gradients[0];
    expect(doc.document?.repeating).toBe(true);
    expect(err("repeating-linear-gradient(red, blue 20%)").error).toMatch(/repeating/);
  });

  it("explains each hint count and each dropped alpha stop", () => {
    const r = ok("linear-gradient(red, 20%, green, 70%, blue)");
    expect(r.warnings.join()).toMatch(/Skipped 2 colour hints/);
  });

  it("does not warn about a fully in-range gradient built from percentages with float noise", () => {
    const r = ok("linear-gradient(red 7%, green 14%, blue 21%, white 100%)");
    expect(r.warnings).toEqual([]);
    expect(r.gradient.stops.map((s) => s.position)).toEqual([7, 14, 21, 100]);
  });

  it("keeps the 10-stop cap above core's own default of 32", () => {
    const stops = Array.from({ length: 33 }, () => "red").join(", ");
    expect(err(`linear-gradient(${stops})`).error).toMatch(/33 stops.*up to 10/);
  });

  it("is bounded: oversized input is refused before scanning", () => {
    expect(err("linear-gradient(" + "red,".repeat(5000) + "blue)").error).toMatch(/too long/);
  });
});
