import { describe, expect, it } from "vitest";
import { parseGradient, scoreParsed } from "@opal42/gradient";
import { errorText, RGB_CSS, refine, score, sc } from "./helpers";

const scoreOfCss = (css: string): number => {
  const p = parseGradient(css).gradients[0];
  const r = scoreParsed(p);
  if (r.status !== "ok") throw new Error(`unscorable: ${r.reason}`);
  return r.score;
};

describe("refine_gradient: refinement", () => {
  const out = sc(refine({ css: RGB_CSS }));
  const g = out.gradients[0];

  it("returns refined CSS with before and after scores", () => {
    expect(g.status).toBe("scored");
    expect(g.refined).toBe(true);
    expect(g.before.score).toBe(58);
    expect(g.after.score).toBeGreaterThan(g.before.score);
    expect(g.refinedCss).toMatch(/^linear-gradient\(90deg, #[0-9a-f]{6} 0%, #[0-9a-f]{6} 50%, #[0-9a-f]{6} 100%\)$/);
  });

  it("claims only what the scorer confirms: the refined CSS scores as reported", () => {
    expect(scoreOfCss(g.refinedCss)).toBe(g.after.score);
    expect(sc(score({ css: g.refinedCss })).gradients[0].score).toBe(g.after.score);
  });

  it("lists the per-stop changes and the largest colour shift, so intent can be checked", () => {
    expect(g.changes.length).toBeGreaterThan(0);
    for (const c of g.changes) {
      expect(c.from.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.to.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.colorShift).toBeGreaterThanOrEqual(0);
    }
    expect(g.largestColorShift).toBe(Math.max(...g.changes.map((c: { colorShift: number }) => c.colorShift)));
    expect(g.largestColorShift).toBeGreaterThan(0.1);
    expect(out.note).toMatch(/colorShift/);
  });

  it("returns refinedStops matching the refined CSS and the remaining issues", () => {
    expect(g.refinedStops).toHaveLength(3);
    expect(g.refinedStops[0]).toEqual({ color: g.changes[0].to.color, positionPercent: 0 });
    for (const i of g.remainingIssues) expect(["error", "warning", "info"]).toContain(i.severity);
  });

  it("proposes targeted fixes, one per issue at most, each of which scores as claimed", () => {
    expect(g.fixes.length).toBeGreaterThan(0);
    const codes = g.fixes.map((f: { code: string }) => f.code);
    expect(new Set(codes).size).toBe(codes.length);
    const issueCodes = sc(score({ css: RGB_CSS })).gradients[0].issues.map((i: { code: string }) => i.code);
    for (const f of g.fixes) {
      expect(issueCodes).toContain(f.code);
      expect(f.gain).toBeGreaterThan(0);
      expect(f.scoreAfter - f.scoreBefore).toBe(f.gain);
      expect(scoreOfCss(f.css)).toBe(f.scoreAfter);
      expect(f.changedStops.length).toBeGreaterThan(0);
      expect(typeof f.label).toBe("string");
    }
  });

  it("is deterministic", () => {
    expect(JSON.stringify(refine({ css: RGB_CSS }))).toBe(JSON.stringify(refine({ css: RGB_CSS })));
  });

  it("never lowers the score across a spread of generated gradients", () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    let refinedCount = 0;
    for (let i = 0; i < 40; i++) {
      const n = 2 + Math.floor(rnd() * 5);
      const stops = Array.from({ length: n }, () => ({ color: `hsl(${Math.floor(rnd() * 360)} ${20 + Math.floor(rnd() * 80)}% ${10 + Math.floor(rnd() * 80)}%)` }));
      const res = sc(refine({ stops })).gradients[0];
      if (res.refined) {
        refinedCount++;
        expect(res.after.score).toBeGreaterThan(res.before.score);
      } else {
        expect(res.declined ?? res.skipped).toBeTruthy();
      }
    }
    expect(refinedCount).toBeGreaterThan(0);
  });
});

describe("refine_gradient: declines and skips", () => {
  it("declines with a reason when the refinement would not raise the score", () => {
    const g = sc(refine({ css: "linear-gradient(#000000, #ffffff)" })).gradients[0];
    expect(g.status).toBe("scored");
    expect(g.before.score).toBe(100);
    expect(g.refined).toBe(false);
    expect(g.declined.code).toBe("no-gain");
    expect(g.declined.reason).toMatch(/does not raise the score/);
    expect(g.refinedCss).toBeUndefined();
    expect(g.fixes).toEqual([]);
  });

  it("can still offer a targeted fix when the one-click refinement does not help", () => {
    const g = sc(refine({ css: "linear-gradient(#336699, #99ccff)" })).gradients[0];
    expect(g.refined).toBe(false);
    expect(g.declined.code).toBe("no-gain");
    expect(g.fixes.length).toBeGreaterThan(0);
    expect(g.fixes[0].gain).toBeGreaterThan(0);
  });

  it("leaves hard stops alone (stripes are intent)", () => {
    const g = sc(refine({ css: "linear-gradient(90deg, #ff0000 0%, #ff0000 50%, #0000ff 50%, #0000ff 100%)" })).gradients[0];
    expect(g.refined).toBe(false);
    expect(g.declined.code).toBe("hard-stops");
    expect(g.fixes).toEqual([]);
  });

  it("leaves gradients with colour hints alone (a rewrite would drop them)", () => {
    const g = sc(refine({ css: "linear-gradient(90deg, #ff0000, 30%, #00ff00, #0000ff)" })).gradients[0];
    expect(g.refined).toBe(false);
    expect(g.declined.code).toBe("color-hints");
  });

  it("reports unscorable gradients as skipped with the parser code", () => {
    const out = sc(refine({ css: "linear-gradient(var(--a), blue); radial-gradient(red, blue); linear-gradient(red, transparent)" }));
    expect(out.gradients.map((g: { skipped: { code: string } }) => g.skipped.code)).toEqual(["var", "unsupported-kind", "alpha"]);
    expect(out.summary).toEqual({ refined: 0, declined: 0, skipped: 3 });
  });

  it("answers 0 gradients with a message when none is found", () => {
    const out = sc(refine({ css: "color: red" }));
    expect(out.gradientCount).toBe(0);
    expect(out.message).toBeTruthy();
  });
});

describe("refine_gradient: structured input and limits", () => {
  it("keeps the angle and the interpolation clause of structured input", () => {
    const g = sc(refine({ stops: [{ color: "#ff0000" }, { color: "#00ff00" }, { color: "#0000ff" }], angle: 45, interpolation: "oklch" })).gradients[0];
    expect(g.refined).toBe(true);
    expect(g.refinedCss).toMatch(/^linear-gradient\(45deg in oklch, /);
    expect(g.refinedStops).toHaveLength(3);
  });

  it("refines each gradient of a stylesheet independently and summarises", () => {
    const css = `${RGB_CSS}\n.x{background:linear-gradient(red, 20%, blue)}\n${RGB_CSS}`;
    const out = sc(refine({ css }));
    expect(out.gradientCount).toBe(3);
    expect(out.summary).toEqual({ refined: 2, declined: 1, skipped: 0 });
    expect(out.gradients[2].loc.line).toBe(3);
  });

  it("shares the input rules of score_gradient", () => {
    expect(errorText(refine({}))).toMatch(/give `css`/);
    expect(errorText(refine({ css: "x".repeat(20_001) }))).toMatch(/too long/);
    expect(errorText(refine({ stops: [{ color: "nope-colour" }, { color: "red" }] }))).toMatch(/stops\[0\]\.color/);
    expect(refine({ css: "x", stops: [{ color: "red" }, { color: "blue" }] }).isError).toBe(true);
  });

  it("handles the maximum input (32 gradients) within a few seconds and reports the overflow", () => {
    const stops = Array.from({ length: 6 }, (_, i) => `hsl(${(i * 83) % 360} 80% ${25 + ((i * 17) % 55)}%)`).join(",");
    const css = Array.from({ length: 40 }, () => `linear-gradient(90deg,${stops})`).join(";");
    const t0 = performance.now();
    const out = sc(refine({ css }));
    expect(out.gradientCount).toBe(32);
    expect(out.gradientsNotExamined).toBe(8);
    expect(performance.now() - t0).toBeLessThan(15_000);
  });
});
