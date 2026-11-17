import { afterEach, describe, expect, it, vi } from "vitest";
import { build, type BuildResult } from "./helpers";
import { RGB_STOPS, SMOOTH_STOPS, NAVY_STOPS, srgb, stop } from "./fixtures";

let last: BuildResult | undefined;
afterEach(async () => {
  await last?.cleanup();
  last = undefined;
  vi.restoreAllMocks();
});

const TOKENS = {
  color: { a: { $type: "color", $value: srgb(1, 0, 0) }, b: { $type: "color", $value: srgb(0, 0, 1) } },
  z: { $type: "gradient", $value: RGB_STOPS }, // 58
  navy: { $type: "gradient", $value: NAVY_STOPS }, // 71
  smooth: { $type: "gradient", $value: SMOOTH_STOPS }, // 95
  ref: { $type: "gradient", $value: [{ color: "{color.a}", position: 0 }, { color: "{color.b}", position: 1 }] }, // 87
  alpha: { $type: "gradient", $value: [{ color: srgb(1, 0, 0, 0.5), position: 0 }, stop("#0000ff", 1)] },
  broken: { $type: "gradient", $value: "nope" },
  stripes: { $type: "gradient", $value: [stop("#ff0000", 0), stop("#ff0000", 0.5), stop("#0000ff", 0.5), stop("#0000ff", 1)] },
};

const attempt = async (options: object, extra = {}) => {
  try {
    last = await build({ tokens: { "t.json": TOKENS }, options, ...extra });
    return undefined;
  } catch (e) {
    return e as Error;
  }
};

describe("minScore", () => {
  it("has no default threshold: a bad gradient never fails or warns without it", async () => {
    const messages: string[] = [];
    expect(await attempt({ log: (m: string) => messages.push(m), onBelowMin: "error" })).toBeUndefined();
    expect(messages).toEqual([]);
  });

  it("onBelowMin: 'error' fails the build with a precise, sorted token list", async () => {
    const e = await attempt({ minScore: 80, onBelowMin: "error" });
    expect(e).toBeInstanceOf(Error);
    expect(e!.message).toContain("opal42: 2 gradient tokens below minScore 80 (smoothness score, scoring model v1):");
    const lines = e!.message.split("\n").slice(1);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^ {2}navy: 71 \(/);
    expect(lines[1]).toMatch(/^ {2}z: 58 \(/);
    expect(lines[1]).toContain("lightness/reversal");
  });

  it("does not count unscorable, skipped or hard-stop gradients", async () => {
    const e = await attempt({ minScore: 100, onBelowMin: "error" });
    const names = e!.message.split("\n").slice(1).map((l) => l.trim().split(":")[0]);
    expect(names).toEqual(["navy", "ref", "smooth", "z"]);
  });

  it("a gradient exactly at the minimum passes", async () => {
    expect(await attempt({ minScore: 58, onBelowMin: "error" })).toBeUndefined();
  });

  it("singular message for one token", async () => {
    const e = await attempt({ minScore: 60, onBelowMin: "error" });
    expect(e!.message).toContain("opal42: 1 gradient token below minScore 60");
  });

  it("warn (the default) logs once and the build succeeds", async () => {
    const messages: string[] = [];
    expect(await attempt({ minScore: 80, log: (m: string) => messages.push(m) })).toBeUndefined();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("navy: 71");
    expect(messages[0]).toContain("z: 58");
    expect(await last!.read("report.json")).toContain('"minScore": 80');
  });

  it("warn goes to console.warn by default", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await attempt({ minScore: 80, log: undefined }, { verbosity: "default" })).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("below minScore 80");
  });

  it("the default log is silent when Style Dictionary's verbosity is silent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await attempt({ minScore: 80, log: undefined })).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("log: false mutes the warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await attempt({ minScore: 80, log: false })).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("checks the built value: a refined gradient is judged after refinement", async () => {
    const e = await attempt({ minScore: 80, onBelowMin: "error" }, { transforms: ["name/kebab", "color/css", "opal42/gradient-score", "opal42/gradient-refine"] });
    // z refines to 90 and navy to 83: both now pass
    expect(e).toBeUndefined();
  });

  it("a locked token keeps its score and is still checked", async () => {
    last = undefined;
    try {
      last = await build({
        tokens: { "t.json": { z: { $type: "gradient", $value: RGB_STOPS, $extensions: { opal42: { lock: true } } } } },
        options: { minScore: 80, onBelowMin: "error" },
        transforms: ["name/kebab", "opal42/gradient-refine"],
      });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain("z: 58");
    }
  });

  it("the action enforces it when no opal42 format is used", async () => {
    const e = await attempt({ minScore: 80, onBelowMin: "error" }, { files: [{ destination: "x.css", format: "css/variables" }], actions: ["opal42/gradient-check"] });
    expect(e).toBeInstanceOf(Error);
    expect(e!.message).toContain("z: 58");
  });

  it("the action alone is silent without minScore", async () => {
    expect(await attempt({}, { files: [{ destination: "x.css", format: "css/variables" }], actions: ["opal42/gradient-check"] })).toBeUndefined();
  });

  it.each([
    [{ minScore: Number.NaN }, /minScore/],
    [{ minScore: "70" as unknown as number }, /minScore/],
    [{ onBelowMin: "fail" as unknown as "warn" }, /onBelowMin/],
    [{ angle: Infinity }, /angle/],
  ])("rejects bad options %j", async (options, re) => {
    const e = await attempt(options);
    expect(e).toBeInstanceOf(TypeError);
    expect(e!.message).toMatch(re);
  });
});
