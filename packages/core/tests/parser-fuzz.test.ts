// Robustness: the parser never throws, stays inside a time budget on hostile
// input, and round-trips everything `toCSS` prints. All randomness is seeded.

import { describe, expect, it } from "vitest";
import {
  bakeStops,
  parseGradient,
  refine,
  resolveStops,
  sampleGradient,
  score,
  scoreParsed,
  toCSS,
  toCSSWithFallback,
  type GradientDocument,
  type Stop,
} from "../src/index";

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)];
const randomHex = (r: () => number): string => `#${Math.floor(r() * 0x1000000).toString(16).padStart(6, "0")}`;

function timed<T>(fn: () => T): [T, number] {
  const t0 = performance.now();
  const value = fn();
  return [value, performance.now() - t0];
}

/** Everything a caller may do with a parse result; must never throw or produce NaN. */
function exercise(css: string): number {
  const { gradients } = parseGradient(css);
  let last = -1;
  for (const g of gradients) {
    expect(g.range.start).toBeGreaterThanOrEqual(last);
    last = g.range.start;
    expect(g.range.start).toBeGreaterThanOrEqual(0);
    expect(g.range.end).toBeLessThanOrEqual(css.length);
    expect(g.range.end).toBeGreaterThan(g.range.start);
    expect(css.slice(g.range.start, g.range.end).toLowerCase()).toMatch(/^[a-z-]*gradient\(/);
    expect(g.document === null).toBe(g.skipped !== undefined);
    for (const r of g.stopRanges) {
      expect(r.start).toBeGreaterThanOrEqual(g.range.start);
      expect(r.end).toBeLessThanOrEqual(g.range.end);
      expect(r.end).toBeGreaterThan(r.start);
    }
    const result = scoreParsed(g);
    if (result.status === "ok") {
      expect(Number.isInteger(result.score)).toBe(true);
      expect(result.score >= 0 && result.score <= 100).toBe(true);
      for (const v of Object.values(result.dimensions)) expect(Number.isFinite(v)).toBe(true);
    } else {
      expect(typeof result.reason).toBe("string");
    }
    if (g.document) {
      expect(g.stopRanges).toHaveLength(g.document.stops.length);
      expect(Number.isFinite(g.document.angle)).toBe(true);
      for (const s of g.document.stops) {
        expect(s.color).toMatch(/^#[0-9a-f]{6}$/);
        if (s.alpha !== undefined) expect(s.alpha >= 0 && s.alpha < 1).toBe(true);
        if (s.position !== undefined) expect(Number.isFinite(s.position)).toBe(true);
      }
      for (const s of resolveStops(g.document)) expect(Number.isFinite(s.position)).toBe(true);
      const css2 = toCSS(g.document);
      expect(css2).not.toBeNull();
      expect(css2).not.toMatch(/NaN|undefined|Infinity/);
      refine(g.document);
      sampleGradient(g.document, 0.5);
      bakeStops(g.document, 8);
      toCSSWithFallback(g.document);
    }
  }
  return gradients.length;
}

const TOKENS = [
  "linear-gradient(", "linear-gradient(", "linear-gradient(", "repeating-linear-gradient(", "radial-gradient(", "conic-gradient(",
  "-webkit-linear-gradient(", "-webkit-gradient(", "-moz-linear-gradient(", "LINEAR-GRADIENT(", "gradient(", "x-linear-gradient(",
  "(", ")", ")", ")", ",", ",", ",", " ", " ", " ", "\n", "\t", ";", "{", "}", ":", "/", "/*", "*/", "//", "\\", '"', "'", "`", "${", "#{", "$x", "@y",
  "red", "blue", "transparent", "currentColor", "Canvas", "bogus", "none", "from", "in", "to", "top", "right", "bottom", "left", "hue", "longer",
  "srgb", "oklab", "oklch", "hsl", "#fff", "#ff000080", "#12", "#", "#zzzzzz", "rgb(", "rgba(", "hsl(", "hsla(", "oklch(", "oklab(", "lab(", "color(",
  "color-mix(", "var(", "calc(", "env(", "url(", "url(\"", "0", "1", "50%", "100%", "-10%", "1e309%", "1e-320", "45deg", ".25turn", "3rad", "10px", "1.", "+", "-", ".", "%",
  "0.5", "255", "360", "display-p3", "--x", "!important", "🌈", "é", "\u0000", " ", "\r\n", "<", ">", "=", "[", "]",
];

describe("fuzz", () => {
  it("2,000 random token soups: never throws, each call under 250 ms", () => {
    const r = prng(20261115);
    let found = 0;
    let slowest = 0;
    for (let k = 0; k < 2000; k++) {
      const n = 1 + Math.floor(r() * 60);
      let css = "";
      for (let i = 0; i < n; i++) css += pick(r, TOKENS);
      const [, ms] = timed(() => parseGradient(css));
      slowest = Math.max(slowest, ms);
      found += exercise(css);
    }
    // Generous on purpose: a quadratic blow-up costs seconds, while a busy machine only adds milliseconds.
    expect(slowest).toBeLessThan(250);
    expect(found).toBeGreaterThan(2000); // the soup really does contain gradients
  });

  it("1,000 mutated real gradients: never throws", () => {
    const r = prng(77);
    const seeds = [
      "linear-gradient(to right, #f00 0%, rgb(0 0 255 / 50%) 40% 60%, 70%, oklch(0.7 0.2 150))",
      ".a{background:url(a.png),linear-gradient(45deg in oklch longer hue,red,hsl(120 100% 50%) 30%,blue),radial-gradient(circle at 10% 20%,#fff,transparent)}",
      'const s = `linear-gradient(${a}deg, ${b} 0%, #{$c} 100%)`; // "linear-gradient(red, blue)"',
      "repeating-linear-gradient(-45deg, rgba(0,0,0,.1) 0 10px, transparent 10px 20px)",
    ];
    let docs = 0;
    for (let k = 0; k < 1000; k++) {
      let css = pick(r, seeds);
      const edits = 1 + Math.floor(r() * 4);
      for (let e = 0; e < edits; e++) {
        const at = Math.floor(r() * css.length);
        const op = r();
        if (op < 0.4) css = css.slice(0, at) + css.slice(at + 1 + Math.floor(r() * 3));
        else if (op < 0.8) css = css.slice(0, at) + pick(r, TOKENS) + css.slice(at);
        else css = css.slice(0, at) + css.slice(at, at + 12) + css.slice(at);
      }
      exercise(css);
      docs += parseGradient(css).gradients.filter((g) => g.document).length;
    }
    expect(docs).toBeGreaterThan(50);
  });

  it("random raw strings (all of UTF-16, including lone surrogates): never throws", () => {
    const r = prng(5150);
    for (let k = 0; k < 300; k++) {
      let css = "";
      const n = Math.floor(r() * 200);
      for (let i = 0; i < n; i++) css += r() < 0.3 ? pick(r, TOKENS) : String.fromCharCode(Math.floor(r() * 0x10000));
      exercise(css);
    }
  });
});

describe("pathological input completes within 1 s", () => {
  const cases: [string, () => string][] = [
    ["50k nested parentheses", () => "(".repeat(50_000)],
    ["50k nested, then closed", () => "(".repeat(50_000) + ")".repeat(50_000)],
    ["50k closing parentheses", () => ")".repeat(50_000)],
    ["100k chars of unclosed linear-gradient(", () => "linear-gradient(".repeat(6250)],
    ["100k chars of unclosed nested calc(", () => "linear-gradient(" + "calc(".repeat(20_000)],
    ["100k commas in one gradient", () => `linear-gradient(${",".repeat(100_000)})`],
    ["100k commas, unclosed", () => `linear-gradient(${",".repeat(100_000)}`],
    ["30k stops", () => `linear-gradient(${"red,".repeat(30_000)}blue)`],
    ["30k hints", () => `linear-gradient(red,${"50%,".repeat(30_000)}blue)`],
    ["6k complete gradients", () => "linear-gradient(red,blue)".repeat(6000)],
    ["deeply nested gradients, closed", () => "linear-gradient(".repeat(5000) + "red,blue" + ")".repeat(5000)],
    ["64 nested gradients with long arguments", () => "linear-gradient(red,".repeat(64) + "#abcdef,".repeat(10_000) + "blue" + ")".repeat(64)],
    ["100k identifier characters before (", () => `${"a".repeat(100_000)}(red, blue)`],
    ["100k hyphens then gradient", () => `${"-".repeat(100_000)}linear-gradient(red, blue)`],
    ["20k opening parens after identifiers", () => "linear-gradienx(".repeat(20_000)],
    ["unterminated comment", () => `linear-gradient(red, /*${"*".repeat(100_000)}`],
    ["100k comment openers", () => "/*".repeat(50_000)],
    ["100k comment open/close pairs in a gradient", () => `linear-gradient(red, ${"/**/".repeat(25_000)} blue)`],
    ["100k quotes", () => '"'.repeat(100_000)],
    ["alternating quotes in a gradient", () => `linear-gradient(${"\"'".repeat(50_000)})`],
    ["100k backslashes", () => `linear-gradient(${"\\".repeat(100_000)})`],
    ["unterminated string in a gradient", () => `linear-gradient(red, "${"a".repeat(100_000)}`],
    ["100k interpolation openers", () => `linear-gradient(${"${".repeat(50_000)}`],
    ["100k url( openers", () => "url(".repeat(25_000)],
    ["a 100k-digit number", () => `linear-gradient(red ${"9".repeat(100_000)}%, blue)`],
    ["a 100k-char hex colour", () => `linear-gradient(#${"f".repeat(100_000)}, blue)`],
    ["a 100k-char identifier colour", () => `linear-gradient(${"x".repeat(100_000)}, blue)`],
    ["rgb() with 30k components", () => `linear-gradient(rgb(${"1 ".repeat(30_000)}), blue)`],
    ["rgb() nested 10k deep", () => `linear-gradient(${"rgb(".repeat(10_000)}${")".repeat(10_000)}, blue)`],
    ["100k newlines and semicolons", () => ";\n".repeat(50_000)],
    ["100k braces", () => "{}".repeat(50_000)],
    ["1 MB of prose with one gradient", () => `${"lorem ipsum dolor sit amet, ".repeat(36_000)}linear-gradient(red, blue)`],
  ];

  it.each(cases)("%s", (_name, make) => {
    const css = make();
    parseGradient("linear-gradient(red, blue)"); // warm up
    const [result, ms] = timed(() => parseGradient(css));
    // 1 s, not 200 ms: wall-clock limits flake under load; an O(n^2) parse of 100k chars takes many seconds.
    expect(ms).toBeLessThan(1000);
    expect(Array.isArray(result.gradients)).toBe(true);
    for (const g of result.gradients.slice(0, 50)) scoreParsed(g);
  });

  it("scales linearly: 8× the input takes nowhere near 64× the time", () => {
    const unit = ".a{background:linear-gradient(to right, #f00 0%, rgb(0 0 255 / 50%) 40% 60%, hsl(120 100% 50%))} /* c */ ";
    const small = unit.repeat(500);
    const large = unit.repeat(4000);
    parseGradient(small);
    const t1 = Math.min(...[0, 1, 2].map(() => timed(() => parseGradient(small))[1]));
    const t8 = Math.min(...[0, 1, 2].map(() => timed(() => parseGradient(large))[1]));
    expect(parseGradient(large).gradients).toHaveLength(4000);
    expect(t8).toBeLessThan(Math.max(t1, 0.5) * 32);
  });
});

// ── Round trip ────────────────────────────────────────────────────────────────

function randomDocument(r: () => number): GradientDocument {
  const n = 1 + Math.floor(r() * 8);
  const positioned = r();
  let at = 0;
  const stops: Stop[] = Array.from({ length: n }, () => {
    const s: Stop = { color: randomHex(r) };
    if (r() < 0.3) s.alpha = Math.floor(r() * 1000) / 1000;
    if (positioned < 0.4 || (positioned < 0.7 && r() < 0.5)) {
      // Mostly increasing, sometimes out of order or outside 0-1.
      at = r() < 0.1 ? r() * 1.4 - 0.2 : Math.min(1, at + r() * 0.4);
      s.position = Math.round(at * 1000) / 1000;
    }
    return s;
  });
  const d: GradientDocument = { kind: "linear", angle: Math.round((r() * 720 - 360) * 10) / 10, stops };
  if (r() < 0.2) d.repeating = true;
  const i = r();
  if (i < 0.2) d.interpolation = { space: "oklab" };
  else if (i < 0.5) {
    d.interpolation = { space: "oklch" };
    const hue = pick(r, [undefined, "longer", "increasing", "decreasing"] as const);
    if (hue) d.interpolation.hue = hue;
  }
  return d;
}

function expectSameDocument(got: GradientDocument, want: GradientDocument): void {
  expect(got.kind).toBe("linear");
  expect(got.angle).toBeCloseTo(want.angle === 0 ? 0 : want.angle, 9);
  expect(got.repeating).toBe(want.repeating);
  expect(got.interpolation).toEqual(want.interpolation);
  expect(got.stops).toHaveLength(want.stops.length);
  got.stops.forEach((s, i) => {
    const w = want.stops[i];
    expect(s.color).toBe(w.color);
    const alpha = w.alpha === undefined || w.alpha === 1 ? undefined : w.alpha;
    if (alpha === undefined) expect(s.alpha).toBeUndefined();
    else expect(s.alpha).toBeCloseTo(alpha, 9);
    if (w.position === undefined) expect(s.position).toBeUndefined();
    else expect(s.position).toBeCloseTo(w.position, 9);
  });
}

describe("round trip", () => {
  it("parseGradient(toCSS(doc)) is doc, for 1,000 random documents", () => {
    const r = prng(1234);
    for (let k = 0; k < 1000; k++) {
      const d = randomDocument(r);
      const css = toCSS(d)!;
      expect(css).not.toBeNull();
      const { gradients } = parseGradient(css);
      expect(gradients).toHaveLength(1);
      const g = gradients[0];
      expect(g.range).toEqual({ start: 0, end: css.length });
      expect(g.skipped).toBeUndefined();
      expectSameDocument(g.document!, d);
      // Printing is a fixed point after one round.
      expect(toCSS(g.document!)).toBe(css);
      // Scoring the reparsed document gives the same verdict.
      const a = score(d);
      const b = score(g.document!);
      expect(b.status).toBe(a.status);
      if (a.status === "ok" && b.status === "ok") expect(b.score).toBe(a.score);
      if (a.status === "unscorable" && b.status === "unscorable") expect(b.code).toBe(a.code);
    }
  });

  it("survives being embedded in CSS, JS and HTML", () => {
    const r = prng(4321);
    const wrap: ((css: string) => string)[] = [
      (c) => `.a { color: red; background: ${c} !important; }`,
      (c) => `const style = { background: "${c}" };`,
      (c) => `const style = \`\n  background: ${c};\n\`;`,
      (c) => `<div style="background-image: ${c}; color: red"></div>`,
      (c) => `/* before */ a{b:${c}} /* linear-gradient(red, blue) */`,
      (c) => `Text with \`${c}\` in Markdown.`,
    ];
    for (let k = 0; k < 300; k++) {
      const d = randomDocument(r);
      const css = toCSS(d)!;
      const source = wrap[k % wrap.length](css);
      const { gradients } = parseGradient(source);
      expect(gradients).toHaveLength(1);
      expect(source.slice(gradients[0].range.start, gradients[0].range.end)).toBe(css);
      expectSameDocument(gradients[0].document!, d);
      gradients[0].stopRanges.forEach((range, i) => {
        const text = source.slice(range.start, range.end);
        const s = d.stops[i];
        expect(text.startsWith(s.alpha !== undefined && s.alpha < 1 ? "rgb(" : s.color)).toBe(true);
      });
    }
  });

  it("the fallback declarations round-trip to the same two gradients", () => {
    const r = prng(9);
    for (let k = 0; k < 100; k++) {
      const d = randomDocument(r);
      const css = toCSSWithFallback(d)!;
      const found = parseGradient(css).gradients;
      expect(found.length).toBe(css.includes("\n") ? 2 : 1);
      for (const g of found) expect(g.skipped).toBeUndefined();
      const native = found[found.length - 1].document!;
      expect(native.stops.map((s) => s.color)).toEqual(d.stops.map((s) => s.color));
    }
  });

  it("refined documents print and reparse to the same score", () => {
    const r = prng(31);
    for (let k = 0; k < 150; k++) {
      const stops = Array.from({ length: 2 + Math.floor(r() * 5) }, () => ({ color: randomHex(r) }));
      const out = refine({ kind: "linear", angle: 90, stops });
      const reparsed = parseGradient(toCSS(out.document)!).gradients[0].document!;
      const a = out.after;
      const b = score(reparsed);
      expect(a.status).toBe("ok");
      expect(b.status === "ok" && a.status === "ok" && b.score).toBe(a.status === "ok" && a.score);
    }
  });
});
