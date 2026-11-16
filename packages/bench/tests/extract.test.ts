import { describe, expect, it } from "vitest";
import { extractGradients } from "../src/extract";

interface Case {
  name: string;
  input: string;
  /** number of gradients found (parsed + skipped) */
  found: number;
  /** number that parsed into a document */
  parsed?: number;
  /** skip codes, in order of discovery */
  skips?: string[];
  forms?: string[];
  /** first parsed document's stop colours */
  colors?: string[];
  duplicates?: number;
  notes?: string[];
  palette?: Record<string, string>;
}

const fence = (lang: string, body: string) => "```" + lang + "\n" + body + "\n```";

const cases: Case[] = [
  // ── fences and prose ──
  { name: "css fence", input: fence("css", ".a{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)}"), found: 1, parsed: 1, colors: ["#667eea", "#764ba2"], forms: ["css"] },
  { name: "prose before and after a fence", input: "Sure! Here you go:\n\n" + fence("css", ".hero { background: linear-gradient(to right, #fff, #000); }") + "\n\nHope that helps, let me know.", found: 1, parsed: 1 },
  { name: "inline code in prose", input: "I would use `linear-gradient(90deg, #0ea5e9, #6366f1)` behind the title.", found: 1, parsed: 1, colors: ["#0ea5e9", "#6366f1"] },
  { name: "two different gradients", input: fence("css", ".a{background:linear-gradient(#111,#333)}\n.b{background:linear-gradient(to right,#fff,#eee)}"), found: 2, parsed: 2 },
  { name: "identical gradient repeated in prose and code counts once", input: "Use linear-gradient(90deg, #112233, #445566).\n" + fence("css", ".a{background:linear-gradient(90deg,#112233,#445566)}"), found: 1, parsed: 1, duplicates: 1 },
  { name: "no gradient at all", input: "A flat colour is best here: background: #fafafa.", found: 0 },
  { name: "empty output", input: "", found: 0 },
  { name: "documentation placeholders are ignored", input: "The `linear-gradient()` function takes `linear-gradient(<angle>, <color-stop-list>)`; also linear-gradient(...).", found: 0, notes: ["placeholders-ignored:3"] },
  { name: "multi-layer background", input: ".a{background: linear-gradient(rgba(0,0,0,.4), rgba(0,0,0,.4)), linear-gradient(135deg,#fa709a,#fee140);}", found: 2, parsed: 2 },
  { name: "comments inside the gradient", input: ".a{background:linear-gradient(/* sky */ #87ceeb, /* sea */ #1e90ff)}", found: 1, parsed: 1 },
  { name: "named colours and hsl", input: "background: linear-gradient(to bottom, hsl(210 80% 60%), tomato);", found: 1, parsed: 1 },
  { name: "oklch stops and interpolation clause", input: "background: linear-gradient(in oklch 90deg, oklch(70% 0.15 40), oklch(70% 0.15 250));", found: 1, parsed: 1 },
  { name: "unbalanced / truncated output", input: "```css\n.a{background:linear-gradient(90deg, #fff, #000", found: 1, parsed: 0, skips: ["unbalanced"] },
  // ── skip reasons from the parser ──
  { name: "radial gradient is found but skipped", input: ".a{background:radial-gradient(circle,#fff,#000)}", found: 1, parsed: 0, skips: ["unsupported-kind"] },
  { name: "conic gradient is found but skipped", input: ".a{background:conic-gradient(from 0deg,#f00,#00f)}", found: 1, parsed: 0, skips: ["unsupported-kind"] },
  { name: "repeating gradient parses (scored later as unscorable)", input: ".a{background:repeating-linear-gradient(45deg,#fff 0 10px,#000 10px 20px)}", found: 1 },
  { name: "unresolved var() is a skip", input: ".a{background:linear-gradient(var(--a),var(--b))}", found: 1, parsed: 0, skips: ["var"] },
  { name: "calc and color-mix are skips", input: ".a{background:linear-gradient(calc(1deg*2),#fff,#000)} .b{background:linear-gradient(color-mix(in srgb,red,blue),#000)}", found: 2, parsed: 0 },
  { name: "template literal interpolation is a skip", input: "const bg = `linear-gradient(${angle}deg, ${a}, ${b})`;", found: 1, parsed: 0 },
  { name: "vendor-prefixed gradient is reported as skipped", input: ".a{background:-webkit-linear-gradient(left,#fff,#000);background:linear-gradient(to right,#fff,#000)}", found: 2, parsed: 1 },
  // ── variables ──
  { name: "css custom properties defined once are substituted", input: ":root{--c1:#ff7e5f;--c2:#feb47b}.a{background:linear-gradient(135deg,var(--c1),var(--c2))}", found: 1, parsed: 1, colors: ["#ff7e5f", "#feb47b"], notes: ["substituted:--c1", "substituted:--c2"] },
  { name: "custom property defined twice (dark mode) is not substituted", input: ":root{--c1:#fff;--c2:#eee}@media (prefers-color-scheme:dark){:root{--c1:#111}}.a{background:linear-gradient(var(--c1),var(--c2))}", found: 1, parsed: 0, skips: ["var"] },
  { name: "var with a fallback uses the single definition", input: ":root{--a:#123456}.x{background:linear-gradient(var(--a, red),#fff)}", found: 1, parsed: 1, colors: ["#123456", "#ffffff"] },
  { name: "scss variables", input: "$a: #6a11cb;\n$b: #2575fc !default;\n.hero { background: linear-gradient(to right, $a, $b); }", found: 1, parsed: 1, colors: ["#6a11cb", "#2575fc"] },
  { name: "scss variable that is not a colour stays a skip", input: "$angle: 45deg;\n$a: #fff;\n.x{background:linear-gradient($angle,$a,#000)}", found: 1, parsed: 0 },
  // ── JSON ──
  { name: "whole answer is JSON", input: '{"background":"linear-gradient(90deg, #ff0000 0%, #0000ff 100%)","note":"bold"}', found: 1, parsed: 1, notes: ["json"] },
  { name: "JSON array of strings with two gradients", input: '["linear-gradient(#fff,#ddd)","linear-gradient(to right,#000,#333)"]', found: 2, parsed: 2 },
  { name: "json fence inside prose", input: "Here is the theme:\n" + fence("json", '{"hero": {"bg": "linear-gradient(120deg, #3b82f6, #8b5cf6)"}}') + "\nDone.", found: 1, parsed: 1, notes: ["json"] },
  { name: "JSON-escaped newlines and quotes in running text", input: 'the model said: "css": "a{\\n background: linear-gradient(to right, #f00, #00f);\\n}"', found: 1, parsed: 1, notes: ["json-unescaped"] },
  { name: "unicode-escaped hash in JSON", input: '{"bg":"linear-gradient(90deg, \\u0023ffffff, \\u0023000000)"}', found: 1, parsed: 1, colors: ["#ffffff", "#000000"] },
  { name: "invalid JSON that looks like JSON still scans as text", input: '{"bg": "linear-gradient(#fff, #000)",}', found: 1, parsed: 1 },
  // ── JSX, CSS-in-JS ──
  { name: "JSX style object", input: "<div style={{ background: 'linear-gradient(45deg, #ff9a9e 0%, #fad0c4 100%)' }} />", found: 1, parsed: 1 },
  { name: "styled-components template", input: "const Hero = styled.div`\n  background-image: linear-gradient(180deg, #0f2027, #203a43, #2c5364);\n`;", found: 1, parsed: 1, colors: ["#0f2027", "#203a43", "#2c5364"] },
  { name: "HTML style attribute", input: '<div style="background: linear-gradient(to bottom, #ffffff, #e5e7eb)">x</div>', found: 1, parsed: 1 },
  // ── Tailwind arbitrary values ──
  { name: "tailwind arbitrary value with underscores", input: '<div class="bg-[linear-gradient(to_right,#ff0000,#0000ff)] p-4">', found: 1, parsed: 1, forms: ["tailwind-arbitrary"], colors: ["#ff0000", "#0000ff"] },
  { name: "tailwind arbitrary value with spaces encoded as underscores in stops", input: '<div className="bg-[linear-gradient(135deg,#667eea_0%,#764ba2_100%)]">', found: 1, parsed: 1, forms: ["tailwind-arbitrary"] },
  { name: "tailwind image: type hint and variant prefix", input: '<div class="dark:bg-[image:linear-gradient(90deg,#000,#444)]">', found: 1, parsed: 1, forms: ["tailwind-arbitrary"] },
  { name: "tailwind arbitrary property", input: '<div class="[background-image:linear-gradient(to_right,#fff,#000)]">', found: 1, parsed: 1, forms: ["tailwind-arbitrary"] },
  { name: "tailwind v4 bg-linear-[...] arbitrary angle and stops", input: '<div class="bg-linear-[25deg,red_5%,yellow_60%,lime_90%,teal]">', found: 1, parsed: 1, forms: ["tailwind-arbitrary"] },
  { name: "tailwind arbitrary value that is not a gradient", input: '<div class="bg-[#ff0000] bg-[url(/img.png)]">', found: 0 },
  // ── Tailwind utilities ──
  { name: "tailwind v3 utilities with arbitrary colours", input: '<div class="bg-gradient-to-r from-[#ff0000] via-[#00ff00] to-[#0000ff]">', found: 1, parsed: 1, forms: ["tailwind-utility"], colors: ["#ff0000", "#00ff00", "#0000ff"] },
  { name: "tailwind v4 utilities, angle and positions", input: '<div class="bg-linear-45 from-[#111111] from-10% to-[#eeeeee] to-90%">', found: 1, parsed: 1, forms: ["tailwind-utility"] },
  { name: "tailwind v4 interpolation modifier", input: '<div class="bg-linear-to-br/oklch from-white to-black">', found: 1, parsed: 1 },
  { name: "tailwind palette classes are skipped without a palette", input: '<div class="bg-gradient-to-r from-indigo-500 to-purple-600">', found: 1, parsed: 0, skips: ["tailwind-palette-colour"] },
  { name: "tailwind palette classes resolve with a supplied palette", input: '<div class="bg-gradient-to-r from-indigo-500 to-purple-600">', found: 1, parsed: 1, colors: ["#6366f1", "#9333ea"], palette: { "indigo-500": "#6366f1", "purple-600": "#9333ea" } },
  { name: "tailwind one-sided gradient is incomplete", input: '<div class="bg-gradient-to-t from-[#000000]">', found: 1, parsed: 0, skips: ["tailwind-incomplete"] },
  { name: "tailwind with opacity modifier becomes an alpha colour (parsed, unscorable later)", input: '<div class="bg-gradient-to-r from-[#ffffff]/50 to-[#000000]">', found: 1, parsed: 1 },
  { name: "tailwind radial utility is skipped", input: '<div class="bg-radial from-[#fff] to-[#000]">', found: 1, parsed: 0, skips: ["unsupported-kind"] },
  { name: "dark variant inherits the base direction", input: '<div class="bg-gradient-to-r from-[#ffffff] to-[#eeeeee] dark:from-[#111111] dark:to-[#222222]">', found: 2, parsed: 2 },
  { name: "tailwind class list over several lines", input: 'className={`\n  bg-gradient-to-br\n  from-[#ff7e5f]\n  to-[#feb47b]\n  rounded-xl\n`}', found: 1, parsed: 1 },
  { name: "tailwind utilities and prose words do not collide", input: "Go from-the-start to-do lists; no gradient here.", found: 0 },
];

describe("extractGradients: realistic model outputs", () => {
  it("has at least 40 cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
  });

  for (const c of cases) {
    it(c.name, () => {
      const r = extractGradients(c.input, c.palette ? { tailwindPalette: c.palette } : {});
      expect(r.gradients.length, JSON.stringify(r.gradients.map((g) => [g.form, g.css, g.skipped?.code]))).toBe(c.found);
      if (c.parsed !== undefined) expect(r.gradients.filter((g) => g.document).length).toBe(c.parsed);
      if (c.skips) expect(r.gradients.filter((g) => g.skipped).map((g) => g.skipped!.code)).toEqual(c.skips);
      if (c.forms) expect(r.gradients.map((g) => g.form)).toEqual(c.forms);
      if (c.colors) expect(r.gradients.find((g) => g.document)!.document!.stops.map((s) => s.color)).toEqual(c.colors);
      if (c.duplicates !== undefined) expect(r.duplicatesDropped).toBe(c.duplicates);
      for (const n of c.notes ?? []) expect(r.notes).toContain(n);
    });
  }
});

describe("extractGradients: contract", () => {
  it("is deterministic and never throws", () => {
    for (const v of [undefined, null, 5, {}, [], "\u0000", "linear-gradient(", "bg-[", "bg-[linear-gradient(", "from-[", "{", "```json\n{", "\\u00zz\\n\\\""]) {
      expect(() => extractGradients(v)).not.toThrow();
      expect(extractGradients(v)).toEqual(extractGradients(v));
    }
  });

  it("cuts very long outputs", () => {
    const r = extractGradients("x".repeat(600_000) + " linear-gradient(#fff,#000)");
    expect(r.notes).toContain("truncated");
    expect(r.gradients).toHaveLength(0);
  });

  it("keeps the order of appearance", () => {
    const r = extractGradients(".a{background:linear-gradient(#111111,#222222)} <i class=\"bg-[linear-gradient(#333333,#444444)]\"> .c{background:linear-gradient(#555555,#666666)}");
    expect(r.gradients.map((g) => g.document?.stops[0]?.color)).toEqual(["#111111", "#333333", "#555555"]);
  });
});
