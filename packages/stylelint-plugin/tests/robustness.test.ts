import { describe, expect, it } from "vitest";
import postcssScss from "postcss-scss";
import postcssLess from "postcss-less";
import { parseGradient, scoreParsed } from "@opal42/gradient";
import { lint, wrap } from "./helpers";

const ALL = {
  "opal42/min-score": 100,
  "opal42/no-finding": ["hue/wide-arc", "lightness/reversal", "chroma/muddy-midpoint", "rhythm/uneven-gaps"],
  "opal42/valid-gradient": true,
};

/** Small deterministic PRNG (mulberry32) so failures reproduce. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("garbage in, no crash", () => {
  const junk = [
    "linear-gradient(",
    "linear-gradient()",
    "linear-gradient(,)",
    "linear-gradient(red)",
    "linear-gradient(red,,blue)",
    "linear-gradient(#zzz, #12)",
    "linear-gradient(90deg)",
    "linear-gradient(to, red, blue)",
    "linear-gradient(1e999deg, red, blue)",
    "linear-gradient(red NaN%, blue)",
    "linear-gradient(red -0%, blue 1e9%)",
    "linear-gradient(((((((((red))))))))), blue)",
    `linear-gradient(${"red,".repeat(500)}blue)`,
    `linear-gradient(${"(".repeat(200)}`,
    "linear-gradient(red, blue) linear-gradient(red, blue)",
    "linear-gradient(\\6c inear, red, blue)",
    "LINEAR-GRADIENT(RED, BLUE)",
    "linear-gradient(red 10% 20%, blue 20% 10%)",
    "linear-gradient(\u0000, red)",
    "linear-gradient(red , blue)",
    "-webkit-gradient(linear, 0 0, 0 100%, from(red), to(blue))",
    "url(linear-gradient(red, blue))",
    "linear-gradient(url(a.png), red)",
    "linear-gradient(red, blue)".repeat(50),
  ];

  it.each(junk.map((j, i) => [i, j.length > 60 ? `${j.slice(0, 57)}...` : j, j]))("declaration %i: %s", async (_i, _label, value) => {
    const r = await lint(wrap(value as string), ALL, { fix: true });
    // Either stylelint could not parse the stylesheet (reported as a warning) or all rules ran.
    expect(Array.isArray(r.warnings)).toBe(true);
    expect(typeof r.output).toBe("string");
  });

  it("empty and comment-only stylesheets", async () => {
    for (const code of ["", "/* nothing */", "a {}", "@media print {}", "a { background: ; }"]) {
      expect((await lint(code, ALL)).warnings).toEqual([]);
    }
  });

  it("random token soup never crashes and never produces an unparseable fix", async () => {
    const rand = rng(42);
    const atoms = ["linear-gradient(", ")", ",", " ", "red", "#00ff00", "#0000ff", "90deg", "to right", "50%", "10px", "/*", "*/", "var(--x)", "'", "transparent", "rgb(0 0 0 / .5)", "in oklch", "calc(1px + 2%)"];
    for (let n = 0; n < 150; n++) {
      let value = "";
      for (let i = rand() * 14; i > 0; i--) value += atoms[Math.floor(rand() * atoms.length)];
      const code = `a { background: ${value}; }`;
      const r = await lint(code, ALL, { fix: true });
      expect(typeof r.output).toBe("string");
    }
  });

  it("SCSS and Less with garbage do not crash", async () => {
    for (const customSyntax of [postcssScss, postcssLess]) {
      for (const value of ["linear-gradient(#{", "linear-gradient($a, // x", "linear-gradient(@a, ~'x')", "linear-gradient(red, blue) !default"]) {
        const r = await lint(`.a { b: ${value} }`, ALL, { customSyntax, fix: true });
        expect(typeof r.output).toBe("string");
      }
    }
  });
});

describe("property: --fix never makes a gradient worse and is idempotent", () => {
  it("over seeded random scorable gradients", async () => {
    const rand = rng(7);
    const hex = () => `#${Math.floor(rand() * 0xffffff).toString(16).padStart(6, "0")}`;
    let fixed = 0;
    for (let n = 0; n < 120; n++) {
      const stops = 2 + Math.floor(rand() * 4);
      const explicit = rand() < 0.5;
      const pos = [...Array(stops)].map(() => Math.round(rand() * 100)).sort((a, b) => a - b);
      const parts = [...Array(stops)].map((_, i) => (explicit ? `${hex()} ${pos[i]}%` : hex()));
      const g = `linear-gradient(${Math.floor(rand() * 360)}deg, ${parts.join(", ")})`;
      const before = scoreParsed(parseGradient(g).gradients[0]);
      if (before.status !== "ok" || before.analysis.hasHardStops) continue;
      const threshold = 100;
      const first = await lint(wrap(g), { "opal42/min-score": threshold }, { fix: true });
      if (first.output === wrap(g)) continue;
      fixed++;
      const body = first.output.split("\n")[1].replace(/^\s*background:\s*|;$/g, "");
      const after = scoreParsed(parseGradient(body).gradients[0]);
      expect(after.status).toBe("ok");
      if (after.status === "ok") {
        expect(after.score).toBeGreaterThan(before.score);
        expect(after.score).toBeGreaterThanOrEqual(threshold);
      }
      const second = await lint(first.output, { "opal42/min-score": threshold }, { fix: true });
      expect(second.output).toBe(first.output);
    }
    expect(fixed).toBeGreaterThan(5);
  });
});

describe("performance", () => {
  it("a stylesheet with 2000 declarations and 500 gradients lints quickly", async () => {
    const rules = [...Array(2000)].map((_, i) => (i % 4 === 0 ? `.c${i} { background: linear-gradient(90deg, #ff0000, #00ff00 50%, #0000ff); }` : `.c${i} { color: red; margin: ${i}px; }`));
    const t = Date.now();
    const r = await lint(rules.join("\n"), { "opal42/min-score": 70 });
    expect(r.warnings).toHaveLength(500);
    expect(Date.now() - t).toBeLessThan(8000);
  });
});
