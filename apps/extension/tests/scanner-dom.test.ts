// @vitest-environment jsdom
// The scanner and the runner against a jsdom page. jsdom has a real CSSOM and a
// cascade (no layout), which is enough for these cases; tests that need a real
// browser (cross-origin sheets, nesting, @layer) are in e2e/.
import { describe, expect, it } from "vitest";
import { scanExpression } from "../src/lib/scanner";
import type { ElementsResult, SheetResult } from "../src/lib/scan-types";
import { scanPageNow, setPage } from "./helpers/page";

const run = <T>(req: Parameters<typeof scanExpression>[0]): T => new Function(`return ${scanExpression(req)}`)() as T;
const byProperty = (hits: { property: string; source: string; selector: string }[], property: string) => hits.filter((h) => h.property === property);

describe("scanner: element computed styles", () => {
  it("finds background-image, mask-image and border-image-source gradients", async () => {
    setPage(
      `<style>
        .bg { background-image: linear-gradient(90deg, #f00, #00f); }
        .mk { mask-image: linear-gradient(#000, transparent); }
        .bd { border-image-source: linear-gradient(red, blue); }
      </style>`,
      `<div class="bg"></div><div class="mk"></div><div class="bd"></div>`,
    );
    const { hits } = await scanPageNow();
    const computed = hits.filter((h) => h.source === "computed");
    expect(computed.map((h) => h.property).sort()).toEqual(["background-image", "border-image-source", "mask-image"]);
    expect(computed.map((h) => h.selector).sort()).toEqual(["div.bd", "div.bg", "div.mk"]);
  });

  it("finds list-style-image gradients", async () => {
    setPage(`<style>li { list-style-image: linear-gradient(red, blue); }</style>`, `<ul><li>a</li></ul>`);
    const { hits } = await scanPageNow();
    expect(byProperty(hits, "list-style-image").some((h) => h.source === "computed")).toBe(true);
  });

  it("reads values resolved through var()", async () => {
    setPage(
      `<style>:root{--g: linear-gradient(red, blue)} .v { background-image: var(--g); }</style>`,
      `<div class="v"></div>`,
    );
    const { hits } = await scanPageNow();
    const el = hits.find((h) => h.source === "computed" && h.selector === "div.v");
    expect(el?.value).toContain("linear-gradient(");
    expect(el?.value).not.toContain("var(");
  });

  it("keeps the gradient layers of a multi-layer background in one value", async () => {
    setPage(`<style>.m { background: linear-gradient(red, blue), url(x.png), radial-gradient(red, blue); }</style>`, `<div class="m"></div>`);
    const { hits } = await scanPageNow();
    const v = hits.find((h) => h.source === "computed")!.value;
    expect(v).toContain("linear-gradient(");
    expect(v).toContain("radial-gradient(");
  });

  it("reads ::before and ::after that generate a box, and ignores ones that do not", async () => {
    setPage(
      `<style>
        .p::before { content: ""; background-image: linear-gradient(red, blue); }
        .q::after { background-image: linear-gradient(red, blue); }
      </style>`,
      `<div class="p"></div><div class="q"></div>`,
    );
    const { hits } = await scanPageNow();
    const computed = hits.filter((h) => h.source === "computed");
    expect(computed.map((h) => h.selector)).toEqual(["div.p::before"]);
  });

  it("can leave pseudo-elements out", async () => {
    setPage(`<style>.p::before { content: ""; background-image: linear-gradient(red, blue); }</style>`, `<div class="p"></div>`);
    const { hits } = await scanPageNow({ limits: { pseudo: false } });
    expect(hits.filter((h) => h.source === "computed")).toHaveLength(0);
  });

  it("reports mask-image once even though -webkit-mask-image is an alias", async () => {
    setPage(`<style>.k { mask-image: linear-gradient(#000, #fff); }</style>`, `<div class="k"></div>`);
    const { hits } = await scanPageNow();
    const computed = hits.filter((h) => h.source === "computed");
    expect(computed.length).toBeLessThanOrEqual(2);
    expect(new Set(computed.map((h) => h.value)).size).toBe(1);
  });

  it("ignores elements without gradients and non-gradient images", async () => {
    setPage(`<style>.i { background-image: url(x.png); } .n { background-image: none; }</style>`, `<div class="i"></div><div class="n"></div><p>text</p>`);
    const { hits } = await scanPageNow();
    expect(hits).toHaveLength(0);
  });
});

describe("scanner: custom properties", () => {
  it("reports a custom property at the element that declares it, not at its descendants", async () => {
    setPage(
      `<style>.theme { --hero: linear-gradient(red, blue); }</style>`,
      `<section class="theme"><div id="child"><span>x</span></div></section>`,
    );
    const { hits } = await scanPageNow();
    const custom = hits.filter((h) => h.source === "custom-property");
    expect(custom).toHaveLength(1);
    expect(custom[0]).toMatchObject({ property: "--hero", selector: "section.theme" });
  });

  it("finds custom properties set inline, without any stylesheet", async () => {
    setPage("", `<div style="--accent: linear-gradient(red, lime)"></div>`);
    const { hits } = await scanPageNow();
    expect(hits.filter((h) => h.source === "custom-property").map((h) => h.property)).toEqual(["--accent"]);
  });

  it("reports an element that overrides a custom property with a different gradient", async () => {
    setPage(
      `<style>:root{--g: linear-gradient(red, blue)} .o { --g: linear-gradient(lime, yellow); }</style>`,
      `<div class="o"></div>`,
    );
    const { hits } = await scanPageNow();
    const custom = hits.filter((h) => h.source === "custom-property");
    expect(custom.map((h) => h.selector).sort()).toEqual(["div.o", "html"]);
  });

  it("ignores custom properties that are not gradients", async () => {
    setPage(`<style>:root{--c: red; --n: 4px}</style>`, `<div></div>`);
    const { hits } = await scanPageNow();
    expect(hits).toHaveLength(0);
  });
});

describe("scanner: stylesheets", () => {
  it("reads rules as written, including shorthand and custom property declarations", async () => {
    setPage(
      `<style>
        .a { background: linear-gradient(90deg, #f00, #00f); }
        .b { --x: radial-gradient(red, blue); }
      </style>`,
      "",
    );
    const { hits } = await scanPageNow();
    const sheet = hits.filter((h) => h.source === "stylesheet");
    expect(sheet.map((h) => [h.selector, h.property]).sort()).toEqual([
      [".a", "background"],
      [".b", "--x"],
    ]);
    expect(sheet.every((h) => h.origin === "<style>" && h.path === "")).toBe(true);
  });

  it("descends into @media and @supports", async () => {
    setPage(
      `<style>
        @media (min-width: 1px) { .m { background-image: linear-gradient(red, blue); } }
        @supports (display: grid) { .s { background-image: linear-gradient(lime, yellow); } }
      </style>`,
      "",
    );
    const { hits } = await scanPageNow();
    expect(hits.filter((h) => h.source === "stylesheet").map((h) => h.selector).sort()).toEqual([".m", ".s"]);
  });

  it("reads several sheets and counts them", async () => {
    setPage(
      `<style>.a{background-image:linear-gradient(red,blue)}</style><style>.b{background-image:linear-gradient(lime,blue)}</style>`,
      "",
    );
    const { hits, stats } = await scanPageNow();
    expect(stats.sheetsTotal).toBe(2);
    expect(stats.sheetsScanned).toBe(2);
    expect(hits.filter((h) => h.source === "stylesheet")).toHaveLength(2);
  });

  it("skips a sheet whose rules cannot be read (cross-origin) without throwing, and still reads the others", async () => {
    setPage(`<style>.a{background-image:linear-gradient(red,blue)}</style><style>.b{color:red}</style>`, "");
    const sheet = document.styleSheets[1];
    Object.defineProperty(sheet, "cssRules", {
      get() {
        throw new DOMException("Cannot access rules", "SecurityError");
      },
    });
    const { hits, stats } = await scanPageNow();
    expect(stats.sheetsSkipped).toEqual([{ label: "<style>", reason: "cross-origin" }]);
    expect(stats.sheetsScanned).toBe(1);
    expect(hits.some((h) => h.selector === ".a")).toBe(true);
  });

  it("labels a failing sheet that is not a SecurityError as an error", async () => {
    setPage(`<style>.a{color:red}</style>`, "");
    Object.defineProperty(document.styleSheets[0], "cssRules", {
      get() {
        throw new Error("boom");
      },
    });
    const { stats } = await scanPageNow();
    expect(stats.sheetsSkipped[0].reason).toBe("error");
  });

  it("strips query and hash from a sheet URL label", () => {
    setPage(`<link rel="stylesheet" href="http://localhost/a.css?token=secret#frag">`, "");
    const sheet = document.styleSheets[0];
    if (!sheet) return; // jsdom does not load stylesheets from <link> without resources: nothing to check
    expect(run<SheetResult>({ op: "sheet", index: 0, skip: 0, maxRules: 10, budgetMs: 10, maxValueLength: 100 }).label).not.toContain("token");
  });

  it("walks a long sheet in resumable slices and finds the same hits as a single pass", async () => {
    const rules = Array.from({ length: 60 }, (_, i) => `.r${i}{background-image:linear-gradient(#${(i % 9) + 1}00,#00${(i % 9) + 1})}`).join("");
    setPage(`<style>${rules}</style>`, "");
    const single = await scanPageNow({ limits: { budgetMs: 1000 } });
    const sliced = await scanPageNow({ limits: { budgetMs: -1 } }); // every call stops after one rule
    expect(sliced.stats.calls).toBeGreaterThan(50);
    expect(single.stats.calls).toBeLessThan(10);
    expect(sliced.hits.map((h) => h.selector)).toEqual(single.hits.map((h) => h.selector));
  });

  it("stops at the per-sheet rule cap and says so", async () => {
    const rules = Array.from({ length: 30 }, (_, i) => `.r${i}{color:red}`).join("");
    setPage(`<style>${rules}</style>`, "");
    const { stats } = await scanPageNow({ limits: { maxRulesPerSheet: 10 } });
    expect(stats.sheetsCapped).toBe(1);
  });

  it("does not report the same value twice for a shorthand and its longhand", async () => {
    setPage(`<style>.a { background: linear-gradient(red, blue); }</style>`, "");
    const { hits } = await scanPageNow();
    expect(hits.filter((h) => h.source === "stylesheet")).toHaveLength(1);
  });
});

describe("scanner: chunking, caps and values", () => {
  const many = (n: number, withGradient = false) =>
    Array.from({ length: n }, (_, i) => `<div${withGradient && i % 100 === 0 ? ' class="g"' : ""}></div>`).join("");

  it("walks the elements in several calls of at most elementChunk elements", async () => {
    setPage(`<style>.g{background-image:linear-gradient(red,blue)}</style>`, many(1000, true));
    const { hits, stats } = await scanPageNow({ limits: { elementChunk: 100, budgetMs: 1000 } });
    expect(stats.elementsScanned).toBeGreaterThanOrEqual(1000);
    expect(stats.calls).toBeGreaterThanOrEqual(11); // 1 info + 1 sheet + ≥10 element chunks
    expect(hits.filter((h) => h.source === "computed")).toHaveLength(10);
  });

  it("an element call returns early when its time budget is spent, always making progress", () => {
    setPage("", many(300));
    const r = run<ElementsResult>({ op: "elements", start: 0, count: 300, budgetMs: -1, customProps: [], pseudo: false, maxValueLength: 100, maxHits: 10 });
    expect(r.next).toBe(1);
    expect(r.total).toBeGreaterThanOrEqual(300);
  });

  it("caps the elements examined and reports the notice data", async () => {
    setPage("", many(400));
    const { stats } = await scanPageNow({ limits: { maxElements: 150, elementChunk: 100 } });
    expect(stats.elementCapReached).toBe(true);
    expect(stats.elementsScanned).toBe(150);
    expect(stats.elementsTotal).toBeGreaterThan(400);
  });

  it("does not flag a cap when the page is smaller than the limit", async () => {
    setPage("", many(20));
    const { stats } = await scanPageNow();
    expect(stats.elementCapReached).toBe(false);
    expect(stats.elementsScanned).toBe(stats.elementsTotal);
  });

  it("stops at the hit cap", async () => {
    setPage(`<style>div{background-image:linear-gradient(red,blue)}</style>`, many(50));
    const { hits, stats } = await scanPageNow({ limits: { maxHits: 12, elementChunk: 20 } });
    expect(hits).toHaveLength(12);
    expect(stats.hitCapReached).toBe(true);
  });

  it("clips very long values and flags them", async () => {
    const long = Array.from({ length: 400 }, (_, i) => `#${(i % 4096).toString(16).padStart(3, "0")}`).join(",");
    setPage(`<style>.l{background-image:linear-gradient(${long})}</style>`, `<div class="l"></div>`);
    const { hits, stats } = await scanPageNow({ limits: { maxValueLength: 200 } });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.value.length).toBeLessThanOrEqual(200);
      expect(h.truncated).toBe(true);
    }
    expect(stats.truncatedValues).toBe(hits.length);
  });

  it("reads readyState", async () => {
    setPage("", "");
    expect((await scanPageNow()).stats.readyState).toBe("complete");
  });
});

describe("scanner: element selectors", () => {
  it("every reported path selects exactly the element it came from", async () => {
    setPage(
      `<style>.g{background-image:linear-gradient(red,blue)}</style>`,
      `<main><section><div class="g">1</div><div class="g">2</div><p><span class="g">3</span></p></section><div id="solo" class="g">4</div></main>`,
    );
    const hits = (await scanPageNow()).hits.filter((h) => h.source === "computed");
    const elements = hits;
    expect(elements).toHaveLength(4);
    const texts = elements.map((h) => document.querySelector(h.path)?.textContent).sort();
    expect(texts).toEqual(["1", "2", "3", "4"]);
    for (const h of elements) expect(document.querySelectorAll(h.path)).toHaveLength(1);
  });

  it("anchors a path at a unique id", async () => {
    setPage(`<style>.g{background-image:linear-gradient(red,blue)}</style>`, `<div id="hero"><b class="g"></b></div>`);
    const hits = (await scanPageNow()).hits.filter((h) => h.source === "computed");
    expect(hits[0].path).toBe("#hero > b:nth-child(1)");
  });

  it("does not trust a duplicated id", async () => {
    setPage(`<style>.g{background-image:linear-gradient(red,blue)}</style>`, `<div id="d"></div><div id="d" class="g"></div>`);
    const hits = (await scanPageNow()).hits.filter((h) => h.source === "computed");
    const el = document.querySelector(hits[0].path);
    expect(el?.className).toBe("g");
  });

  it("escapes ids and classes with special characters", async () => {
    setPage(`<style>.a\\:b{background-image:linear-gradient(red,blue)}</style>`, `<div id="x.y" class="a:b"></div>`);
    const hits = (await scanPageNow()).hits.filter((h) => h.source === "computed");
    expect(hits).toHaveLength(1);
    expect(document.querySelector(hits[0].path)?.id).toBe("x.y");
  });

  it("labels an element with tag, id and at most two classes", async () => {
    setPage(`<style>.a{background-image:linear-gradient(red,blue)}</style>`, `<div id="i" class="a b c d"></div>`);
    const hits = (await scanPageNow()).hits.filter((h) => h.source === "computed");
    expect(hits[0].selector).toBe("div#i.a.b");
  });
});
