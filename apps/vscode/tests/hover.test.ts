import { describe, expect, it } from "vitest";
import type { GradientDocument } from "@opal42/gradient";
import { analyze, computeFixes } from "../src/analyze";
import { dimensionSummary, escapeMarkdown, hoverMarkdown } from "../src/hover";
import { gradientLine, gradientSvg, svgDataUri, swatchMarkdown } from "../src/preview";
import { ROUGH, SMOOTH, FLAT } from "./helpers";

const css = (value: string) => `.a { background: ${value}; }`;
const item = (v: string, o = {}) => analyze(css(v), "css", o).items[0];
const doc = (stops: GradientDocument["stops"], angle = 90): GradientDocument => ({ kind: "linear", angle, stops });
const decode = (md: string): string[] => [...md.matchAll(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g)].map((m) => Buffer.from(m[1], "base64").toString("utf8"));

describe("gradient line geometry", () => {
  it("runs left to right for 90deg", () => {
    const p = gradientLine(90, 200, 100);
    expect(p).toMatchObject({ x1: 0, x2: 200 });
    expect(p.y1).toBeCloseTo(50);
    expect(p.y2).toBeCloseTo(50);
  });

  it("runs top to bottom for 180deg and bottom to top for 0deg", () => {
    const down = gradientLine(180, 200, 100);
    expect(down.y1).toBeCloseTo(0);
    expect(down.y2).toBeCloseTo(100);
    const up = gradientLine(0, 200, 100);
    expect(up.y1).toBeCloseTo(100);
    expect(up.y2).toBeCloseTo(0);
  });

  it("has length |w sin a| + |h cos a| for a diagonal", () => {
    const p = gradientLine(45, 100, 100);
    expect(Math.hypot(p.x2 - p.x1, p.y2 - p.y1)).toBeCloseTo(100 * Math.SQRT2, 5);
  });

  it("falls back to 180deg for a non-finite angle", () => {
    expect(gradientLine(Number.NaN, 10, 10).y2).toBeCloseTo(10);
  });
});

describe("svg swatch", () => {
  const d = doc([{ color: "#ff0000", position: 0 }, { color: "#0000ff", position: 1 }]);

  it("draws a standalone svg from a fixed template", () => {
    const svg = gradientSvg(d)!;
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" /);
    expect(svg.match(/<(\w+)/g)!.map((t) => t.slice(1))).toEqual(
      expect.arrayContaining(["svg", "defs", "linearGradient", "stop", "rect"]),
    );
  });

  it("keeps the original stops at the ends", () => {
    const svg = gradientSvg(d)!;
    expect(svg).toContain('offset="0.0000" stop-color="#ff0000"');
    expect(svg).toContain('offset="1.0000" stop-color="#0000ff"');
  });

  it("contains only allowed characters and elements", () => {
    const svg = gradientSvg(doc([{ color: "#ff0000", position: 0 }, { color: "#00ff00", position: 0.4 }, { color: "#0000ff", position: 1 }], 123))!;
    expect(svg).toMatch(/^[A-Za-z0-9 <>"=/.:#,_()-]+$/);
    expect(svg).not.toMatch(/script|href|onload|style=|javascript/i);
  });

  it("rejects a colour that is not #rrggbb", () => {
    for (const color of ['#ff0000" onload="x', "red", "#fff", "url(#x)", "#ff0000</stop><script>", "#GG0000"]) {
      expect(gradientSvg(doc([{ color, position: 0 }, { color: "#0000ff", position: 1 }]))).toBeNull();
    }
  });

  it("ignores stop ids, which are caller-owned strings", () => {
    const svg = gradientSvg(doc([{ color: "#ff0000", position: 0, id: '"><script>' }, { color: "#0000ff", position: 1, id: "x" }]))!;
    expect(svg).not.toContain("script");
  });

  it("never prints NaN or Infinity", () => {
    const svg = gradientSvg(doc([{ color: "#ff0000", position: 0 }, { color: "#0000ff", position: 1 }], Number.NaN))!;
    expect(svg).not.toMatch(/NaN|Infinity/);
  });

  it("returns null for something that is not a drawable document", () => {
    expect(gradientSvg(null as unknown as GradientDocument)).toBeNull();
    expect(gradientSvg(doc([{ color: "#ff0000" }]))).toBeNull();
    expect(gradientSvg({ ...d, kind: "radial" as "linear" })).toBeNull();
  });

  it("draws oklch documents too", () => {
    const o = { ...d, interpolation: { space: "oklch" as const } };
    expect(gradientSvg(o)).toMatch(/<stop /);
  });

  it("encodes as a base64 data uri that decodes to the svg", () => {
    const svg = gradientSvg(d)!;
    const uri = svgDataUri(svg);
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(Buffer.from(uri.split(",")[1], "base64").toString("utf8")).toBe(svg);
  });

  it("builds a markdown image with a sanitised alt text", () => {
    const md = swatchMarkdown(d, "After: x](javascript:alert(1)) <b>")!;
    expect(md).toMatch(/^!\[[A-Za-z0-9 ,.:+()-]*\]\(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+\)$/);
    expect(md).not.toContain("<");
    expect(md.match(/\]\(/g)).toHaveLength(1);
  });
});

describe("hover text", () => {
  it("leads with the score and shows the dimensions", () => {
    const md = hoverMarkdown(item(ROUGH));
    expect(md).toContain("**Smoothness score 58/100**");
    expect(md).toContain("Lightness 18/30");
    expect(md).toContain("Hue 10/30");
    expect(md).toContain("Chroma 10/20");
    expect(md).toContain("Spacing 20/20");
  });

  it("summarises dimensions in a fixed order", () => {
    expect(dimensionSummary({ lightness: 1, hue: 2, chroma: 3, spacing: 4 })).toBe("Lightness 1/30 · Hue 2/30 · Chroma 3/20 · Spacing 4/20");
  });

  it("explains each finding in plain language from the shared explain texts", () => {
    const md = hoverMarkdown(item(ROUGH));
    expect(md).toContain("**lightness reversal**");
    expect(md).toContain("Counts stops that are darker, or lighter, than both of their neighbours");
    expect(md).toContain("**wide hue arc**");
    expect(md).toContain("**muddy midpoint**");
    expect(md).toContain("-12 points");
  });

  it("says plainly that the score is smoothness by our definition", () => {
    expect(hoverMarkdown(item(ROUGH))).toMatch(/smoothness score by our definition/i);
  });

  it("uses no verdict words", () => {
    const words = /\b(pass|fail|good|bad|poor|excellent|great|ugly)\b/i;
    for (const v of [ROUGH, SMOOTH, FLAT]) {
      const g = item(v);
      expect(hoverMarkdown(g, { fixes: computeFixes(css(v), g) })).not.toMatch(words);
    }
  });

  it("says there are no findings for a clean gradient", () => {
    expect(hoverMarkdown(item(FLAT))).toContain("No findings.");
  });

  it("embeds the current swatch as a data-uri image", () => {
    const md = hoverMarkdown(item(ROUGH));
    const svgs = decode(md);
    expect(svgs).toHaveLength(1);
    expect(svgs[0]).toContain("#ff0000");
  });

  it("embeds the proposed fix's swatch and its score change", () => {
    const g = item(ROUGH);
    const fixes = computeFixes(css(ROUGH), g);
    const md = hoverMarkdown(g, { fixes });
    expect(decode(md)).toHaveLength(2);
    expect(md).toContain("**Proposed: Refine whole gradient** (58 to 90, +32)");
  });

  it("shows the best fix, not the first", () => {
    const g = item(ROUGH);
    const fixes = computeFixes(css(ROUGH), g);
    expect(hoverMarkdown(g, { fixes })).toContain("Refine whole gradient");
    expect(hoverMarkdown(g, { fixes: fixes.slice(0, 1) })).toContain("Make stop 2 darker");
  });

  it("shows the Studio link only when asked", () => {
    const g = item(ROUGH);
    expect(hoverMarkdown(g)).not.toContain("command:");
    const md = hoverMarkdown(g, { studioArgs: encodeURIComponent(JSON.stringify([{ uri: "file:///a.css", offset: 3 }])) });
    expect(md).toContain("[Open in Gradient Studio](command:opal42.openInStudio?%5B%7B");
  });

  it("describes a skipped gradient by its reason only", () => {
    const md = hoverMarkdown(item("linear-gradient(var(--a), #fff)"));
    expect(md).toContain("not scored");
    expect(md).toContain("uses var\\(\\)");
    expect(md).not.toContain("Smoothness score");
    expect(md).not.toContain("data:image");
  });

  it("escapes markdown in dynamic text", () => {
    expect(escapeMarkdown("a*b_c[d](e)<f>`g`#")).toBe("a\\*b\\_c\\[d\\]\\(e\\)\\<f\\>\\`g\\`\\#");
  });

  it("does not let a skip reason inject markup", () => {
    const g = item("linear-gradient(var(--a), #fff)");
    const evil = { ...g, skip: { code: "var", reason: "[click](command:workbench.action.quit) <script>" } };
    const md = hoverMarkdown(evil);
    expect(md).not.toContain("[click](");
    expect(md).not.toContain("<script>");
  });
});
