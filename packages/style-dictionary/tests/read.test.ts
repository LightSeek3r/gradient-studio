import { describe, expect, it } from "vitest";
import { readGradient, VENDOR_EXTENSION } from "../src/index";
import { srgb, stop } from "./fixtures";

const ok = (v: unknown, ctx = {}) => {
  const r = readGradient(v, ctx);
  if (r.status !== "ok") throw new Error(`expected ok, got ${r.code}: ${r.reason}`);
  return r;
};
const skipped = (v: unknown) => {
  const r = readGradient(v);
  if (r.status !== "skipped") throw new Error("expected a skip");
  return r;
};

describe("accepted shapes", () => {
  it("DTCG array with srgb colour objects", () => {
    const r = ok([stop("#ff0000", 0), stop("#0000ff", 1)]);
    expect(r.shape).toBe("dtcg-array");
    expect(r.document).toEqual({ kind: "linear", angle: 90, stops: [{ color: "#ff0000", position: 0 }, { color: "#0000ff", position: 1 }] });
    expect(r.stops?.map((s) => s.style)).toEqual(["object", "object"]);
  });

  it("pre-2025 draft: array of { color: string, position }", () => {
    const r = ok([{ color: "#ff0000", position: 0 }, { color: "rgb(0 0 255)", position: 1 }]);
    expect(r.document.stops.map((s) => s.color)).toEqual(["#ff0000", "#0000ff"]);
    expect(r.stops?.map((s) => s.style)).toEqual(["string", "string"]);
  });

  it("mixed string and object colours", () => {
    expect(ok([{ color: "#fff", position: 0 }, stop("#000000", 1)]).document.stops.map((s) => s.color)).toEqual(["#ffffff", "#000000"]);
  });

  it("a missing position stays automatic", () => {
    expect(ok([stop("#ff0000"), stop("#0000ff")]).document.stops.map((s) => s.position)).toEqual([undefined, undefined]);
  });

  it("oklch and oklab objects are converted by the core colour parser", () => {
    const r = ok([{ color: { colorSpace: "oklch", components: [0.628, 0.2577, 29.23] }, position: 0 }, { color: { colorSpace: "oklab", components: [0.452, -0.032, -0.312] }, position: 1 }]);
    expect(r.document.stops[0]?.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(r.document.stops[1]?.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("alpha below 1 is kept on the stop", () => {
    const r = ok([{ color: srgb(1, 0, 0, 0.5), position: 0 }, stop("#0000ff", 1)]);
    expect(r.document.stops[0]?.alpha).toBe(0.5);
    expect(r.document.stops[1]?.alpha).toBeUndefined();
  });

  it('"none" components count as 0', () => {
    const r = ok([{ color: { colorSpace: "srgb", components: ["none", 0, 0] }, position: 0 }, stop("#ffffff", 1)]);
    expect(r.document.stops[0]?.color).toBe("#000000");
  });

  it("a legacy CSS string holding one linear gradient", () => {
    const r = ok("linear-gradient(135deg, #ff0000 0%, #0000ff 100%)");
    expect(r.shape).toBe("css-string");
    expect(r.document.angle).toBe(135);
    expect(r.document.stops).toHaveLength(2);
  });

  it("a CSS string with surrounding whitespace", () => {
    expect(ok("  linear-gradient(90deg, red, blue)\n").shape).toBe("css-string");
  });
});

describe("angle and interpolation", () => {
  it("default 90, the ctx angle, then the vendor extension", () => {
    const v = [stop("#ff0000", 0), stop("#0000ff", 1)];
    expect(ok(v).document.angle).toBe(90);
    expect(ok(v, { angle: 180 }).document.angle).toBe(180);
    expect(ok(v, { angle: 180, extensions: { [VENDOR_EXTENSION]: { angle: 135 } } }).document.angle).toBe(135);
  });

  it("$extensions.opal42.angle wins over the vendor entry", () => {
    expect(ok([stop("#ff0000", 0), stop("#0000ff", 1)], { extensions: { opal42: { angle: 45 }, [VENDOR_EXTENSION]: { angle: 135 } } }).document.angle).toBe(45);
  });

  it("reads the interpolation toDtcg writes", () => {
    const r = ok([stop("#ff0000", 0), stop("#0000ff", 1)], { extensions: { [VENDOR_EXTENSION]: { interpolation: { space: "oklch", hue: "longer" } } } });
    expect(r.document.interpolation).toEqual({ space: "oklch", hue: "longer" });
  });

  it("ignores a malformed extension", () => {
    expect(ok([stop("#ff0000", 0), stop("#0000ff", 1)], { extensions: { [VENDOR_EXTENSION]: { angle: "x", interpolation: { space: "hsl" } } } }).document).not.toHaveProperty("interpolation");
  });
});

describe("structured skips", () => {
  it.each<[string, unknown, string]>([
    ["null", null, "invalid-shape"],
    ["number", 3, "invalid-shape"],
    ["plain object (not an array)", { color: "#fff", position: 0 }, "invalid-shape"],
    ["stop that is not an object", ["#ff0000"], "invalid-stop"],
    ["stop without a colour", [{ position: 0 }], "invalid-stop"],
    ["unparseable colour string", [{ color: "nope", position: 0 }], "invalid-color"],
    ["colour that is neither string nor object", [{ color: 7, position: 0 }], "invalid-color"],
    ["object without components", [{ color: { colorSpace: "srgb" }, position: 0 }], "invalid-color"],
    ["two components", [{ color: { colorSpace: "srgb", components: [0, 0] }, position: 0 }], "invalid-color"],
    ["non-numeric component", [{ color: { colorSpace: "srgb", components: [0, "x", 0] }, position: 0 }], "invalid-color"],
    ["srgb component above 1", [{ color: { colorSpace: "srgb", components: [2, 0, 0] }, position: 0 }], "invalid-color"],
    ["display-p3 (not converted)", [{ color: { colorSpace: "display-p3", components: [1, 0, 0], hex: "#ff0000" }, position: 0 }], "unsupported-color-space"],
    ["hsl object (not converted)", [{ color: { colorSpace: "hsl", components: [0, 100, 50] }, position: 0 }], "unsupported-color-space"],
    ["string position", [{ color: "#fff", position: "50%" }], "invalid-position"],
    ["NaN position", [{ color: "#fff", position: Number.NaN }], "invalid-position"],
    ["empty string", "", "no-gradient"],
    ["string without gradient", "#ff0000", "no-gradient"],
    ["two gradients", "linear-gradient(red, blue), linear-gradient(blue, red)", "multiple-gradients"],
    ["text around the gradient", "url(a.png), linear-gradient(red, blue)", "not-a-single-gradient"],
    ["radial gradient (core skip code)", "radial-gradient(red, blue)", "unsupported-kind"],
    ["var() inside (core skip code)", "linear-gradient(var(--a), blue)", "var"],
    ["vendor-prefixed (core skip code)", "-webkit-linear-gradient(red, blue)", "legacy-syntax"],
  ])("%s", (_name, value, code) => {
    expect(skipped(value).code).toBe(code);
  });

  it("the skip carries a human reason", () => {
    expect(skipped([{ color: "nope" }]).reason).toMatch(/stop 1/);
  });

  it("the hex fallback of a wide-gamut colour is deliberately not used", () => {
    expect(skipped([{ color: { colorSpace: "display-p3", components: [1, 0, 0], hex: "#ff0000" } }]).reason).toMatch(/hex/);
  });
});
