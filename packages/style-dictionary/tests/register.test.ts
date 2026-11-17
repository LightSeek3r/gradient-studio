/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures read untyped JSON */
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import StyleDictionary from "style-dictionary";
import { describe, expect, it } from "vitest";
import * as pkg from "../src/index";
import { RGB_STOPS, SMOOTH_STOPS } from "./fixtures";

async function withTokens<T>(tokens: unknown, fn: (file: string, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "opal42-sd-reg-"));
  const file = join(dir, "t.json");
  await writeFile(file, JSON.stringify(tokens));
  try {
    return await fn(file, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("register", () => {
  it("exports the public names", () => {
    expect([pkg.TRANSFORM_SCORE, pkg.TRANSFORM_REFINE, pkg.FORMAT_REPORT, pkg.FORMAT_CSS, pkg.ACTION_CHECK, pkg.TRANSFORM_GROUP]).toEqual([
      "opal42/gradient-score",
      "opal42/gradient-refine",
      "opal42/report-json",
      "opal42/css-gradients",
      "opal42/gradient-check",
      "opal42/css",
    ]);
  });

  it("registers on a Style Dictionary instance: two transforms, two formats, a group, an action", async () => {
    const sd = new StyleDictionary({ tokens: {} });
    pkg.register(sd);
    await sd.hasInitialized;
    const h = sd.hooks as any;
    expect(h.transforms["opal42/gradient-score"]).toMatchObject({ type: "attribute", transitive: false });
    expect(h.transforms["opal42/gradient-refine"]).toMatchObject({ type: "value", transitive: true });
    expect(Object.keys(h.formats)).toEqual(expect.arrayContaining(["opal42/report-json", "opal42/css-gradients"]));
    expect(h.transformGroups["opal42/css"]).toEqual(["name/kebab", "color/css", "opal42/gradient-score"]);
    expect(Object.keys(h.actions)).toContain("opal42/gradient-check");
  });

  it("registers on the class (global) and the config can use the hooks by name", async () => {
    pkg.register(StyleDictionary, { log: false });
    await withTokens({ g: { $type: "gradient", $value: SMOOTH_STOPS } }, async (file, dir) => {
      const sd = new StyleDictionary({
        source: [file],
        log: { verbosity: "silent" },
        platforms: { css: { transformGroup: "opal42/css", buildPath: dir + "/out/", files: [{ destination: "g.css", format: "opal42/css-gradients" }] } },
      });
      await sd.buildAllPlatforms();
      expect(await readFile(join(dir, "out/g.css"), "utf8")).toContain("--g: linear-gradient(90deg, #101b45 0%, #9333ea 100%);");
    });
  });

  it("registering twice replaces the hooks (idempotent)", async () => {
    const sd = new StyleDictionary({ tokens: {} });
    pkg.register(sd);
    pkg.register(sd, { minScore: 1 });
    await sd.hasInitialized;
    expect(Object.keys((sd.hooks as any).transforms).filter((n) => n.startsWith("opal42/"))).toHaveLength(2);
  });

  it("the ready-made group composes with SD's other groups' transforms via a custom group", async () => {
    await withTokens({ g: { $type: "gradient", $value: RGB_STOPS } }, async (file, dir) => {
      const sd = new StyleDictionary({
        source: [file],
        log: { verbosity: "silent" },
        platforms: { css: { transforms: ["name/camel", "opal42/gradient-score"], buildPath: dir + "/out/", files: [{ destination: "g.css", format: "opal42/css-gradients" }] } },
      });
      pkg.register(sd, { log: false });
      await sd.buildAllPlatforms();
      expect(await readFile(join(dir, "out/g.css"), "utf8")).toContain("--g:");
    });
  });

  it("with `expand`, composite gradients are split by Style Dictionary and are no longer gradient tokens: exclude them", async () => {
    await withTokens({ g: { $type: "gradient", $value: SMOOTH_STOPS } }, async (file, dir) => {
      const make = (expand: unknown) =>
        new StyleDictionary({
          source: [file],
          log: { verbosity: "silent" },
          expand: expand as never,
          platforms: { css: { transformGroup: "opal42/css", buildPath: dir + "/out/", files: [{ destination: "g.css", format: "opal42/css-gradients" }] } },
        });
      const a = make(true);
      pkg.register(a, { log: false });
      await a.buildAllPlatforms();
      expect(await readFile(join(dir, "out/g.css"), "utf8")).not.toContain("linear-gradient");
      const b = make({ exclude: ["gradient"] });
      pkg.register(b, { log: false });
      await b.buildAllPlatforms();
      expect(await readFile(join(dir, "out/g.css"), "utf8")).toContain("--g: linear-gradient(");
    });
  });

  it("buildReport is usable without Style Dictionary", () => {
    const text = pkg.buildReport([{ path: ["a"], $type: "gradient", $value: RGB_STOPS }], { usesDtcg: true });
    expect(JSON.parse(text).tokens[0]).toMatchObject({ path: "a", score: 58 });
  });
});
