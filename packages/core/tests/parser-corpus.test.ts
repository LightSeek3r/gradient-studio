// Real-world gradients (framework output and common marketing/UI patterns)
// with the stop lists the parser must produce. Positions are in percent here
// for readability; `null` means "no position in the source".

import { describe, expect, it } from "vitest";
import { parseGradient, resolveStops, score, scoreParsed } from "../src/index";

type S = [color: string, position: number | null, alpha?: number];
type Case = [name: string, css: string, angle: number, stops: S[]];

const CORPUS: Case[] = [
  // ── Tailwind CSS v3: bg-gradient-to-* with from-/via-/to- expanded ──
  ["tailwind v3 to-r blue→purple", "linear-gradient(to right, #3b82f6 0%, #a855f7 100%)", 90, [["#3b82f6", 0], ["#a855f7", 100]]],
  ["tailwind v3 to-r indigo/purple/pink", "linear-gradient(to right, #6366f1 0%, #a855f7 50%, #ec4899 100%)", 90, [["#6366f1", 0], ["#a855f7", 50], ["#ec4899", 100]]],
  ["tailwind v3 to-br cyan→blue", "linear-gradient(to bottom right, #06b6d4 0%, #3b82f6 100%)", 135, [["#06b6d4", 0], ["#3b82f6", 100]]],
  ["tailwind v3 to-t black fade", "linear-gradient(to top, #000 0%, rgb(0 0 0 / 0) 100%)", 0, [["#000000", 0], ["#000000", 100, 0]]],
  ["tailwind v3 from only", "linear-gradient(to right, #22c55e 0%, rgb(34 197 94 / 0) 100%)", 90, [["#22c55e", 0], ["#22c55e", 100, 0]]],
  ["tailwind v3 to-tr sunset", "linear-gradient(to top right, #f97316 0%, #ef4444 50%, #ec4899 100%)", 45, [["#f97316", 0], ["#ef4444", 50], ["#ec4899", 100]]],
  ["tailwind v3 to-bl", "linear-gradient(to bottom left, #fde68a 0%, #fca5a5 100%)", 225, [["#fde68a", 0], ["#fca5a5", 100]]],
  ["tailwind v3 to-l custom stops", "linear-gradient(to left, #0ea5e9 10%, #6366f1 30%, #d946ef 90%)", 270, [["#0ea5e9", 10], ["#6366f1", 30], ["#d946ef", 90]]],
  ["tailwind v3 slate", "linear-gradient(to bottom, #0f172a 0%, #1e293b 50%, #0f172a 100%)", 180, [["#0f172a", 0], ["#1e293b", 50], ["#0f172a", 100]]],
  // ── Tailwind CSS v4: bg-linear-* ──
  ["tailwind v4 in oklab", "linear-gradient(to right in oklab, #3b82f6 0%, #a855f7 100%)", 90, [["#3b82f6", 0], ["#a855f7", 100]]],
  ["tailwind v4 angle", "linear-gradient(45deg in oklab, #6366f1 0%, #ec4899 100%)", 45, [["#6366f1", 0], ["#ec4899", 100]]],
  ["tailwind v4 in oklch", "linear-gradient(to right in oklch, #ef4444 0%, #3b82f6 100%)", 90, [["#ef4444", 0], ["#3b82f6", 100]]],
  ["tailwind v4 longer hue", "linear-gradient(to right in oklch longer hue, #ef4444 0%, #3b82f6 100%)", 90, [["#ef4444", 0], ["#3b82f6", 100]]],
  // ── Bootstrap ──
  ["bootstrap .bg-gradient", "linear-gradient(180deg, rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0))", 180, [["#ffffff", null, 0.15], ["#ffffff", null, 0]]],
  ["bootstrap 3 button", "linear-gradient(to bottom, #337ab7 0%, #265a88 100%)", 180, [["#337ab7", 0], ["#265a88", 100]]],
  ["bootstrap 3 navbar", "linear-gradient(to bottom, #fff 0%, #f8f8f8 100%)", 180, [["#ffffff", 0], ["#f8f8f8", 100]]],
  ["bootstrap progress stripes", "linear-gradient(45deg, rgba(255, 255, 255, .15) 25%, transparent 25%, transparent 50%, rgba(255, 255, 255, .15) 50%, rgba(255, 255, 255, .15) 75%, transparent 75%, transparent)", 45, [
    ["#ffffff", 25, 0.15], ["#000000", 25, 0], ["#000000", 50, 0], ["#ffffff", 50, 0.15], ["#ffffff", 75, 0.15], ["#000000", 75, 0], ["#000000", null, 0],
  ]],
  ["bootstrap carousel control", "linear-gradient(90deg, rgba(0, 0, 0, 0.25), rgba(0, 0, 0, 0.001))", 90, [["#000000", null, 0.25], ["#000000", null, 0.001]]],
  ["bootstrap 3 well", "linear-gradient(to bottom, #e8e8e8 0%, #f5f5f5 100%)", 180, [["#e8e8e8", 0], ["#f5f5f5", 100]]],
  // ── Marketing-page gradients ──
  ["instagram", "linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)", 45, [["#f09433", 0], ["#e6683c", 25], ["#dc2743", 50], ["#cc2366", 75], ["#bc1888", 100]]],
  ["instagram purple", "linear-gradient(45deg, #405de6, #5851db, #833ab4, #c13584, #e1306c, #fd1d1d)", 45, [["#405de6", null], ["#5851db", null], ["#833ab4", null], ["#c13584", null], ["#e1306c", null], ["#fd1d1d", null]]],
  ["stripe-style hero", "linear-gradient(101deg, #a960ee 0%, #ff333d 33%, #90e0ff 66%, #ffcb57 100%)", 101, [["#a960ee", 0], ["#ff333d", 33], ["#90e0ff", 66], ["#ffcb57", 100]]],
  ["stripe-style blurple", "linear-gradient(150deg, #53f 15%, #05d5ff 70%, #a6ffcb 94%)", 150, [["#5533ff", 15], ["#05d5ff", 70], ["#a6ffcb", 94]]],
  ["github-style hero text", "linear-gradient(-70deg, #2188ff 0%, #804eda 100%)", -70, [["#2188ff", 0], ["#804eda", 100]]],
  ["github-style green", "linear-gradient(90deg, #2ea44f, #3fb950 50%, #56d364)", 90, [["#2ea44f", null], ["#3fb950", 50], ["#56d364", null]]],
  ["vercel-style text", "linear-gradient(90deg, #007cf0, #00dfd8)", 90, [["#007cf0", null], ["#00dfd8", null]]],
  ["vercel-style pink", "linear-gradient(90deg, #7928ca, #ff0080)", 90, [["#7928ca", null], ["#ff0080", null]]],
  ["vercel-style orange", "linear-gradient(90deg, #ff4d4d, #f9cb28)", 90, [["#ff4d4d", null], ["#f9cb28", null]]],
  ["linear-style dark glow", "linear-gradient(180deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0) 100%)", 180, [["#ffffff", 0, 0.08], ["#ffffff", 100, 0]]],
  ["uigradients sunset", "linear-gradient(to right, #0b486b, #f56217)", 90, [["#0b486b", null], ["#f56217", null]]],
  ["uigradients purple love", "linear-gradient(to right, #cc2b5e, #753a88)", 90, [["#cc2b5e", null], ["#753a88", null]]],
  ["uigradients king yna", "linear-gradient(to right, #1a2a6c, #b21f1f, #fdbb2d)", 90, [["#1a2a6c", null], ["#b21f1f", null], ["#fdbb2d", null]]],
  ["webgradients warm flame", "linear-gradient(45deg, #ff9a9e 0%, #fad0c4 99%, #fad0c4 100%)", 45, [["#ff9a9e", 0], ["#fad0c4", 99], ["#fad0c4", 100]]],
  ["webgradients night fade", "linear-gradient(to top, #a18cd1 0%, #fbc2eb 100%)", 0, [["#a18cd1", 0], ["#fbc2eb", 100]]],
  ["webgradients deep blue", "linear-gradient(120deg, #e0c3fc 0%, #8ec5fc 100%)", 120, [["#e0c3fc", 0], ["#8ec5fc", 100]]],
  ["webgradients winter neva", "linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)", 120, [["#a1c4fd", 0], ["#c2e9fb", 100]]],
  ["webgradients rainy ashville", "linear-gradient(to top, #fbc2eb 0%, #a6c1ee 100%)", 0, [["#fbc2eb", 0], ["#a6c1ee", 100]]],
  ["css-tricks rainbow", "linear-gradient(to right, red, orange, yellow, green, blue, indigo, violet)", 90, [["#ff0000", null], ["#ffa500", null], ["#ffff00", null], ["#008000", null], ["#0000ff", null], ["#4b0082", null], ["#ee82ee", null]]],
  ["hsl rainbow", "linear-gradient(90deg, hsl(0, 100%, 50%), hsl(60, 100%, 50%), hsl(120, 100%, 50%), hsl(180, 100%, 50%), hsl(240, 100%, 50%), hsl(300, 100%, 50%), hsl(360, 100%, 50%))", 90, [
    ["#ff0000", null], ["#ffff00", null], ["#00ff00", null], ["#00ffff", null], ["#0000ff", null], ["#ff00ff", null], ["#ff0000", null],
  ]],
  ["MDN example", "linear-gradient(217deg, rgba(255,0,0,.8), rgba(255,0,0,0) 70.71%)", 217, [["#ff0000", null, 0.8], ["#ff0000", 70.71, 0]]],
  ["MDN turn", "linear-gradient(0.25turn, #3f87a6, #ebf8e1, #f69d3c)", 90, [["#3f87a6", null], ["#ebf8e1", null], ["#f69d3c", null]]],
  ["MDN to left", "linear-gradient(to left, #333, #333 50%, #eee 75%, #333 75%)", 270, [["#333333", null], ["#333333", 50], ["#eeeeee", 75], ["#333333", 75]]],
  // ── Overlays and scrims ──
  ["hero image scrim", "linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5))", 180, [["#000000", null, 0.5], ["#000000", null, 0.5]]],
  ["bottom scrim", "linear-gradient(to top, rgba(0,0,0,.8) 0%, rgba(0,0,0,0) 60%)", 0, [["#000000", 0, 0.8], ["#000000", 60, 0]]],
  ["fade to transparent", "linear-gradient(to bottom, transparent, #000)", 180, [["#000000", null, 0], ["#000000", null]]],
  ["text fade mask", "linear-gradient(to right, #000 80%, transparent)", 90, [["#000000", 80], ["#000000", null, 0]]],
  ["8-digit hex scrim", "linear-gradient(180deg, #00000000 0%, #000000cc 100%)", 180, [["#000000", 0, 0], ["#000000", 100, 0.8]]],
  ["skeleton shimmer", "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)", 90, [["#f0f0f0", 25], ["#e0e0e0", 50], ["#f0f0f0", 75]]],
  ["skeleton shimmer alpha", "linear-gradient(90deg, rgba(255,255,255,0) 0, rgba(255,255,255,.2) 20%, rgba(255,255,255,.5) 60%, rgba(255,255,255,0))", 90, [["#ffffff", 0, 0], ["#ffffff", 20, 0.2], ["#ffffff", 60, 0.5], ["#ffffff", null, 0]]],
  // ── Stripes and hard stops ──
  ["two-tone split", "linear-gradient(to right, #fff 50%, #000 50%)", 90, [["#ffffff", 50], ["#000000", 50]]],
  ["flag of France", "linear-gradient(to right, #0055a4 33.33%, #fff 33.33% 66.66%, #ef4135 66.66%)", 90, [["#0055a4", 33.33], ["#ffffff", 33.33], ["#ffffff", 66.66], ["#ef4135", 66.66]]],
  ["double-position stripes", "linear-gradient(90deg, red 0% 25%, orange 25% 50%, gold 50% 75%, green 75% 100%)", 90, [
    ["#ff0000", 0], ["#ff0000", 25], ["#ffa500", 25], ["#ffa500", 50], ["#ffd700", 50], ["#ffd700", 75], ["#008000", 75], ["#008000", 100],
  ]],
  ["zero trick hard stop", "linear-gradient(to right, crimson 30%, navy 0)", 90, [["#dc143c", 30], ["#000080", 0]]],
  ["underline", "linear-gradient(to right, currentcolor, currentcolor)".replace(/currentcolor/g, "#1a73e8"), 90, [["#1a73e8", null], ["#1a73e8", null]]],
  ["grid line", "linear-gradient(to right, #e5e7eb 1%, transparent 1%)", 90, [["#e5e7eb", 1], ["#000000", 1, 0]]],
  // ── Syntax variety ──
  ["hsl modern", "linear-gradient(135deg, hsl(220 90% 56%), hsl(280 80% 60% / 0.9))", 135, [["#2a6df4", null], ["#b447eb", null, 0.9]]],
  ["mixed formats", "linear-gradient(to right, RED, #0F0 50%, rgb(0 0 255))", 90, [["#ff0000", null], ["#00ff00", 50], ["#0000ff", null]]],
  ["minified", "linear-gradient(90deg,#fff,#000 50%,#fff)", 90, [["#ffffff", null], ["#000000", 50], ["#ffffff", null]]],
  ["multi-line", "linear-gradient(\n    to bottom,\n    #1e3c72 0%,\n    #2a5298 100%\n  )", 180, [["#1e3c72", 0], ["#2a5298", 100]]],
  ["oklch greys", "linear-gradient(in oklch, oklch(1 0 0), oklch(0 0 0))", 180, [["#ffffff", null], ["#000000", null]]],
  ["grad unit", "linear-gradient(50grad, #fc466b, #3f5efb)", 45, [["#fc466b", null], ["#3f5efb", null]]],
  ["named pastel", "linear-gradient(to right, lavender, mistyrose, lemonchiffon)", 90, [["#e6e6fa", null], ["#ffe4e1", null], ["#fffacd", null]]],
  ["github diffstat", "linear-gradient(to right, #2da44e 60%, #cf222e 60% 80%, #d0d7de 80%)", 90, [["#2da44e", 60], ["#cf222e", 60], ["#cf222e", 80], ["#d0d7de", 80]]],
];

describe("real-world corpus", () => {
  it("has at least 60 gradients", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(60);
  });

  it.each(CORPUS)("%s", (_name, css, angle, stops) => {
    const source = `.x { background-image: ${css}; }`;
    const { gradients } = parseGradient(source);
    expect(gradients).toHaveLength(1);
    const g = gradients[0];
    expect(source.slice(g.range.start, g.range.end)).toBe(css);
    expect(g.skipped).toBeUndefined();
    expect(g.document!.angle).toBeCloseTo(angle, 9);
    expect(g.document!.stops).toHaveLength(stops.length);
    g.document!.stops.forEach((s, i) => {
      const [color, position, alpha] = stops[i];
      expect(s.color).toBe(color);
      if (position === null) expect(s.position).toBeUndefined();
      else expect(s.position).toBeCloseTo(position / 100, 12);
      if (alpha === undefined) expect(s.alpha).toBeUndefined();
      else expect(s.alpha).toBeCloseTo(alpha, 12);
      // Every stop range slices to text that begins or ends with the stop's own source.
      const text = source.slice(g.stopRanges[i].start, g.stopRanges[i].end);
      expect(css).toContain(text);
      expect(text).not.toMatch(/^\s|\s$|^,|,$/);
    });
    // Resolved positions are monotonic and scoring never yields NaN.
    const resolved = resolveStops(g.document!);
    for (let i = 1; i < resolved.length; i++) expect(resolved[i].position).toBeGreaterThanOrEqual(resolved[i - 1].position);
    const result = scoreParsed(g);
    if (result.status === "ok") {
      expect(Number.isInteger(result.score)).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result).toEqual({ ...score(g.document!), issues: result.issues });
      for (const issue of result.issues) expect(issue.range).toBeDefined();
    } else {
      expect(result.reason.length).toBeGreaterThan(0);
      expect(stops.some((s) => s[2] !== undefined) || resolved.some((s) => s.position < 0 || s.position > 1)).toBe(true);
    }
  });

  // What frameworks really ship before their custom properties are resolved.
  it.each<[string, string, string]>([
    ["tailwind v3 utility", "linear-gradient(to right, var(--tw-gradient-stops))", "var"],
    ["tailwind v4 utility", "linear-gradient(var(--tw-gradient-stops))", "var"],
    ["tailwind v4 stops", "linear-gradient(var(--tw-gradient-position), var(--tw-gradient-from) var(--tw-gradient-from-position), var(--tw-gradient-to) var(--tw-gradient-to-position))", "var"],
    ["bootstrap 5 --bs-gradient", "linear-gradient(180deg, rgba(var(--bs-white-rgb), 0.15), rgba(var(--bs-white-rgb), 0))", "var"],
    ["shadcn hsl var", "linear-gradient(to right, hsl(var(--primary)), hsl(var(--secondary)))", "var"],
    ["material elevation overlay", "linear-gradient(rgba(var(--mdc-theme-on-surface), .12), rgba(var(--mdc-theme-on-surface), .12))", "var"],
    ["current colour underline", "linear-gradient(currentColor, currentColor)", "currentColor"],
    ["pixel stripes", "linear-gradient(45deg, #606dbc, #606dbc 10px, #465298 10px, #465298 20px)", "length-position"],
    ["bootstrap striped rem", "linear-gradient(90deg, #000 1rem, transparent 1rem)", "length-position"],
    ["calc stop", "linear-gradient(to right, #fff calc(50% - 1px), #000 calc(50% + 1px))", "calc"],
    ["P3 hero", "linear-gradient(to right, color(display-p3 1 0 0.5), color(display-p3 0 0.5 1))", "color-function"],
    ["color-mix tint", "linear-gradient(color-mix(in srgb, #3b82f6 20%, white), #3b82f6)", "color-mix"],
    ["relative colour", "linear-gradient(oklch(from #3b82f6 calc(l + 0.1) c h), #3b82f6)", "relative-color"],
    ["lab", "linear-gradient(lab(29.2345% 39.3825 20.0664), lab(52.2345% 40.1645 59.9971))", "lab-lch"],
    ["Sass variables", "linear-gradient(to right, $primary, darken($primary, 10%))", "preprocessor"],
    ["Sass interpolation", "linear-gradient(#{$angle}, #{$from}, #{$to})", "preprocessor"],
    ["Less variables", "linear-gradient(to bottom, @start-color, @end-color)", "preprocessor"],
    ["styled-components theme", "linear-gradient(90deg, ${({ theme }) => theme.from}, ${({ theme }) => theme.to})", "preprocessor"],
    ["legacy webkit", "-webkit-linear-gradient(top, #337ab7 0%, #265a88 100%)", "legacy-syntax"],
    ["legacy opera", "-o-linear-gradient(top, #337ab7 0%, #265a88 100%)", "legacy-syntax"],
    ["ancient webkit", "-webkit-gradient(linear, left top, left bottom, from(#337ab7), to(#265a88))", "legacy-syntax"],
    ["spotlight", "radial-gradient(circle at top, rgba(255,255,255,.2), transparent 60%)", "unsupported-kind"],
    ["pie", "conic-gradient(#f00 0 33%, #0f0 0 66%, #00f 0)", "unsupported-kind"],
  ])("unresolvable in the wild: %s → %s", (_name, css, code) => {
    const source = `a{background:${css}}`;
    const { gradients } = parseGradient(source);
    expect(gradients).toHaveLength(1);
    expect(source.slice(gradients[0].range.start, gradients[0].range.end)).toBe(css);
    expect(gradients[0].document).toBeNull();
    expect(gradients[0].skipped!.code).toBe(code);
    const result = scoreParsed(gradients[0]);
    expect(result).toEqual({ status: "unscorable", code, reason: gradients[0].skipped!.reason });
  });

  it("Bootstrap 3 button with its full prefix stack: one standard gradient, the rest legacy", () => {
    const css = `.btn-primary {
  background-image: -webkit-linear-gradient(top, #337ab7 0%, #265a88 100%);
  background-image: -o-linear-gradient(top, #337ab7 0%, #265a88 100%);
  background-image: -webkit-gradient(linear, left top, left bottom, from(#337ab7), to(#265a88));
  background-image: linear-gradient(to bottom, #337ab7 0%, #265a88 100%);
  filter: progid:DXImageTransform.Microsoft.gradient(startColorstr='#ff337ab7', endColorstr='#ff265a88', GradientType=0);
}`;
    const { gradients } = parseGradient(css);
    expect(gradients.map((g) => g.skipped?.code)).toEqual(["legacy-syntax", "legacy-syntax", "legacy-syntax", undefined]);
    expect(gradients.map((g) => g.vendorPrefix)).toEqual(["-webkit-", "-o-", "-webkit-", undefined]);
    expect(score(gradients[3].document!).status).toBe("ok");
  });
});
