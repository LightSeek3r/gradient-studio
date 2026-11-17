// Runs in plain Node: no DOM globals at all.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("server-side import", () => {
  it("has no DOM globals in this environment", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof HTMLElement).toBe("undefined");
    expect(typeof customElements).toBe("undefined");
  });
  it("importing the main entry does not throw and defines nothing", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.defineElements).toBe("function");
    expect(typeof mod.Opal42GradientScoreElement).toBe("function");
    expect(typeof mod.Opal42GradientPreviewElement).toBe("function");
  });
  it("defineElements is a safe no-op without a DOM", async () => {
    const { defineElements } = await import("../src/index");
    expect(defineElements()).toEqual({ scoreTag: "opal42-gradient-score", previewTag: "opal42-gradient-preview", defined: false });
    expect(defineElements({ scoreTag: "x-a" }).defined).toBe(false);
  });
  it("the auto-defining entry imports cleanly without a DOM", async () => {
    await expect(import("../src/define")).resolves.toBeDefined();
  });
  it("the pure analysis runs on the server", async () => {
    const { analyzeCss, refineCss } = await import("../src/index");
    const r = analyzeCss("linear-gradient(90deg, #ff0000, #0000ff)", { withFix: true });
    expect(r.status).toBe("ok");
    expect(r.fix).not.toBeNull();
    expect(refineCss("linear-gradient(90deg, #ff0000, #0000ff)")).toMatch(/^linear-gradient/);
  });
  it("constructing an element outside a browser fails loudly, not at import", async () => {
    const { Opal42GradientScoreElement } = await import("../src/index");
    expect(() => new Opal42GradientScoreElement()).toThrow();
  });
  const dist = new URL("../dist/index.js", import.meta.url);
  it.skipIf(!existsSync(dist))("the built ESM and the standalone file import under plain node", () => {
    for (const file of ["dist/index.js", "dist/define.js", "dist/opal42-element.js"]) {
      const url = new URL(`../${file}`, import.meta.url).href;
      const out = execFileSync(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(url)}); console.log(m.defineElements ? "function" : "side-effect-only")`], {
        encoding: "utf8",
      });
      expect(out.trim()).toMatch(/function|side-effect-only/);
    }
  });
});
