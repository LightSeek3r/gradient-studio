import { describe, expect, it } from "vitest";
import { toCSS, toCSSWithFallback } from "../src/api/css";
import type { GradientDocument } from "../src/api/types";
import {
  EXPORT_FORMATS,
  angleToFigmaTransform,
  cssAngleToLine,
  exportAll,
  figmaTransformToAngle,
  fromFigmaPaint,
  toAndroidXml,
  toCompose,
  toCssVariables,
  toDtcg,
  toFigmaPaint,
  toFlutter,
  toGodot,
  toScss,
  toSvg,
  toSwiftUI,
  toTailwind,
  type ExportOutcome,
  type ExportText,
} from "../src/export";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const doc = (angle: number, stops: GradientDocument["stops"], extra: Partial<GradientDocument> = {}): GradientDocument => ({
  kind: "linear",
  angle,
  stops,
  ...extra,
});

const FIXTURES: Record<string, GradientDocument> = {
  twoStop180: doc(180, [{ color: "#ff0000" }, { color: "#0000ff" }]),
  twoStopPositions: doc(90, [
    { color: "#ff0000", position: 0.2 },
    { color: "#0000ff", position: 0.8 },
  ]),
  threeStop135: doc(135, [
    { color: "#101b45", position: 0 },
    { color: "#3f1d63", position: 0.5 },
    { color: "#9333ea", position: 1 },
  ]),
  threeStopOffMiddle: doc(45, [
    { color: "#111111", position: 0 },
    { color: "#888888", position: 0.3 },
    { color: "#eeeeee", position: 1 },
  ]),
  manyStops: doc(
    210,
    ["#ff0000", "#ff8800", "#ffee00", "#33cc33", "#0088ff", "#4400cc", "#cc00aa"].map((color, i) => ({ color, position: i / 6 })),
  ),
  autoPositions: doc(0, [{ color: "#000000" }, { color: "#ff00ff" }, { color: "#00ffff" }, { color: "#ffffff" }]),
  hardStops: doc(90, [
    { color: "#ff0000", position: 0 },
    { color: "#ff0000", position: 0.5 },
    { color: "#0000ff", position: 0.5 },
    { color: "#0000ff", position: 1 },
  ]),
  alphaFade: doc(180, [{ color: "#ff0000", alpha: 1 }, { color: "#0000ff", alpha: 0 }]),
  alphaConstant: doc(270, [{ color: "#336699", alpha: 0.5 }, { color: "#99cc33", alpha: 0.5 }]),
  angle0: doc(0, [{ color: "#202020" }, { color: "#e0e0e0" }]),
  angle45: doc(45, [{ color: "#202020" }, { color: "#e0e0e0" }]),
  angle270: doc(270, [{ color: "#202020" }, { color: "#e0e0e0" }]),
  angleOdd: doc(37.5, [{ color: "#ff5500" }, { color: "#0055ff" }, { color: "#00ff55" }]),
  angleNegative: doc(-45, [{ color: "#ffffff" }, { color: "#000000" }]),
  oklab: doc(135, [{ color: "#ff0000" }, { color: "#00ffff" }], { interpolation: { space: "oklab" } }),
  oklchLonger: doc(90, [{ color: "#ff0000" }, { color: "#00ff00" }], { interpolation: { space: "oklch", hue: "longer" } }),
  outOfRange: doc(180, [
    { color: "#ff0000", position: -0.2 },
    { color: "#00ff00", position: 0.5 },
    { color: "#0000ff", position: 1.3 },
  ]),
};

const REPEATING: GradientDocument = doc(45, [
  { color: "#ff0000", position: 0 },
  { color: "#0000ff", position: 0.1 },
], { repeating: true });

const KEYS = EXPORT_FORMATS.map((f) => f.key);
const text = (r: ExportOutcome): string => {
  expect(r.status).toBe("ok");
  return (r as ExportText).text;
};

// ── Golden strings: every format of every fixture ────────────────────────────

describe("golden snippets", () => {
  it.each(Object.keys(FIXTURES))("%s: every format matches the reviewed golden file", async (name) => {
    const all = exportAll(FIXTURES[name]);
    const plain = Object.fromEntries(
      KEYS.map((k) => {
        const r = all[k];
        return [k, r.status === "ok" ? r.text : { unsupported: r.code }];
      }),
    );
    await expect(JSON.stringify(plain, null, 2) + "\n").toMatchFileSnapshot(`./golden/export-${name}.json`);
  });
});

describe("exact strings", () => {
  it("Tailwind arbitrary value: spaces are underscores, commas tight", () => {
    const r = toTailwind(FIXTURES.threeStop135);
    expect(r.status === "ok" && r.arbitrary).toBe("bg-[linear-gradient(135deg,#101b45_0%,#3f1d63_50%,#9333ea_100%)]");
  });
  it("Tailwind native form for three default-position stops pins sRGB", () => {
    const r = toTailwind(FIXTURES.threeStop135);
    expect(r.status === "ok" && r.native).toBe("bg-linear-135/srgb from-[#101b45] via-[#3f1d63] to-[#9333ea]");
  });
  it("Tailwind native form adds positions that are not Tailwind's defaults", () => {
    const r = toTailwind(FIXTURES.twoStopPositions);
    expect(r.status === "ok" && r.native).toBe("bg-linear-90/srgb from-[#ff0000] from-20% to-[#0000ff] to-80%");
    const m = toTailwind(FIXTURES.threeStopOffMiddle);
    expect(m.status === "ok" && m.native).toBe("bg-linear-45/srgb from-[#111111] via-[#888888] via-30% to-[#eeeeee]");
  });
  it("Tailwind native form uses the document's interpolation modifier", () => {
    const a = toTailwind(FIXTURES.oklab);
    expect(a.status === "ok" && a.native).toBe("bg-linear-135/oklab from-[#ff0000] to-[#00ffff]");
    const b = toTailwind(FIXTURES.oklchLonger);
    expect(b.status === "ok" && b.native).toBe("bg-linear-90/longer from-[#ff0000] to-[#00ff00]");
  });
  it("Tailwind native form: translucent stops use rgb() with underscores", () => {
    const r = toTailwind(FIXTURES.alphaFade);
    expect(r.status === "ok" && r.native).toBe("bg-linear-180/srgb from-[#ff0000] to-[rgb(0_0_255_/_0)]");
  });
  it("Tailwind native form: odd angles use the arbitrary angle", () => {
    const r = toTailwind(FIXTURES.angleOdd);
    expect(r.status === "ok" && r.native).toBe("bg-linear-[37.5deg] from-[#ff5500] via-[#0055ff] to-[#00ff55]");
  });
  it("Tailwind has no native form for four or more stops, or out-of-range positions", () => {
    for (const n of ["manyStops", "hardStops", "autoPositions", "outOfRange"]) {
      const r = toTailwind(FIXTURES[n]);
      expect(r.status === "ok" && r.native).toBeNull();
    }
  });
  it("Tailwind theme and utility snippets", () => {
    const r = toTailwind(FIXTURES.twoStop180, { name: "Brand Sky" });
    expect(r.status === "ok" && r.theme).toBe("@theme {\n  --background-image-brand-sky: linear-gradient(180deg, #ff0000, #0000ff);\n}");
    expect(r.status === "ok" && r.utility).toBe("@utility bg-brand-sky {\n  background-image: linear-gradient(180deg, #ff0000, #0000ff);\n}");
  });
  it("SCSS is function-free apart from rgba() for translucent stops", () => {
    expect(text(toScss(FIXTURES.twoStop180))).toBe(
      [
        "$gradient-angle: 180deg;",
        "$gradient-color-1: #ff0000;",
        "$gradient-color-2: #0000ff;",
        "",
        "$gradient: linear-gradient(",
        "  $gradient-angle,",
        "  $gradient-color-1,",
        "  $gradient-color-2",
        ");",
        "",
        "// Usage: background: $gradient;",
      ].join("\n"),
    );
    expect(text(toScss(FIXTURES.alphaConstant))).toContain("$gradient-color-1: rgba(#336699, 0.5);");
  });
  it("SCSS keeps the interpolation clause after the angle", () => {
    expect(text(toScss(FIXTURES.oklab))).toContain("  $gradient-angle in oklab,");
  });
  it("CSS variables", () => {
    expect(text(toCssVariables(FIXTURES.twoStopPositions, { prefix: "hero" }))).toBe(
      [
        ":root {",
        "  --hero-angle: 90deg;",
        "  --hero-color-1: #ff0000;",
        "  --hero-position-1: 20%;",
        "  --hero-color-2: #0000ff;",
        "  --hero-position-2: 80%;",
        "  --hero: linear-gradient(var(--hero-angle), var(--hero-color-1) var(--hero-position-1), var(--hero-color-2) var(--hero-position-2));",
        "}",
        "",
        "/* Usage: background: var(--hero); */",
      ].join("\n"),
    );
  });
  it("Flutter: Alignment and FractionalOffset for 45deg in a square", () => {
    const a = text(toFlutter(FIXTURES.angle45));
    expect(a).toContain("begin: Alignment(-1.0, 1.0),");
    expect(a).toContain("end: Alignment(1.0, -1.0),");
    expect(a).toContain("colors: [\n    Color(0xFF202020),\n    Color(0xFFE0E0E0),\n  ],");
    expect(a).toContain("stops: [0.0, 1.0],");
    const f = text(toFlutter(FIXTURES.angle45, { alignment: "fractionalOffset" }));
    expect(f).toContain("begin: FractionalOffset(0.0, 1.0),");
    expect(f).toContain("end: FractionalOffset(1.0, 0.0),");
  });
  it("SwiftUI: UnitPoints for 270deg (to the left)", () => {
    const s = text(toSwiftUI(FIXTURES.angle270));
    expect(s).toContain("startPoint: UnitPoint(x: 1, y: 0.5),");
    expect(s).toContain("endPoint: UnitPoint(x: 0, y: 0.5)");
    expect(s).toContain("Gradient.Stop(color: Color(.sRGB, red: 32 / 255, green: 32 / 255, blue: 32 / 255, opacity: 1), location: 0),");
  });
  it("Compose: ARGB longs, float offsets, pixel Offsets of the reference box", () => {
    const c = text(toCompose(FIXTURES.angle0, { width: 200, height: 100 }));
    expect(c).toContain("0.0f to Color(0xFF202020),");
    expect(c).toContain("1.0f to Color(0xFFE0E0E0),");
    expect(c).toContain("start = Offset(100.0f, 100.0f),");
    expect(c).toContain("end = Offset(100.0f, 0.0f),");
    expect(c).toContain("Math.toRadians(0.0)");
  });
  it("Godot: GDScript arrays and a linear fill", () => {
    const g = toGodot(FIXTURES.angle0);
    expect(g.status === "ok" && g.text).toContain("gradient.offsets = PackedFloat32Array([0.0, 1.0])");
    expect(g.status === "ok" && g.text).toContain("gradient.colors = PackedColorArray([Color8(32, 32, 32), Color8(224, 224, 224)])");
    expect(g.status === "ok" && g.text).toContain("texture.fill_from = Vector2(0.5, 1.0)");
    expect(g.status === "ok" && g.text).toContain("texture.fill_to = Vector2(0.5, 0.0)");
    expect(g.status === "ok" && g.tres).toBe(
      '[gd_resource type="Gradient" format=3]\n\n[resource]\noffsets = PackedFloat32Array(0, 1)\ncolors = PackedColorArray(0.12549, 0.12549, 0.12549, 1, 0.878431, 0.878431, 0.878431, 1)',
    );
  });
  it("Android shape: angle is 90 minus the CSS angle, centre colour only for three stops", () => {
    const two = toAndroidXml(FIXTURES.twoStop180);
    expect(two.status === "ok" && two.variant).toBe("shape");
    expect(two.status === "ok" && two.text).toContain('android:angle="270"');
    expect(two.status === "ok" && two.text).toContain('android:startColor="#FFFF0000"');
    expect(two.status === "ok" && two.text).not.toContain("centerColor");
    const three = toAndroidXml(FIXTURES.threeStop135);
    expect(three.status === "ok" && three.variant).toBe("shape");
    expect(three.status === "ok" && three.text).toContain('android:angle="315"');
    expect(three.status === "ok" && three.text).toContain('android:centerColor="#FF3F1D63"');
  });
  it.each([
    [0, 90],
    [90, 0],
    [180, 270],
    [270, 180],
    [45, 45],
    [135, 315],
  ])("Android shape: CSS %ideg is android:angle %i", (css, droid) => {
    const r = toAndroidXml(doc(css, [{ color: "#000000" }, { color: "#ffffff" }]));
    expect(r.status === "ok" && r.text).toContain(`android:angle="${droid}"`);
  });
  it("Android falls back to a VectorDrawable for four stops, odd angles and off-centre middles", () => {
    for (const n of ["manyStops", "angleOdd", "threeStopOffMiddle", "twoStopPositions"]) {
      const r = toAndroidXml(FIXTURES[n]);
      expect(r.status === "ok" && r.variant, n).toBe("vector");
      expect(r.status === "ok" && r.text).toContain("<aapt:attr");
    }
  });
  it("DTCG: array of { color, position } with colour objects, or hex strings", () => {
    const r = toDtcg(FIXTURES.twoStopPositions, { name: "sky" });
    const json = JSON.parse(text(r));
    expect(json.sky.$type).toBe("gradient");
    expect(json.sky.$value).toEqual([
      { color: { colorSpace: "srgb", components: [1, 0, 0], alpha: 1, hex: "#ff0000" }, position: 0.2 },
      { color: { colorSpace: "srgb", components: [0, 0, 1], alpha: 1, hex: "#0000ff" }, position: 0.8 },
    ]);
    const hex = JSON.parse(text(toDtcg(FIXTURES.alphaConstant, { colorFormat: "hex" })));
    expect(hex.gradient.$value[0].color).toBe("#33669980");
  });
  it("DTCG marks itself unverified against the normative text", () => {
    const r = toDtcg(FIXTURES.twoStop180);
    expect(r.status === "ok" && r.notes.join(" ")).toMatch(/Unverified against the normative DTCG text/);
  });
  it("CSS (OKLAB) form is exactly toCSSWithFallback", () => {
    const all = exportAll(FIXTURES.threeStop135);
    expect(text(all["css-oklab"])).toBe(toCSSWithFallback(FIXTURES.threeStop135));
    expect(text(all.css)).toBe(`background: ${toCSS(FIXTURES.threeStop135)};`);
  });
});

// ── Geometry ──────────────────────────────────────────────────────────────────

const ANGLES = [0, 15, 30, 45, 60, 90, 120, 135, 180, 200, 225, 270, 300, 315, 337.5, 360, -45, 725];
const ASPECTS = [1, 2, 0.5, 16 / 9, 0.1, 7.3];

/** CSS gradient position of pixel (px, py) in a W x H box. */
function t(angle: number, W: number, H: number, px: number, py: number): number {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const L = Math.abs(W * dx) + Math.abs(H * dy);
  return ((px - W / 2) * dx + (py - H / 2) * dy) / L + 0.5;
}

describe("cssAngleToLine", () => {
  it("square 45deg runs from the bottom-left to the top-right corner", () => {
    const l = cssAngleToLine(45)!;
    expect([l.x1, l.y1, l.x2, l.y2].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0, 1, 1, 0]);
  });
  it.each([
    [0, [0.5, 1, 0.5, 0]],
    [90, [0, 0.5, 1, 0.5]],
    [180, [0.5, 0, 0.5, 1]],
    [270, [1, 0.5, 0, 0.5]],
    [135, [0, 0, 1, 1]],
  ])("square %ideg", (angle, expected) => {
    const l = cssAngleToLine(angle)!;
    [l.x1, l.y1, l.x2, l.y2].forEach((v, i) => expect(v).toBeCloseTo(expected[i], 9));
  });
  it.each(ANGLES.flatMap((a) => ASPECTS.map((s) => [a, s] as const)))("angle %f, aspect %f: start has t=0, end has t=1, corners span 0..1", (angle, aspect) => {
    const l = cssAngleToLine(angle, aspect)!;
    const W = aspect;
    const H = 1;
    expect(t(angle, W, H, l.x1 * W, l.y1 * H)).toBeCloseTo(0, 9);
    expect(t(angle, W, H, l.x2 * W, l.y2 * H)).toBeCloseTo(1, 9);
    const corners = [
      [0, 0],
      [W, 0],
      [0, H],
      [W, H],
    ].map(([x, y]) => t(angle, W, H, x, y));
    expect(Math.min(...corners)).toBeCloseTo(0, 9);
    expect(Math.max(...corners)).toBeCloseTo(1, 9);
    expect(Math.hypot((l.x2 - l.x1) * W, (l.y2 - l.y1) * H)).toBeCloseTo(l.length, 9);
  });
  it("non-finite angles give null; a bad aspect falls back to a square", () => {
    expect(cssAngleToLine(NaN)).toBeNull();
    expect(cssAngleToLine(Infinity)).toBeNull();
    expect(cssAngleToLine(45, -3)).toEqual(cssAngleToLine(45, 1));
    expect(cssAngleToLine(45, NaN)).toEqual(cssAngleToLine(45, 1));
  });
});

describe("Figma transform", () => {
  it("identity is a left-to-right gradient in a square (90deg)", () => {
    const m = angleToFigmaTransform(90)!;
    expect(m[0].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([1, 0, 0]);
    expect(m[1].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0, 1, 0]);
  });
  it.each(ANGLES.flatMap((a) => ASPECTS.map((s) => [a, s] as const)))("angle %f, aspect %f: the matrix sends pixels to the CSS position and back", (angle, aspect) => {
    const m = angleToFigmaTransform(angle, aspect)!;
    const W = aspect;
    for (const [fx, fy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [0.3, 0.7],
      [0.5, 0.5],
    ]) {
      const gx = m[0][0] * fx + m[0][1] * fy + m[0][2];
      expect(gx).toBeCloseTo(t(angle, W, 1, fx * W, fy), 9);
    }
    // The centre is on the gradient axis at the middle.
    const cy = m[1][0] * 0.5 + m[1][1] * 0.5 + m[1][2];
    expect(cy).toBeCloseTo(0.5, 9);
    const a = figmaTransformToAngle(m, aspect)!;
    const diff = Math.abs((((a - angle) % 360) + 540) % 360 - 180);
    expect(diff).toBeLessThan(1e-6);
  });
  it("the gradient-space y axis is perpendicular to the gradient line in pixels", () => {
    for (const aspect of [1, 2, 0.4]) {
      const m = angleToFigmaTransform(33, aspect)!;
      // Two box points with equal gradient-space x must differ along the isoline; their gradient-space y changes.
      const g = (fx: number, fy: number) => [m[0][0] * fx + m[0][1] * fy + m[0][2], m[1][0] * fx + m[1][1] * fy + m[1][2]];
      const a = g(0.2, 0.2);
      const b = g(0.2 + 0.1, 0.2);
      const c = g(0.2, 0.2 + 0.1);
      // pixel displacement (0.1*aspect, 0) and (0, 0.1): their projections onto x are the t differences.
      expect(b[0] - a[0]).toBeCloseTo(t(33, aspect, 1, 0.3 * aspect, 0.2) - t(33, aspect, 1, 0.2 * aspect, 0.2), 9);
      expect(c[0] - a[0]).toBeCloseTo(t(33, aspect, 1, 0.2 * aspect, 0.3) - t(33, aspect, 1, 0.2 * aspect, 0.2), 9);
    }
  });
  it("rejects bad matrices", () => {
    expect(figmaTransformToAngle([[0, 0, 0], [0, 0, 0]])).toBeNull();
    expect(figmaTransformToAngle([[1, 0, 0]])).toBeNull();
    expect(figmaTransformToAngle([[1, 0, NaN], [0, 1, 0]])).toBeNull();
    expect(figmaTransformToAngle("matrix")).toBeNull();
    expect(angleToFigmaTransform(NaN)).toBeNull();
  });
});

describe("toFigmaPaint / fromFigmaPaint", () => {
  it("emits RGBA 0-1 stops and a GRADIENT_LINEAR paint", () => {
    const r = toFigmaPaint(FIXTURES.threeStop135);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.paint.type).toBe("GRADIENT_LINEAR");
    expect(r.paint.gradientStops).toHaveLength(3);
    expect(r.paint.gradientStops[0]).toEqual({ position: 0, color: { r: 0.062745, g: 0.105882, b: 0.270588, a: 1 } });
    expect(JSON.parse(r.text)).toEqual(JSON.parse(JSON.stringify(r.paint)));
  });
  it.each(Object.keys(FIXTURES).filter((k) => k !== "outOfRange"))("%s: round trip keeps angle and stops (with bake 0)", (name) => {
    const d = FIXTURES[name];
    const r = toFigmaPaint(d, { bake: 0 });
    if (r.status !== "ok") throw new Error("expected ok");
    const back = fromFigmaPaint(r.paint);
    expect(back.status).toBe("ok");
    if (back.status !== "ok") return;
    const diff = Math.abs((((back.document.angle - d.angle) % 360) + 540) % 360 - 180);
    expect(diff).toBeLessThan(1e-5);
    expect(back.document.stops).toHaveLength(d.stops.length);
    back.document.stops.forEach((s, i) => {
      expect(s.color).toBe(d.stops[i].color);
      expect(s.alpha ?? 1).toBeCloseTo(d.stops[i].alpha ?? 1, 4);
    });
  });
  it.each([1, 2, 0.5, 16 / 9])("round trip at aspect %f", (aspect) => {
    const r = toFigmaPaint(FIXTURES.angleOdd, { aspect });
    if (r.status !== "ok") throw new Error("expected ok");
    const back = fromFigmaPaint(r.paint, { aspect });
    expect(back.status === "ok" && back.document.angle).toBeCloseTo(37.5, 5);
  });
  it("a paint read with a different aspect gives a different angle (the box matters)", () => {
    const r = toFigmaPaint(FIXTURES.angleOdd, { aspect: 2 });
    if (r.status !== "ok") throw new Error("expected ok");
    const back = fromFigmaPaint(r.paint, { aspect: 1 });
    expect(back.status === "ok" && Math.abs(back.document.angle - 37.5)).toBeGreaterThan(1);
  });
  it("bake emits about n stops and approximates OKLAB", () => {
    const r = toFigmaPaint(FIXTURES.oklab, { bake: 12 });
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.paint.gradientStops.length).toBeGreaterThanOrEqual(11);
    expect(r.paint.gradientStops.length).toBeLessThanOrEqual(12);
    expect(r.notes.join(" ")).toMatch(/Pre-sampled/);
  });
  it("an OKLAB document is baked by default; bake 0 turns it off and says what is lost", () => {
    const on = toFigmaPaint(FIXTURES.oklab);
    const off = toFigmaPaint(FIXTURES.oklab, { bake: 0 });
    expect(on.status === "ok" && on.paint.gradientStops.length).toBeGreaterThan(8);
    expect(off.status === "ok" && off.paint.gradientStops.length).toBe(2);
    expect(off.status === "ok" && off.notes.join(" ")).toMatch(/interpolate in sRGB/);
  });
  it("premultiplied baking: a red-to-transparent-blue midpoint stays red", () => {
    const r = toFigmaPaint(FIXTURES.alphaFade, { bake: 9 });
    if (r.status !== "ok") throw new Error("expected ok");
    const mid = r.paint.gradientStops.find((s) => Math.abs(s.position - 0.5) < 1e-9)!;
    expect(mid.color.a).toBeCloseTo(0.5, 3);
    expect(mid.color.r).toBeGreaterThan(0.95);
    expect(mid.color.b).toBeLessThan(0.05);
  });
  it("constant alpha needs no baking", () => {
    const r = toFigmaPaint(FIXTURES.alphaConstant);
    expect(r.status === "ok" && r.paint.gradientStops).toHaveLength(2);
  });
  it("differing alphas bake only the segments where alpha changes", () => {
    const d = doc(90, [{ color: "#000000", position: 0 }, { color: "#ffffff", position: 0.5 }, { color: "#ff0000", alpha: 0, position: 1 }]);
    const r = toFigmaPaint(d);
    if (r.status !== "ok") throw new Error("expected ok");
    const first = r.paint.gradientStops.filter((s) => s.position < 0.5);
    expect(first).toHaveLength(1);
    expect(r.paint.gradientStops.length).toBeGreaterThan(6);
  });
  it.each([
    ["wrong type", { type: "GRADIENT_RADIAL", gradientStops: [], gradientTransform: [[1, 0, 0], [0, 1, 0]] }, "unsupported-paint"],
    ["no stops", { type: "GRADIENT_LINEAR", gradientStops: [], gradientTransform: [[1, 0, 0], [0, 1, 0]] }, "invalid-input"],
    ["singular transform", { type: "GRADIENT_LINEAR", gradientStops: [{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }], gradientTransform: [[0, 0, 0], [0, 0, 0]] }, "invalid-input"],
    ["channel out of range", { type: "GRADIENT_LINEAR", gradientStops: [{ position: 0, color: { r: 2, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }], gradientTransform: [[1, 0, 0], [0, 1, 0]] }, "invalid-input"],
    ["position out of range", { type: "GRADIENT_LINEAR", gradientStops: [{ position: -1, color: { r: 0, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }], gradientTransform: [[1, 0, 0], [0, 1, 0]] }, "invalid-input"],
    ["null", null, "invalid-input"],
    ["a string", "GRADIENT_LINEAR", "invalid-input"],
    ["NaN opacity", { type: "GRADIENT_LINEAR", opacity: NaN, gradientStops: [], gradientTransform: [] }, "invalid-input"],
  ])("fromFigmaPaint rejects %s", (_n, paint, code) => {
    const r = fromFigmaPaint(paint);
    expect(r.status).toBe("unsupported");
    expect(r.status === "unsupported" && r.code).toBe(code);
  });
  it("paint opacity multiplies stop alpha", () => {
    const r = fromFigmaPaint({
      type: "GRADIENT_LINEAR",
      opacity: 0.5,
      gradientStops: [{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 1, g: 1, b: 1, a: 0.5 } }],
      gradientTransform: [[1, 0, 0], [0, 1, 0]],
    });
    expect(r.status === "ok" && r.document.stops.map((s) => s.alpha)).toEqual([0.5, 0.25]);
    expect(r.status === "ok" && r.document.angle).toBeCloseTo(90, 6);
  });
});

// ── SVG geometry ──────────────────────────────────────────────────────────────

describe("SVG gradientTransform", () => {
  const matrixOf = (svg: string) => {
    const m = /gradientTransform="matrix\(([^)]*)\)"/.exec(svg)!;
    return m[1].split(" ").map(Number);
  };
  it.each(ANGLES.flatMap((a) => [1, 2, 0.5].map((s) => [a, s] as const)))("angle %f, aspect %f: start/end/perpendicular land where CSS puts them", (angle, aspect) => {
    const W = 400 * aspect;
    const H = 400;
    const svg = text(toSvg(doc(angle, [{ color: "#000000" }, { color: "#ffffff" }]), { width: W, height: H }));
    const [a, b, c, d, e, f] = matrixOf(svg);
    const px = (gx: number, gy: number) => [(a * gx + c * gy + e) * W, (b * gx + d * gy + f) * H];
    const [sx, sy] = px(0, 0);
    const [ex, ey] = px(1, 0);
    expect(t(angle, W, H, sx, sy)).toBeCloseTo(0, 4);
    expect(t(angle, W, H, ex, ey)).toBeCloseTo(1, 4);
    const [qx, qy] = px(0, 1);
    // gy moves along the isoline: t is unchanged.
    expect(t(angle, W, H, qx, qy)).toBeCloseTo(0, 4);
    // Perpendicular in pixels.
    expect(((ex - sx) * (qx - sx) + (ey - sy) * (qy - sy)) / (Math.hypot(ex - sx, ey - sy) * Math.hypot(qx - sx, qy - sy))).toBeCloseTo(0, 4);
  });
  it("is a plain rect with a defs gradient and stop offsets in order", () => {
    const svg = text(toSvg(FIXTURES.threeStop135, { id: "sky" }));
    expect(svg).toContain('<linearGradient id="sky"');
    expect(svg).toContain('fill="url(#sky)"');
    const offsets = [...svg.matchAll(/offset="([^"]+)"/g)].map((m) => Number(m[1]));
    expect(offsets).toEqual([...offsets].sort((x, y) => x - y));
  });
  it("hard stops keep equal offsets", () => {
    const svg = text(toSvg(FIXTURES.hardStops));
    expect(svg.match(/offset="0\.5"/g)).toHaveLength(2);
  });
  it("alpha becomes stop-opacity", () => {
    expect(text(toSvg(FIXTURES.alphaConstant))).toContain('stop-opacity="0.5"');
  });
  it("sanitises ids and sizes", () => {
    const svg = text(toSvg(FIXTURES.twoStop180, { id: '"><script>alert(1)</script>', width: NaN, height: -4 }));
    expect(svg).not.toContain("<script");
    expect(svg).toMatch(/<linearGradient id="[A-Za-z][A-Za-z0-9_-]*"/);
    expect(svg).toContain('width="512" height="512"');
    expect(text(toSvg(FIXTURES.twoStop180, { id: "9lives" }))).toContain('id="g-9lives"');
    expect(text(toSvg(FIXTURES.twoStop180, { id: "" }))).toContain('id="gradient"');
    expect(text(toSvg(FIXTURES.twoStop180, { id: "a".repeat(200) })).match(/id="(a+)"/)![1]).toHaveLength(64);
  });
});

// ── Clipping, baking, boxes ───────────────────────────────────────────────────

describe("native pipeline", () => {
  it("clips stops outside 0-1 to the gradient line and says so", () => {
    const r = toFlutter(FIXTURES.outOfRange);
    expect(r.status).toBe("ok");
    const stops = /stops: \[([^\]]*)\]/.exec((r as ExportText).text)![1].split(", ").map(Number);
    expect(Math.min(...stops)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...stops)).toBeLessThanOrEqual(1);
    expect(stops[0]).toBe(0);
    expect(stops[stops.length - 1]).toBe(1);
    expect((r as ExportText).notes.join(" ")).toMatch(/clipped/);
  });
  it("a gradient entirely outside the line becomes a flat colour", () => {
    const d = doc(90, [{ color: "#ff0000", position: 1.2 }, { color: "#0000ff", position: 1.5 }]);
    const s = text(toFlutter(d));
    expect(s).toContain("Color(0xFFFF0000),\n    Color(0xFFFF0000),");
  });
  it("aspect ratio changes the start and end points of a diagonal", () => {
    const sq = text(toSwiftUI(FIXTURES.angle45));
    const wide = text(toSwiftUI(FIXTURES.angle45, { aspect: 2 }));
    expect(sq).not.toBe(wide);
    expect(wide).toContain("aspect ratio 2:1");
    const note = toSwiftUI(FIXTURES.angle45);
    expect(note.status === "ok" && note.notes.join(" ")).toContain("square box");
  });
  it("bakes by default for OKLAB, OKLCH and varying alpha; not for plain sRGB", () => {
    expect(text(toFlutter(FIXTURES.twoStop180)).match(/Color\(0x/g)).toHaveLength(2);
    expect(text(toFlutter(FIXTURES.oklab)).match(/Color\(0x/g)!.length).toBe(16);
    expect(text(toFlutter(FIXTURES.oklchLonger)).match(/Color\(0x/g)!.length).toBe(16);
    expect(text(toFlutter(FIXTURES.alphaFade)).match(/Color\(0x/g)!.length).toBe(16);
  });
  it("an explicit bake on a plain document samples in OKLAB; bake smaller than the stop count is a no-op", () => {
    expect(text(toFlutter(FIXTURES.twoStop180, { bake: 8 })).match(/Color\(0x/g)).toHaveLength(8);
    expect(text(toFlutter(FIXTURES.threeStop135, { bake: 2 })).match(/Color\(0x/g)).toHaveLength(3);
    expect(toFlutter(FIXTURES.threeStop135, { bake: 999 }).status).toBe("ok");
  });
  it("keeps every original stop when baking (hard stops survive)", () => {
    const d = { ...FIXTURES.hardStops, interpolation: { space: "oklab" as const } };
    const s = text(toFlutter(d));
    expect(s).toContain("Color(0xFFFF0000)");
    expect(s).toContain("Color(0xFF0000FF)");
    const stops = /stops: \[([^\]]*)\]/.exec(s)![1].split(", ").map(Number);
    expect(stops.filter((p) => p === 0.5).length).toBeGreaterThanOrEqual(2);
  });
});

// ── Repeating, invalid, hostile ───────────────────────────────────────────────

describe("unsupported results", () => {
  const NATIVE_KEYS = ["svg", "swiftui", "compose", "flutter", "godot", "android", "dtcg", "figma"] as const;
  it.each(NATIVE_KEYS)("%s: repeating gradients are a typed unsupported result", (key) => {
    const r = exportAll(REPEATING)[key];
    expect(r).toMatchObject({ status: "unsupported", code: "repeating" });
    expect(Object.keys(r).sort()).toEqual(["code", "reason", "status"]);
  });
  it("the CSS-family formats still export repeating gradients", () => {
    const all = exportAll(REPEATING);
    for (const k of ["css", "css-oklab", "tailwind", "scss", "css-variables"] as const) expect(all[k].status).toBe("ok");
    expect(text(all.css)).toContain("repeating-linear-gradient(45deg");
    const tw = toTailwind(REPEATING);
    expect(tw.status === "ok" && tw.native).toBeNull();
    expect(text(toScss(REPEATING))).toContain("repeating-linear-gradient(");
    expect(text(toCssVariables(REPEATING))).toContain("repeating-linear-gradient(");
  });
  const BAD: [string, unknown][] = [
    ["null", null],
    ["undefined", undefined],
    ["a string", "linear-gradient(red, blue)"],
    ["a number", 7],
    ["an array", []],
    ["no stops", { kind: "linear", angle: 0, stops: [] }],
    ["one stop", { kind: "linear", angle: 0, stops: [{ color: "#ff0000" }] }],
    ["radial kind", { kind: "radial", angle: 0, stops: [{ color: "#ff0000" }, { color: "#0000ff" }] }],
    ["NaN angle", { kind: "linear", angle: NaN, stops: [{ color: "#ff0000" }, { color: "#0000ff" }] }],
    ["Infinity angle", { kind: "linear", angle: Infinity, stops: [{ color: "#ff0000" }, { color: "#0000ff" }] }],
    ["string angle", { kind: "linear", angle: "90", stops: [{ color: "#ff0000" }, { color: "#0000ff" }] }],
    ["injected colour", { kind: "linear", angle: 0, stops: [{ color: "red; } body { display: none" }, { color: "#0000ff" }] }],
    ["url colour", { kind: "linear", angle: 0, stops: [{ color: "url(javascript:alert(1))" }, { color: "#0000ff" }] }],
    ["short hex", { kind: "linear", angle: 0, stops: [{ color: "#f00" }, { color: "#0000ff" }] }],
    ["alpha 2", { kind: "linear", angle: 0, stops: [{ color: "#ff0000", alpha: 2 }, { color: "#0000ff" }] }],
    ["NaN alpha", { kind: "linear", angle: 0, stops: [{ color: "#ff0000", alpha: NaN }, { color: "#0000ff" }] }],
    ["NaN position", { kind: "linear", angle: 0, stops: [{ color: "#ff0000", position: NaN }, { color: "#0000ff" }] }],
    ["null stop", { kind: "linear", angle: 0, stops: [null, { color: "#0000ff" }] }],
  ];
  it.each(BAD)("%s: every format returns unsupported, never throws", (_n, d) => {
    const all = exportAll(d as GradientDocument);
    for (const k of KEYS) {
      expect(all[k].status, k).toBe("unsupported");
      const r = all[k];
      if (r.status === "unsupported") {
        expect(["invalid-document", "unsupported-kind"]).toContain(r.code);
        expect(r.reason.length).toBeGreaterThan(5);
      }
    }
  });
  it("a document with throwing getters or a hostile Proxy is unsupported", () => {
    const evil = { kind: "linear", angle: 0, get stops(): never { throw new Error("boom"); } };
    const proxy = new Proxy({}, { get() { throw new Error("nope"); }, has() { throw new Error("nope"); } });
    for (const d of [evil, proxy]) {
      const all = exportAll(d as unknown as GradientDocument);
      for (const k of KEYS) expect(all[k].status).toBe("unsupported");
    }
  });
  it("fromFigmaPaint never throws on hostile input", () => {
    const proxy = new Proxy({}, { get() { throw new Error("nope"); } });
    expect(fromFigmaPaint(proxy).status).toBe("unsupported");
    expect(fromFigmaPaint({ get type(): never { throw new Error("x"); } }).status).toBe("unsupported");
  });
});

// ── Injection safety ──────────────────────────────────────────────────────────

describe("hostile names, prefixes and ids", () => {
  const HOSTILE = ['"; } body { background: red } /*', "<script>alert(1)</script>", "../../etc/passwd", "a b\nc\td", "${process.exit()}", "$(rm -rf /)", "‮evil", "💥", "x".repeat(500), "__proto__", "constructor", "-leading", "9digits", "", "   "];
  it.each(HOSTILE)("name %j only ever yields [a-z0-9-] identifiers", (name) => {
    const d = FIXTURES.threeStop135;
    const tw = toTailwind(d, { name });
    if (tw.status !== "ok") throw new Error("expected ok");
    expect(/^@theme \{\n {2}--background-image-[a-z][a-z0-9-]{0,39}: /.test(tw.theme)).toBe(true);
    expect(/^@utility bg-[a-z][a-z0-9-]{0,39} \{\n/.test(tw.utility)).toBe(true);
    expect(tw.theme.split("\n")).toHaveLength(3);
    const scss = text(toScss(d, { name }));
    for (const line of scss.split("\n")) {
      if (line.startsWith("$")) expect(line).toMatch(/^\$[a-z][a-z0-9-]*(-angle|-color-\d+|-position-\d+)?: /);
    }
    const css = text(toCssVariables(d, { prefix: name }));
    for (const line of css.split("\n").filter((l) => l.startsWith("  --"))) expect(line).toMatch(/^ {2}--[a-z][a-z0-9-]*: [^;{}<>"']+;$/);
    expect(css.split("\n")).toHaveLength(12);
    expect(css).not.toMatch(/<|"|\/\*\s*body/);
  });
  it.each(HOSTILE)("SVG id %j is a valid XML id", (id) => {
    const svg = text(toSvg(FIXTURES.twoStop180, { id }));
    expect(svg).toMatch(/<linearGradient id="[A-Za-z][A-Za-z0-9_-]{0,63}" x1/);
    expect(svg).toMatch(/fill="url\(#[A-Za-z][A-Za-z0-9_-]*\)"/);
    expect((svg.match(/</g) ?? []).length).toBe((svg.match(/>/g) ?? []).length);
  });
  it.each(HOSTILE)("DTCG name %j yields exactly one own top-level key of safe characters", (name) => {
    const json = JSON.parse(text(toDtcg(FIXTURES.twoStop180, { name })));
    const keys = Object.keys(json);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(Object.getPrototypeOf(json)).toBe(Object.prototype);
  });
  it("non-string names fall back to the default", () => {
    for (const bad of [null, 7, {}, [], () => 1]) {
      const tw = toTailwind(FIXTURES.twoStop180, { name: bad as unknown as string });
      expect(tw.status === "ok" && tw.theme).toContain("--background-image-gradient:");
    }
  });
  it("hostile stop ids never reach the output", () => {
    const d = doc(90, [{ color: "#ff0000", id: "</script><x>" }, { color: "#0000ff", id: "\"; alert(1)" }]);
    for (const k of KEYS) {
      const r = exportAll(d)[k];
      expect(r.status === "ok" && r.text).not.toMatch(/alert|<x>|<\/script>/);
    }
  });
});

// ── Determinism, purity, plausibility ─────────────────────────────────────────

const deepFreeze = <T,>(v: T): T => {
  if (typeof v === "object" && v !== null) {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
};

function balanced(src: string): boolean {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  for (const ch of src) {
    if ("([{".includes(ch)) stack.push(ch);
    else if (ch in pairs && stack.pop() !== pairs[ch]) return false;
  }
  return stack.length === 0;
}

describe("determinism and plausibility", () => {
  it.each(Object.keys(FIXTURES))("%s: output is deterministic and the input is not mutated", (name) => {
    const frozen = deepFreeze(structuredClone(FIXTURES[name]));
    const a = exportAll(frozen);
    const b = exportAll(structuredClone(FIXTURES[name]));
    expect(a).toEqual(b);
    expect(frozen).toEqual(FIXTURES[name]);
  });
  it.each(Object.keys(FIXTURES).flatMap((n) => KEYS.map((k) => [n, k] as const)))("%s / %s: bracket-balanced, no NaN/undefined/Infinity", (name, key) => {
    const r = exportAll(FIXTURES[name])[key];
    if (r.status !== "ok") throw new Error(`${name}/${key} unexpectedly unsupported`);
    expect(r.text).not.toMatch(/\bNaN\b|\bundefined\b|\bInfinity\b|\[object|\bnull\b/);
    expect(r.text.trim().length).toBeGreaterThan(20);
    expect(balanced(r.text.replace(/<!--[\s\S]*?-->/g, ""))).toBe(true);
    if (key === "svg" || key === "android") {
      const body = r.text.replace(/<\?xml[^>]*\?>/, "").replace(/<!--[\s\S]*?-->/g, "");
      expect((body.match(/</g) ?? []).length).toBe((body.match(/>/g) ?? []).length);
      for (const c of r.text.matchAll(/<!--([\s\S]*?)-->/g)) expect(c[1]).not.toContain("--");
    }
    if (key === "dtcg" || key === "figma") expect(() => JSON.parse(r.text)).not.toThrow();
    expect(r.language).toBe(EXPORT_FORMATS.find((f) => f.key === key)!.language);
  });
  it("native formats say 'Untested on device'", () => {
    const all = exportAll(FIXTURES.threeStop135);
    for (const f of EXPORT_FORMATS.filter((x) => x.native)) {
      const r = all[f.key];
      expect(r.status === "ok" && (r.notes.join(" ") + r.text).includes("ntested")).toBe(true);
    }
  });
  it("native snippets never assert unverified platform behaviour", () => {
    const all = exportAll(FIXTURES.oklab);
    for (const k of ["swiftui", "compose", "flutter", "godot", "android"] as const) {
      const r = all[k];
      expect(r.status === "ok" && r.text).not.toMatch(/OKLAB interpolat|perceptual\)|\.perceptual|interpolation_color_space|ColorSpace/);
    }
  });
});

describe("exportAll", () => {
  it("has a stable key list with unique labels and display languages", () => {
    expect(KEYS).toEqual(["css", "css-oklab", "tailwind", "scss", "css-variables", "svg", "swiftui", "compose", "flutter", "godot", "android", "dtcg", "figma"]);
    expect(new Set(EXPORT_FORMATS.map((f) => f.label)).size).toBe(EXPORT_FORMATS.length);
    expect(Object.keys(exportAll(FIXTURES.twoStop180))).toEqual(KEYS);
  });
  it("passes options through", () => {
    const all = exportAll(FIXTURES.twoStop180, { name: "hero", prefix: "x", id: "g1", width: 200, height: 100, aspect: 2, bake: 0 });
    expect(text(all.scss)).toContain("$hero-angle");
    expect(text(all["css-variables"])).toContain("--x-angle");
    expect(text(all.svg)).toContain('id="g1"');
    expect(text(all.svg)).toContain('width="200"');
    expect(text(all.swiftui)).toContain("aspect ratio 2:1");
  });
  it("the CSS tab respects the document's interpolation", () => {
    expect(text(exportAll(FIXTURES.oklab).css)).toContain("135deg in oklab");
  });
  it("the oklab tab on an sRGB document is a single declaration", () => {
    const d = doc(90, [{ color: "#ff0000" }, { color: "#0000ff" }], { interpolation: { space: "srgb" } });
    expect(text(exportAll(d)["css-oklab"]).split("\n")).toHaveLength(1);
  });
});
