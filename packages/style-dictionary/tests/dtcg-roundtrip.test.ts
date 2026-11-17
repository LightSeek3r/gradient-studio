import { afterEach, describe, expect, it } from "vitest";
import { resolveStops, score, toCSS, type GradientDocument } from "@opal42/gradient";
import { toDtcg } from "@opal42/gradient/export";
import { build, type BuildResult } from "./helpers";

let last: BuildResult | undefined;
afterEach(async () => {
  await last?.cleanup();
  last = undefined;
});

const DOCS: [string, GradientDocument][] = [
  ["two stops", { kind: "linear", angle: 135, stops: [{ color: "#101b45", position: 0 }, { color: "#9333ea", position: 1 }] }],
  ["three stops", { kind: "linear", angle: 90, stops: [{ color: "#ff0000", position: 0 }, { color: "#00ff00", position: 0.5 }, { color: "#0000ff", position: 1 }] }],
  ["auto positions", { kind: "linear", angle: 45, stops: [{ color: "#101b45" }, { color: "#eeeeee" }, { color: "#202040" }] }],
  ["oklch interpolation", { kind: "linear", angle: 200, stops: [{ color: "#101b45", position: 0 }, { color: "#9333ea", position: 1 }], interpolation: { space: "oklch", hue: "longer" } }],
];

describe("toDtcg output through a real Style Dictionary build", () => {
  for (const colorFormat of ["object", "hex"] as const) {
    it.each(DOCS)(`${colorFormat} colours: %s`, async (_n, doc) => {
      const out = toDtcg(doc, { name: "g", bake: 0, colorFormat });
      if (out.status !== "ok") throw new Error("toDtcg failed");
      last = await build({ tokens: { "g.json": JSON.parse(out.text) } });
      const t = (await last.tokens())["g"]!;
      // SD kept the value, the score is the core's, the CSS is the core's
      expect(t.attributes.opal42.score).toBe((score(doc) as { score: number }).score);
      const css = await last.read("gradients.css");
      // toDtcg writes resolved positions, so compare with the document whose automatic positions are laid out
      const resolved = { ...doc, stops: resolveStops(doc).map((s) => ({ color: s.color, position: s.position })) };
      expect(css).toContain(`--g: ${toCSS(resolved)};`);
    });
  }

  it("the vendor extension carries the angle, a token without it uses the angle option", async () => {
    const doc = DOCS[0]![1];
    const out = toDtcg(doc, { name: "g", bake: 0 });
    if (out.status !== "ok") throw new Error("toDtcg failed");
    const token = JSON.parse(out.text);
    delete token.g.$extensions;
    last = await build({ tokens: { "g.json": token }, options: { angle: 135 } });
    expect(await last.read("gradients.css")).toContain("linear-gradient(135deg,");
  });
});
