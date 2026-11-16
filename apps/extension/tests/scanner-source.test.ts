// @vitest-environment jsdom
// The scanner is shipped to the page as TEXT (Function.prototype.toString), so
// these tests check the text, not just the function: it must stand alone.
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { SCANNER_SOURCE, scanExpression, scanPage } from "../src/lib/scanner";
import type { ScanRequest } from "../src/lib/scan-types";
import { setPage } from "./helpers/page";

describe("scanner source text", () => {
  it("is the source of scanPage and starts as a function", () => {
    expect(SCANNER_SOURCE).toBe(scanPage.toString());
    expect(SCANNER_SOURCE).toMatch(/^(async\s+)?function\b/);
    expect(SCANNER_SOURCE).not.toMatch(/^async/);
  });

  it("contains no bundler or module helpers", () => {
    for (const word of ["__name", "__vite", "__publicField", "import(", "import.meta", "require(", "export ", "_ts_", "tslib"]) {
      expect(SCANNER_SOURCE, word).not.toContain(word);
    }
  });

  it("references only page globals: runs in a context that has nothing but document, getComputedStyle and CSS", () => {
    setPage("", `<div style="background-image: linear-gradient(red, blue)">x</div>`);
    // A vm context has the JS built-ins (Array, Date, JSON, …) and exactly what we pass in.
    const context = { document, getComputedStyle: window.getComputedStyle.bind(window), CSS: undefined };
    const result = runInNewContext(scanExpression({ op: "info" }), context) as { op: string; elements: number };
    expect(result.op).toBe("info");
    expect(result.elements).toBeGreaterThan(0);
    const elements = runInNewContext(
      scanExpression({ op: "elements", start: 0, count: 50, budgetMs: 10000, customProps: [], pseudo: true, maxValueLength: 1000, maxHits: 10 }),
      context,
    ) as { op: string; hits: unknown[] };
    expect(elements.op).toBe("elements");
    expect(elements.hits).toHaveLength(1);
  });

  it("does not use eval, Function, network or storage APIs", () => {
    for (const re of [/\beval\s*\(/, /new\s+Function/, /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /localStorage/, /sessionStorage/, /indexedDB/, /document\.cookie/]) {
      expect(SCANNER_SOURCE, String(re)).not.toMatch(re);
    }
  });

  it("does not write to the page (no assignments to DOM properties, no appendChild/setAttribute/insertRule)", () => {
    for (const re of [/appendChild/, /setAttribute/, /insertRule/, /\.innerHTML\s*=/, /\.style\.\w+\s*=/, /addEventListener/, /\bwindow\./]) {
      expect(SCANNER_SOURCE, String(re)).not.toMatch(re);
    }
  });

  it("leaves the DOM exactly as it found it", () => {
    setPage(`<style>.a{background-image:linear-gradient(red,blue)}</style>`, `<div class="a" id="x" style="--c: linear-gradient(red, lime)">x</div>`);
    const before = document.documentElement.outerHTML;
    const requests: ScanRequest[] = [
      { op: "info" },
      { op: "sheet", index: 0, skip: 0, maxRules: 100, budgetMs: 10000, maxValueLength: 500 },
      { op: "elements", start: 0, count: 50, budgetMs: 10000, customProps: ["--c"], pseudo: true, maxValueLength: 500, maxHits: 50 },
    ];
    for (const req of requests) {
      new Function(`return ${scanExpression(req)}`)();
    }
    expect(document.documentElement.outerHTML).toBe(before);
  });

  it("returns an error object instead of throwing", () => {
    const original = Object.getOwnPropertyDescriptor(document, "getElementsByTagName");
    Object.defineProperty(document, "getElementsByTagName", {
      configurable: true,
      value: () => {
        throw new Error("page broke it");
      },
    });
    try {
      const result = new Function(`return ${scanExpression({ op: "info" })}`)() as { op: string; message: string };
      expect(result.op).toBe("error");
      expect(result.message).toContain("page broke it");
    } finally {
      if (original) Object.defineProperty(document, "getElementsByTagName", original);
      else delete (document as unknown as Record<string, unknown>).getElementsByTagName;
    }
  });

  it("returns an error for an unknown op", () => {
    const result = new Function(`return ${scanExpression({ op: "nope" } as never)}`)() as { op: string };
    expect(result.op).toBe("error");
  });

  it("serialises the request as JSON data, so no request field can become code", () => {
    const expr = scanExpression({
      op: "elements",
      start: 0,
      count: 1,
      budgetMs: 1,
      customProps: ['--x"));alert(1);(("'],
      pseudo: false,
      maxValueLength: 10,
      maxHits: 1,
    });
    expect(() => new Function(`return ${expr}`)).not.toThrow();
    expect(expr).toContain(JSON.stringify('--x"));alert(1);(("'));
  });
});
