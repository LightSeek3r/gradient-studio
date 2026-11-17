/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures read untyped JSON */
import { afterEach, describe, expect, it } from "vitest";
import { build, type BuildResult } from "./helpers";
import { NAVY_STOPS, RGB_STOPS, SMOOTH_STOPS, srgb, stop } from "./fixtures";

const WITH_REFINE = ["name/kebab", "color/css", "opal42/gradient-score", "opal42/gradient-refine"];

let last: BuildResult | undefined;
afterEach(async () => {
  await last?.cleanup();
  last = undefined;
});
const run = async (tokens: unknown, extra = {}) => {
  const messages: string[] = [];
  last = await build({ tokens: { "t.json": tokens }, transforms: WITH_REFINE, options: { log: (m) => messages.push(m) }, ...extra });
  return { r: last, messages };
};
const hexes = (v: any[]) => v.map((s) => s.color.hex ?? s.color);

describe("opal42/gradient-refine on real builds", () => {
  it("is opt-in: the ready-made group never changes a value", async () => {
    last = await build({ tokens: { "t.json": { g: { $type: "gradient", $value: RGB_STOPS } } } });
    expect((await last.tokens())["g"]!.value).toEqual(RGB_STOPS);
  });

  it("replaces the value with the core refine output when the score strictly improves", async () => {
    const { r, messages } = await run({ g: { $type: "gradient", $value: RGB_STOPS } });
    const t = (await r.tokens())["g"]!;
    expect(hexes(t.value)).toEqual(["#f500a6", "#ff0000", "#7e00d0"]);
    expect(t.value.map((s: any) => s.position)).toEqual([0, 0.5, 1]);
    // the colours are written as DTCG srgb objects, like the input
    expect(t.value[0].color).toMatchObject({ colorSpace: "srgb", alpha: 1, hex: "#f500a6" });
    expect(t.value[0].color.components).toHaveLength(3);
    // the score attribute describes the value as the score transform saw it (before refine)
    expect(t.attributes.opal42.score).toBe(58);
    expect(messages).toEqual(["opal42 refine: g: score 58 -> 90 (stops changed: 1, 2, 3)"]);
  });

  it("the report shows the built score and the one before refinement", async () => {
    const { r } = await run({ g: { $type: "gradient", $value: RGB_STOPS } });
    const rep = await r.json("report.json");
    expect(rep.tokens[0]).toMatchObject({ path: "g", score: 90, scoreBeforeRefine: 58, status: "scored" });
  });

  it("keeps unchanged stops byte for byte and unknown stop keys", async () => {
    const input = [{ ...stop("#101b45", 0), note: "keep" }, { ...stop("#eeeeee", 0.3), note: "keep" }, { ...stop("#202040", 1), note: "keep" }];
    const { r } = await run({ g: { $type: "gradient", $value: input } });
    const v = (await r.tokens())["g"]!.value;
    expect(hexes(v)).toEqual(["#121c40", "#585858", "#201f45"]);
    expect(v.every((s: any) => s.note === "keep")).toBe(true);
  });

  it("writes hex strings back when the stops were strings", async () => {
    const { r } = await run({ g: { $type: "gradient", $value: [{ color: "#ff0000", position: 0 }, { color: "#00ff00", position: 0.5 }, { color: "#0000ff", position: 1 }] } });
    const v = (await r.tokens())["g"]!.value;
    expect(v).toEqual([{ color: "#f500a6", position: 0 }, { color: "#ff0000", position: 0.5 }, { color: "#7e00d0", position: 1 }]);
  });

  it("rewrites a legacy CSS string as a CSS string", async () => {
    const { r } = await run({ g: { $type: "gradient", $value: "linear-gradient(135deg, #ff0000 0%, #00ff00 50%, #0000ff 100%)" } });
    expect((await r.tokens())["g"]!.value).toBe("linear-gradient(135deg, #f500a6 0%, #ff0000 50%, #7e00d0 100%)");
  });

  it("leaves a token with $extensions.opal42.lock === true untouched", async () => {
    const { r, messages } = await run({ g: { $type: "gradient", $value: RGB_STOPS, $extensions: { opal42: { lock: true } } } });
    const t = (await r.tokens())["g"]!;
    expect(t.value).toEqual(RGB_STOPS);
    expect(messages).toEqual(["opal42 refine: g: left as is (locked)"]);
    expect((await r.json("report.json")).tokens[0]).toMatchObject({ locked: true, score: 58 });
  });

  it("lock must be exactly true", async () => {
    const { r } = await run({ g: { $type: "gradient", $value: RGB_STOPS, $extensions: { opal42: { lock: "true" } } } });
    expect((await r.tokens())["g"]!.value).not.toEqual(RGB_STOPS);
  });

  it("never touches alpha, hard-stop, repeating, malformed or non-gradient tokens", async () => {
    const hard = [stop("#ff0000", 0), stop("#ff0000", 0.5), stop("#0000ff", 0.5), stop("#0000ff", 1)];
    const alpha = [{ color: srgb(1, 0, 0, 0.5), position: 0 }, stop("#00ff00", 0.5), stop("#0000ff", 1)];
    const bad = [{ color: "nope", position: 0 }, stop("#0000ff", 1)];
    const rep = "repeating-linear-gradient(90deg, #ff0000 0%, #0000ff 10%)";
    const { r, messages } = await run({ hard: { $type: "gradient", $value: hard }, alpha: { $type: "gradient", $value: alpha }, bad: { $type: "gradient", $value: bad }, rep: { $type: "gradient", $value: rep }, c: { $type: "color", $value: srgb(1, 0, 0) } });
    const t = await r.tokens();
    expect(t["hard"]!.value).toEqual(hard);
    expect(t["alpha"]!.value).toEqual(alpha);
    expect(t["bad"]!.value).toEqual(bad);
    expect(t["rep"]!.value).toBe(rep);
    expect(t["c"]!.value).toBe("#ff0000");
    expect(messages.sort()).toEqual([
      "opal42 refine: alpha: left as is (alpha)",
      "opal42 refine: bad: left as is (invalid-color)",
      "opal42 refine: hard: left as is (hard-stops)",
      "opal42 refine: rep: left as is (repeating)",
    ]);
  });

  it("does not refine when no strict improvement exists", async () => {
    // a gradient already at 100 cannot improve
    const { r, messages } = await run({ g: { $type: "gradient", $value: [stop("#ff006c", 0), stop("#5c00e7", 1)] } });
    expect((await r.tokens())["g"]!.value).toEqual([stop("#ff006c", 0), stop("#5c00e7", 1)]);
    expect(messages).toEqual(["opal42 refine: g: left as is (no-improvement)"]);
  });

  it("refines a gradient whose stops are {references}, after Style Dictionary resolved them", async () => {
    const { r } = await run({
      color: { a: { $type: "color", $value: srgb(1, 0, 0) }, b: { $type: "color", $value: srgb(0, 1, 0) }, c: { $type: "color", $value: srgb(0, 0, 1) } },
      g: { $type: "gradient", $value: [{ color: "{color.a}", position: 0 }, { color: "{color.b}", position: 0.5 }, { color: "{color.c}", position: 1 }] },
    });
    const t = (await r.tokens())["g"]!;
    expect(hexes(t.value)).toEqual(["#f500a6", "#ff0000", "#7e00d0"]);
    // the original still shows the references
    expect(t.original[0].color).toBe("{color.a}");
  });

  it("refines a token that references a whole gradient token", async () => {
    const { r } = await run({ base: { $type: "gradient", $value: RGB_STOPS }, alias: { $type: "gradient", $value: "{base}" } });
    const t = await r.tokens();
    expect(hexes(t["alias"]!.value)).toEqual(["#f500a6", "#ff0000", "#7e00d0"]);
  });

  it("the refined output scores at least as high as the input (never lower)", async () => {
    const { r } = await run({ a: { $type: "gradient", $value: RGB_STOPS }, b: { $type: "gradient", $value: NAVY_STOPS }, c: { $type: "gradient", $value: SMOOTH_STOPS } });
    const rep = await r.json("report.json");
    for (const t of rep.tokens) expect(t.score).toBeGreaterThanOrEqual(t.scoreBeforeRefine ?? t.score);
  });

  it("without the score transform before it, refine still works", async () => {
    const { r } = await run({ g: { $type: "gradient", $value: RGB_STOPS } }, { transforms: ["name/kebab", "opal42/gradient-refine"] });
    expect(hexes((await r.tokens())["g"]!.value)).toEqual(["#f500a6", "#ff0000", "#7e00d0"]);
  });

  it("the css format prints the refined gradient", async () => {
    const { r } = await run({ g: { $type: "gradient", $value: RGB_STOPS } });
    expect(await r.read("gradients.css")).toContain("--g: linear-gradient(90deg, #f500a6 0%, #ff0000 50%, #7e00d0 100%);");
  });
});
