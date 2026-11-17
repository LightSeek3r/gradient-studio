import { afterEach, describe, expect, it } from "vitest";
import { build, type BuildResult } from "./helpers";
import { NAVY_STOPS, RGB_STOPS, SMOOTH_STOPS, srgb, stop } from "./fixtures";

let last: BuildResult | undefined;
afterEach(async () => {
  await last?.cleanup();
  last = undefined;
});
const run = async (tokens: unknown, extra = {}) => (last = await build({ tokens: { "t.json": tokens }, ...extra }));

describe("opal42/gradient-score on real builds", () => {
  it("adds attributes.opal42 and never changes the value", async () => {
    const r = await run({ grad: { rgb: { $type: "gradient", $value: RGB_STOPS } } });
    const t = (await r.tokens())["grad.rgb"]!;
    expect(t.attributes.opal42).toEqual({
      score: 58,
      scoringModel: "v1",
      status: "scored",
      findings: expect.any(Array),
    });
    expect(t.attributes.opal42.findings.length).toBeGreaterThan(0);
    for (const f of t.attributes.opal42.findings) {
      expect(Object.keys(f).sort()).toEqual(["code", "pointsLost", "severity", "stops"]);
    }
    expect(t.value).toEqual(RGB_STOPS);
    expect(t.value).toEqual(t.original);
  });

  it("a smooth gradient has a score and few findings", async () => {
    const r = await run({ g: { $type: "gradient", $value: SMOOTH_STOPS } });
    const a = (await r.tokens())["g"]!.attributes.opal42;
    expect(a.status).toBe("scored");
    expect(a.score).toBe(95);
  });

  it("resolves {references} to colour tokens before reading the stops", async () => {
    const r = await run({
      color: { a: { $type: "color", $value: srgb(1, 0, 0) }, b: { $type: "color", $value: srgb(0, 0, 1) } },
      g: { $type: "gradient", $value: [{ color: "{color.a}", position: 0 }, { color: "{color.b}", position: 1 }] },
      direct: { $type: "gradient", $value: [stop("#ff0000", 0), stop("#0000ff", 1)] },
    });
    const t = await r.tokens();
    expect(t["g"]!.attributes.opal42.status).toBe("scored");
    expect(t["g"]!.attributes.opal42.score).toBe(t["direct"]!.attributes.opal42.score);
    expect(t["g"]!.original[0].color).toBe("{color.a}");
  });

  it("resolves a gradient that references a whole gradient token", async () => {
    const r = await run({
      base: { $type: "gradient", $value: RGB_STOPS },
      alias: { $type: "gradient", $value: "{base}" },
    });
    const t = await r.tokens();
    expect(t["alias"]!.attributes.opal42.score).toBe(t["base"]!.attributes.opal42.score);
    expect(t["alias"]!.value).toEqual(RGB_STOPS);
  });

  it("resolves references chained through colours that other transforms already rewrote", async () => {
    const r = await run({
      color: { a: { $type: "color", $value: "{color.b}" }, b: { $type: "color", $value: srgb(1, 0, 0) } },
      g: { $type: "gradient", $value: [{ color: "{color.a}", position: 0 }, stop("#0000ff", 1)] },
    });
    expect((await r.tokens())["g"]!.attributes.opal42.status).toBe("scored");
  });

  it("scores a legacy CSS-string value (type gradient)", async () => {
    const r = await run({ g: { $type: "gradient", $value: "linear-gradient(90deg, #ff0000 0%, #00ff00 50%, #0000ff 100%)" } });
    const t = (await r.tokens())["g"]!;
    expect(t.attributes.opal42.score).toBe(58);
    expect(t.value).toBe("linear-gradient(90deg, #ff0000 0%, #00ff00 50%, #0000ff 100%)");
  });

  it("scores a CSS-string gradient typed as color (SD leaves those alone)", async () => {
    const r = await run({ g: { $type: "color", $value: "linear-gradient(90deg, #101b45 0%, #9333ea 100%)" } });
    expect((await r.tokens())["g"]!.attributes.opal42.score).toBe(95);
  });

  it("marks a CSS string the parser skips, with its code", async () => {
    const r = await run({ g: { $type: "gradient", $value: "radial-gradient(red, blue)" } });
    expect((await r.tokens())["g"]!.attributes.opal42).toEqual({ score: null, scoringModel: "v1", findings: [], status: "skipped", code: "unsupported-kind", reason: expect.any(String) });
  });

  it("alpha stops are unscorable, not scored", async () => {
    const r = await run({ g: { $type: "gradient", $value: [{ color: srgb(1, 0, 0, 0.5), position: 0 }, stop("#0000ff", 1)] } });
    const a = (await r.tokens())["g"]!.attributes.opal42;
    expect(a).toMatchObject({ score: null, status: "unscorable", code: "alpha" });
  });

  it("repeating and single-stop gradients are unscorable with the core's code", async () => {
    const r = await run({
      rep: { $type: "gradient", $value: "repeating-linear-gradient(90deg, #ff0000 0%, #0000ff 10%)" },
      one: { $type: "gradient", $value: [stop("#ff0000", 0)] },
    });
    const t = await r.tokens();
    expect(t["rep"]!.attributes.opal42).toMatchObject({ status: "unscorable", code: "repeating" });
    expect(t["one"]!.attributes.opal42).toMatchObject({ status: "unscorable", code: "too-few-stops" });
  });

  it("out-of-range positions are unscorable (position-range)", async () => {
    const r = await run({ g: { $type: "gradient", $value: [stop("#ff0000", 0), stop("#0000ff", 1.5)] } });
    expect((await r.tokens())["g"]!.attributes.opal42).toMatchObject({ status: "unscorable", code: "position-range" });
  });

  it("malformed tokens are skipped with a code and the build still succeeds", async () => {
    const r = await run({
      bad1: { $type: "gradient", $value: "not a gradient" },
      bad2: { $type: "gradient", $value: [{ color: "nope", position: 0 }, stop("#0000ff", 1)] },
      bad3: { $type: "gradient", $value: { stops: [] } },
      bad4: { $type: "gradient", $value: [{ color: { colorSpace: "display-p3", components: [1, 0, 0] }, position: 0 }, stop("#0000ff", 1)] },
      good: { $type: "gradient", $value: SMOOTH_STOPS },
    });
    const t = await r.tokens();
    expect(t["bad1"]!.attributes.opal42.code).toBe("no-gradient");
    expect(t["bad2"]!.attributes.opal42.code).toBe("invalid-color");
    expect(t["bad3"]!.attributes.opal42.code).toBe("invalid-shape");
    expect(t["bad4"]!.attributes.opal42.code).toBe("unsupported-color-space");
    expect(t["good"]!.attributes.opal42.status).toBe("scored");
  });

  it("leaves non-gradient tokens untouched (no opal42 attribute, same value)", async () => {
    const r = await run({
      c: { $type: "color", $value: srgb(1, 0, 0) },
      d: { $type: "dimension", $value: { value: 4, unit: "px" } },
      n: { $type: "number", $value: 3 },
      s: { $type: "color", $value: "#00ff00" },
    });
    const t = await r.tokens();
    for (const k of ["c", "d", "n", "s"]) expect(t[k]!.attributes?.opal42).toBeUndefined();
    expect(t["n"]!.value).toBe(3);
    expect(t["d"]!.value).toEqual({ value: 4, unit: "px" });
  });

  it("works with the non-DTCG `value`/`type` syntax", async () => {
    const r = await run({ g: { type: "gradient", value: [{ color: "#ff0000", position: 0 }, { color: "#00ff00", position: 0.5 }, { color: "#0000ff", position: 1 }] } }, { usesDtcg: false });
    expect((await r.tokens())["g"]!.attributes.opal42.score).toBe(58);
  });

  it("inherits $type from a group", async () => {
    const r = await run({ grads: { $type: "gradient", one: { $value: SMOOTH_STOPS } } });
    expect((await r.tokens())["grads.one"]!.attributes.opal42.score).toBe(95);
  });

  it("is not applied when the platform leaves the transform out", async () => {
    const r = await run({ g: { $type: "gradient", $value: SMOOTH_STOPS } }, { transforms: ["name/kebab"] });
    expect((await r.tokens())["g"]!.attributes?.opal42).toBeUndefined();
  });

  it("navy fixture scores as the core scores it", async () => {
    const r = await run({ g: { $type: "gradient", $value: NAVY_STOPS } });
    expect((await r.tokens())["g"]!.attributes.opal42.score).toBe(71);
  });
});
