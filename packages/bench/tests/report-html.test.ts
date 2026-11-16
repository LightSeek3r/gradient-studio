// @vitest-environment jsdom
// jsdom has no layout or CSS cascade: colour contrast is NOT covered by axe here
// (the palette was chosen for >= 4.5:1 in both themes and is documented in
// docs/bench.md); structure, names, landmarks, table semantics and SVG names are.
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { DEFAULT_BRIEF_SET } from "../src/briefs";
import { renderHtml } from "../src/report";
import { buildSummary, briefInfo } from "../src/summary";
import { readText } from "./helpers";
import { parseResults } from "../src/results";
import { scoreRecords } from "../src/run";

const html = renderHtml(
  buildSummary(scoreRecords(parseResults(readText("examples/synthetic-results.jsonl"), "x").records, DEFAULT_BRIEF_SET).records, briefInfo(DEFAULT_BRIEF_SET), { sources: ["synthetic-results.jsonl"], diagnostics: [] }),
);

function load(markup: string): void {
  document.open();
  document.write(markup);
  document.close();
}

describe("leaderboard.html: self-contained", () => {
  it("references nothing outside the file", () => {
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/(?:src|href|action|poster|data)\s*=\s*["'](?!#)/i);
    expect(html).not.toMatch(/<link\b|<img\b|<iframe\b|<object\b|<embed\b|<base\b/i);
    expect(html).not.toMatch(/@import|url\(/i);
    expect(html).not.toMatch(/\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(html).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|importScripts)\b/);
    expect(html).not.toMatch(/\b(localStorage|sessionStorage|document\.cookie)\b/);
  });

  it("has exactly one inline style and one inline script", () => {
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html.match(/<script[^>]*src=/g)).toBeNull();
  });

  it("supports light and dark", () => {
    expect(html).toMatch(/prefers-color-scheme:dark/);
    expect(html).toMatch(/color-scheme:light dark/);
    expect(html).toMatch(/\[data-theme="dark"\]/);
    expect(html).toMatch(/\[data-theme="light"\]/);
  });

  it("is small", () => {
    expect(html.length).toBeLessThan(200_000);
  });
});

describe("leaderboard.html: accessibility", () => {
  it("passes axe (structure, names, landmarks, tables, SVG)", async () => {
    load(html);
    const res = await axe(document.documentElement, { rules: { "color-contrast": { enabled: false } } });
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });

  it("has a language, a title, one h1, a main landmark and a skip link", () => {
    load(html);
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe("GradientBench report");
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelectorAll("main")).toHaveLength(1);
    expect(document.querySelector("a.skip")?.getAttribute("href")).toBe("#main");
    expect(document.getElementById("main")).not.toBeNull();
  });

  it("shows the caveat first inside main, as a labelled section", () => {
    load(html);
    const first = document.querySelector("main > section");
    expect(first?.classList.contains("caveat")).toBe(true);
    expect(first?.getAttribute("aria-labelledby")).toBe("caveat-h");
    expect(first?.textContent).toContain("not validation of the metric");
  });

  it("gives every table a caption and scoped headers, and every SVG a name", () => {
    load(html);
    for (const t of document.querySelectorAll("table")) {
      expect(t.querySelector("caption")?.textContent?.length).toBeGreaterThan(3);
      for (const th of t.querySelectorAll("thead th")) expect(th.getAttribute("scope")).toBe("col");
    }
    const svgs = document.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(4);
    for (const s of svgs) {
      expect(s.getAttribute("role")).toBe("img");
      const id = s.getAttribute("aria-labelledby")!;
      expect(document.getElementById(id)?.textContent?.length).toBeGreaterThan(10);
    }
  });

  it("has unique ids", () => {
    load(html);
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("passes axe with an empty summary too", async () => {
    load(renderHtml(buildSummary([], briefInfo(DEFAULT_BRIEF_SET), { sources: [], diagnostics: [] })));
    const res = await axe(document.documentElement, { rules: { "color-contrast": { enabled: false } } });
    expect(res.violations).toEqual([]);
  });
});

describe("leaderboard.html: inline script", () => {
  it("works without crashing: theme toggle and column sorting", () => {
    load(html);
    const script = document.querySelector("script")!.textContent!;
    // Depending on the jsdom settings the script already ran on document.write; run it only if it did not.
    const btn = document.getElementById("theme") as HTMLButtonElement;
    if (btn.hidden) new Function(script)();
    expect(btn.hidden).toBe(false);
    btn.click();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    btn.click();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    const table = document.querySelector("table[data-sortable]")!;
    const meanCol = [...table.querySelectorAll("thead th")].findIndex((th) => th.textContent === "Mean score");
    const sortBtn = table.querySelectorAll("thead th")[meanCol]!.querySelector("button") as HTMLButtonElement;
    sortBtn.click();
    const col = () => [...table.querySelectorAll<HTMLTableRowElement>("tbody tr")].map((r) => parseFloat(r.cells[meanCol]!.getAttribute("data-v")!));
    const asc = col();
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    expect(table.querySelectorAll("thead th")[meanCol]!.getAttribute("aria-sort")).toBe("ascending");
    sortBtn.click();
    expect(col()).toEqual([...asc].reverse());
  });
});
