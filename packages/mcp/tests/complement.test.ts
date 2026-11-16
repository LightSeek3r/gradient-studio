import { describe, expect, it } from "vitest";
import { hexToOklch } from "@opal42/gradient";
import { callTool } from "../src/handlers";
import { complement, errorText, sc } from "./helpers";

describe("complement", () => {
  it("returns the normalised input and its complement as #rrggbb", () => {
    expect(sc(complement({ color: "tomato" }))).toEqual({ input: "tomato", color: "#ff6347", complement: "#00b0c9" });
  });

  it.each(["#ff0000", "#f00", "rgb(255 0 0)", "rgb(255, 0, 0)", "hsl(0 100% 50%)", "red", "RED", "oklch(0.628 0.2577 29.23)"])("accepts %s", (color) => {
    const out = sc(complement({ color }));
    expect(out.complement).toMatch(/^#[0-9a-f]{6}$/);
    expect(out.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("rotates the OKLCH hue by 180 degrees", () => {
    for (const color of ["#3b82f6", "#e11d48", "#16a34a", "#f59e0b"]) {
      const out = sc(complement({ color }));
      const a = hexToOklch(out.color).h;
      const b = hexToOklch(out.complement).h;
      const shortestArc = Math.abs(((a - b + 540) % 360) - 180);
      expect(shortestArc).toBeGreaterThan(177);
    }
  });

  it("ignores alpha and says so", () => {
    const out = sc(complement({ color: "rgb(255 0 0 / 0.5)" }));
    expect(out.alphaIgnored).toBe(true);
    expect(out.color).toBe("#ff0000");
    expect(sc(complement({ color: "red" })).alphaIgnored).toBeUndefined();
  });

  it("echoes at most a short excerpt of the input", () => {
    expect(sc(complement({ color: "  red  " })).input).toBe("  red  ");
  });

  it.each(["", "var(--c)", "currentColor", "not-a-colour", "#12", "red blue", "color-mix(in srgb, red, blue)", '"><script>alert(1)</script>', "1".repeat(201)])("refuses %j with an error result", (color) => {
    const r = complement({ color });
    expect(r.isError).toBe(true);
  });

  it("explains an unsupported colour and requires the argument", () => {
    expect(errorText(complement({ color: "var(--brand)" }))).toMatch(/color: "var\(--brand\)" is not a supported CSS colour/);
    expect(errorText(complement({}))).toMatch(/missing required property "color"/);
    expect(errorText(complement({ color: 5 }))).toMatch(/color: expected a string/);
    expect(errorText(complement({ color: "red", extra: 1 }))).toMatch(/unknown property/);
  });

  it("never throws for any argument shape", () => {
    for (const args of [null, undefined, [], "red", 1, true, { color: null }, { color: {} }, { color: [] }]) {
      expect(() => callTool("complement", args)).not.toThrow();
      expect(callTool("complement", args).isError).toBe(true);
    }
  });

  it("is deterministic", () => {
    expect(JSON.stringify(complement({ color: "#336699" }))).toBe(JSON.stringify(complement({ color: "#336699" })));
  });
});
