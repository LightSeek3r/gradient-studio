// The scanner and the analysis against a REAL page in real Chromium: real
// computed styles, real CSSOM (cross-origin sheets, @layer, nesting, adopted
// sheets), real CSS.escape, real timing. Page access is page.evaluate with the
// exact expression text the panel sends through inspectedWindow.eval.
import { expect, test, type Page } from "@playwright/test";
import { analyzeGroup, groupHits, type Entry } from "../src/lib/analyze";
import { runScan, type EvalFn } from "../src/lib/scan-runner";
import { scanExpression } from "../src/lib/scanner";
import { startFixture, type Fixture } from "./support/server";

let fixture: Fixture;
test.beforeAll(async () => {
  fixture = await startFixture();
});
test.afterAll(async () => {
  await fixture.close();
});

const evalOn =
  (page: Page): EvalFn =>
  (expression) =>
    page.evaluate(expression);

async function scan(page: Page, path = "/", limits = {}) {
  await page.goto(fixture.origin + path);
  const outcome = await runScan(evalOn(page), { limits });
  const { groups, droppedGroups } = groupHits(outcome.hits);
  const entries: Entry[] = groups.map(analyzeGroup);
  return { ...outcome, groups, entries, droppedGroups };
}

const selectors = (entries: Entry[]) => entries.flatMap((e) => e.usages.map((u) => u.selector));

test.describe("scanner in a real page", () => {
  test("finds gradients in every tracked property, custom property and sheet kind", async ({ page }) => {
    const { hits, entries, stats } = await scan(page);
    const computed = hits.filter((h) => h.source === "computed");
    const props = new Set(computed.map((h) => h.property));
    expect(props).toContain("background-image");
    expect(props).toContain("mask-image");
    expect(props).toContain("border-image-source");
    expect(props).toContain("list-style-image");

    const all = selectors(entries).join(" | ");
    for (const wanted of ["div#hero.hero", "div#rough.rough", "div.glow", "div.cone", "div.xo", "div.inline", "div#inline-attr", "div.adopted", "div.layered", "div.media", "div.inner", "div.pseudo::after", "li.mark"]) {
      expect(all, wanted).toContain(wanted);
    }
    expect(stats.elementCapReached).toBe(false);
  });

  test("resolves var() through computed style: the hero's gradient is parsed, and the custom property is reported where it is declared", async ({ page }) => {
    const { hits } = await scan(page);
    const hero = hits.find((h) => h.source === "computed" && h.selector === "div#hero.hero")!;
    expect(hero.value).toContain("linear-gradient(");
    expect(hero.value).not.toContain("var(");
    const custom = hits.filter((h) => h.source === "custom-property");
    expect(custom.map((h) => `${h.property}@${h.selector}`)).toEqual(expect.arrayContaining(["--brand@html", "--accent@div.custom"]));
    // Declared once at <html>, not repeated on every descendant that inherits it.
    expect(custom.filter((h) => h.property === "--brand")).toHaveLength(1);
  });

  test("skips the cross-origin sheet without throwing, and still sees its gradient through the element", async ({ page }) => {
    const { stats, entries } = await scan(page);
    expect(stats.sheetsSkipped).toHaveLength(1);
    expect(stats.sheetsSkipped[0]).toMatchObject({ reason: "cross-origin" });
    expect(stats.sheetsSkipped[0].label).toContain("localhost");
    expect(stats.sheetsSkipped[0].label).not.toContain("?");
    const xo = entries.find((e) => e.usages.some((u) => u.selector === "div.xo"))!;
    expect(xo.status).toBe("scored");
    expect(xo.usages.every((u) => u.source !== "stylesheet")).toBe(true); // rule unreadable, element readable
  });

  test("reads rules inside @layer, @media, CSS nesting, @keyframes and an adopted stylesheet", async ({ page }) => {
    const { hits } = await scan(page);
    const rules = hits.filter((h) => h.source === "stylesheet").map((h) => h.selector);
    expect(rules).toEqual(expect.arrayContaining([".layered", ".media", ".card .inner", ".adopted"]));
    expect(rules.some((s) => s.startsWith("@keyframes pulse"))).toBe(true);
  });

  test("merges the rule, the computed value and the element into one gradient with several usages", async ({ page }) => {
    const { entries } = await scan(page);
    const rough = entries.find((e) => e.usages.some((u) => u.selector === "div#rough.rough"))!;
    expect(rough.usages.map((u) => u.source).sort()).toEqual(["computed", "stylesheet"]);
    const smooth = entries.find((e) => e.status === "scored" && e.usages.some((u) => u.selector.includes("smooth-a")))!;
    expect(smooth.usages.filter((u) => u.source === "computed").map((u) => u.selector).sort()).toEqual(["div.smooth.smooth-a", "div.smooth.smooth-b"]);
  });

  test("scores what is scorable and says why the rest is not", async ({ page }) => {
    const { entries } = await scan(page);
    const byCode = (code: string) => entries.filter((e) => e.status === "not-scored" && e.code === code);
    expect(byCode("alpha").length).toBeGreaterThan(0); // .fade
    expect(byCode("unsupported-kind").length).toBeGreaterThanOrEqual(2); // radial + conic
    expect(byCode("repeating").length).toBeGreaterThan(0); // .stripes
    expect(entries.filter((e) => e.status === "scored").length).toBeGreaterThan(5);
    const rough = entries.find((e) => e.status === "scored" && e.usages.some((u) => u.selector === "div#rough.rough"))!;
    expect(rough.status === "scored" && rough.issues.length).toBeGreaterThan(0);
  });

  test("every reported element path selects exactly one element in the real DOM", async ({ page }) => {
    const { hits } = await scan(page);
    const paths = [...new Set(hits.filter((h) => h.path).map((h) => h.path))];
    expect(paths.length).toBeGreaterThan(10);
    for (const path of paths) {
      const count = await page.evaluate((p) => document.querySelectorAll(p).length, path);
      expect(count, path).toBe(1);
    }
  });

  test("leaves the page untouched", async ({ page }) => {
    await page.goto(fixture.origin + "/");
    const before = await page.evaluate(() => document.documentElement.outerHTML);
    await runScan(evalOn(page));
    expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(before);
  });

  test("a page without gradients scans cleanly", async ({ page }) => {
    const { hits, stats } = await scan(page, "/empty");
    expect(hits).toEqual([]);
    expect(stats.elementCapReached).toBe(false);
  });

  test("large page: caps the elements, reports it, and every in-page call stays short", async ({ page }) => {
    await page.goto(fixture.origin + "/big?n=20000");
    const timings: number[] = [];
    const timed: EvalFn = async (expression) => {
      const { result, ms } = await page.evaluate(`(function(){ var t = performance.now(); var r = ${expression}; return { result: r, ms: performance.now() - t }; })()`) as { result: unknown; ms: number };
      timings.push(ms);
      return result;
    };
    const { stats, hits } = await runScan(timed);
    expect(stats.elementsTotal).toBeGreaterThan(20000);
    expect(stats.elementCapReached).toBe(true);
    expect(stats.elementsScanned).toBe(5000);
    expect(stats.calls).toBeGreaterThan(20);
    // 5000 elements, every 40th has a gradient: 125 computed hits (+ rules).
    expect(hits.filter((h) => h.source === "computed").length).toBe(125);
    // No call holds the page's main thread long (budget is 12 ms per call plus one element).
    console.log(`large page: ${stats.calls} calls, slowest ${Math.max(...timings).toFixed(1)} ms, median ${[...timings].sort((a, b) => a - b)[Math.floor(timings.length / 2)].toFixed(1)} ms`);
    expect(Math.max(...timings)).toBeLessThan(100);
  });

  test("a raised cap scans the whole page", async ({ page }) => {
    const { stats } = await scan(page, "/big?n=3000", { maxElements: 100000 });
    expect(stats.elementCapReached).toBe(false);
    expect(stats.elementsScanned).toBe(stats.elementsTotal);
  });

  test("the scanner returns an error object instead of throwing when the page breaks a built-in", async ({ page }) => {
    await page.goto(fixture.origin + "/empty");
    await page.evaluate(() => {
      Object.defineProperty(document, "getElementsByTagName", { value: () => { throw new Error("hostile page"); } });
    });
    const result = (await page.evaluate(scanExpression({ op: "info" }))) as { op: string; message: string };
    expect(result.op).toBe("error");
    expect(result.message).toContain("hostile page");
    await expect(runScan(evalOn(page))).rejects.toMatchObject({ code: "page-error" });
  });

  test("a hostile page that returns garbage from built-ins cannot make the panel use it", async ({ page }) => {
    await page.goto(fixture.origin + "/empty");
    await page.evaluate(() => {
      const real = Document.prototype.getElementsByTagName;
      Document.prototype.getElementsByTagName = function (name: string) {
        const all = real.call(this, name);
        return new Proxy(all, { get: (t, k) => (k === "length" ? 1e12 : Reflect.get(t, k)) });
      };
    });
    // 1e12 elements is out of the accepted range: rejected as unreadable, never trusted.
    await expect(runScan(evalOn(page))).rejects.toMatchObject({ code: "bad-result" });
  });
});
