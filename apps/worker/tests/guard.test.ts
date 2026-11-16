import { describe, expect, it } from "vitest";
import { estimateCssStops, estimateStops, overBudget, parseBudget } from "../src/guard";
import { MAX_STOPS_PER_REQUEST } from "../src/limits";
import { RGB_CSS, callTool } from "./helpers";

const grad = (n: number) => `linear-gradient(90deg, ${Array.from({ length: n }, (_, i) => `#${(i * 3).toString(16).padStart(2, "0")}00ff ${i}%`).join(", ")})`;

describe("stop estimate", () => {
  it("counts the stops of a gradient with and without an angle", () => {
    expect(estimateCssStops("linear-gradient(red, blue)")).toBe(2);
    expect(estimateCssStops("linear-gradient(90deg, red, lime, blue)")).toBe(3);
    expect(estimateCssStops("linear-gradient(to right, red, blue)")).toBe(2);
    expect(estimateCssStops("linear-gradient(in oklch 0.25turn, red, blue)")).toBe(2);
    expect(estimateCssStops("linear-gradient(-45.5deg, red, blue)")).toBe(2);
    expect(estimateCssStops("linear-gradient( 1.5rad,red,blue)")).toBe(2);
  });
  it("ignores commas inside nested functions", () => {
    expect(estimateCssStops("linear-gradient(rgb(1, 2, 3), hsl(1, 2%, 3%))")).toBe(2);
  });
  it("sums several gradients and ignores other css", () => {
    expect(estimateCssStops(`a{color:rgb(1,2,3)} ${grad(5)} b{background:${grad(4)}}`)).toBe(5 + 4);
  });
  it("is robust to unbalanced input", () => {
    for (const s of [")))", "(((", "gradient(,,,,", "linear-gradient(".repeat(1000)]) expect(estimateCssStops(s)).toBeGreaterThanOrEqual(0);
  });
  it("counts structured stops and tolerates junk", () => {
    expect(estimateStops({ stops: [1, 2, 3] })).toBe(3);
    for (const v of [null, undefined, 5, "x", []]) expect(estimateStops(v)).toBe(0);
  });
  it("handles a 32 KB hostile input in linear time", () => {
    const t = performance.now();
    estimateCssStops(("linear-gradient(" + "(".repeat(50) + ",").repeat(500));
    expect(performance.now() - t).toBeLessThan(50);
  });
});

describe("budget parsing", () => {
  it("defaults to 16", () => expect(parseBudget(undefined).refineMaxStops).toBe(16));
  it.each([["3", 3], ["0", 0], [" 8 ", 8]])("reads %j", (v, n) => expect(parseBudget(v).refineMaxStops).toBe(n));
  it.each(["", "-1", "1e3", "abc", "99999", "3.5"])("ignores %j", (v) => expect(parseBudget(v).refineMaxStops).toBe(16));
  it("ignores non-strings", () => expect(parseBudget(5).refineMaxStops).toBe(16));
});

describe("CPU guard on tools/call", () => {
  it("refuses a score_gradient request over the per-request stop cap", async () => {
    const css = Array.from({ length: MAX_STOPS_PER_REQUEST / 32 + 1 }, () => grad(32)).join("\n");
    const { res, body } = await callTool("score_gradient", { css });
    expect(res.status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain(`at most ${MAX_STOPS_PER_REQUEST} stops`);
  });

  it("accepts exactly the cap's worth of stops", async () => {
    const css = Array.from({ length: MAX_STOPS_PER_REQUEST / 32 }, () => grad(32)).join("\n"); // exactly the cap
    const { body } = await callTool("score_gradient", { css });
    expect(body.result.isError).toBeUndefined();
  });

  it("refuses render_preview over the cap", async () => {
    const css = Array.from({ length: MAX_STOPS_PER_REQUEST / 32 + 1 }, () => grad(32)).join("\n");
    const { body } = await callTool("render_preview", { css });
    expect(body.result.isError).toBe(true);
  });

  it("refuses refine_gradient over the configured cap", async () => {
    const { body } = await callTool("refine_gradient", { css: grad(20) });
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("at most 16 stops");
  });

  it("honours REFINE_MAX_STOPS", async () => {
    const ok = await callTool("refine_gradient", { css: RGB_CSS }, { REFINE_MAX_STOPS: "4" });
    expect(ok.body.result.isError).toBeUndefined();
    const no = await callTool("refine_gradient", { css: grad(5) }, { REFINE_MAX_STOPS: "4" });
    expect(no.body.result.isError).toBe(true);
    expect(no.body.result.content[0].text).toContain("at most 4 stops");
  });

  it("REFINE_MAX_STOPS=0 disables refine_gradient but not scoring", async () => {
    const off = await callTool("refine_gradient", { css: RGB_CSS }, { REFINE_MAX_STOPS: "0" });
    expect(off.body.result.isError).toBe(true);
    expect(off.body.result.content[0].text).toContain("disabled on this deployment");
    const on = await callTool("score_gradient", { css: RGB_CSS }, { REFINE_MAX_STOPS: "0" });
    expect(on.body.result.isError).toBeUndefined();
  });

  it("applies to structured stops too", async () => {
    const stops = Array.from({ length: 20 }, (_, i) => ({ color: `#${(i * 9).toString(16).padStart(2, "0")}00ff` }));
    const { body } = await callTool("refine_gradient", { stops });
    expect(body.result.isError).toBe(true);
  });

  it("never touches complement", () => expect(overBudget("complement", { color: "red" }, { refineMaxStops: 0 })).toBeNull());

  it("the refusal does not echo the request", async () => {
    const css = `/* <script>ZQX</script> */ ${grad(300)}`;
    const { body } = await callTool("score_gradient", { css });
    expect(JSON.stringify(body)).not.toContain("<script");
    expect(JSON.stringify(body)).not.toContain("ZQX");
  });
});
