// V1_MODEL: frozen, complete, and the engine's only source of scoring constants.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scoreGradient } from "../src/gradient-engine";
import {
  boundaryHits,
  V1_BOUNDARY_TABLE,
  V1_FINDING_CODES,
  V1_MODEL,
} from "../src/scoring-model-v1";
import { LEGACY_MEASUREMENTS, measure, type ScoreCase } from "../scripts/vector-lib";

function walk(v: unknown, path: string, visit: (path: string, v: unknown) => void): void {
  visit(path, v);
  if (v && typeof v === "object") {
    for (const [k, c] of Object.entries(v)) walk(c, path ? `${path}.${k}` : k, visit);
  }
}

describe("V1_MODEL", () => {
  it("is deeply frozen", () => {
    walk(V1_MODEL, "", (path, v) => {
      if (v && typeof v === "object") expect(Object.isFrozen(v), path).toBe(true);
    });
    expect(() => {
      (V1_MODEL.weights as { hue: number }).hue = 99;
    }).toThrow(TypeError);
    expect(V1_MODEL.weights.hue).toBe(30);
    expect(Object.isFrozen(V1_BOUNDARY_TABLE)).toBe(true);
    expect(Object.isFrozen(V1_FINDING_CODES)).toBe(true);
  });

  it("weights are 30/30/20/20 and sum to 100", () => {
    expect(V1_MODEL.weights).toEqual({ lightness: 30, hue: 30, chroma: 20, rhythm: 20 });
  });

  it("every tier has a positive integer penalty, a severity matching the convention, and a message", () => {
    let tiers = 0;
    walk(V1_MODEL, "", (path, v) => {
      if (v && typeof v === "object" && "penalty" in v && "message" in v) {
        tiers++;
        const t = v as { penalty: number; severity: string; message: string };
        expect(Number.isInteger(t.penalty) && t.penalty > 0, path).toBe(true);
        expect(t.message.length, path).toBeGreaterThan(10);
        const expected = t.penalty >= 12 ? "error" : t.penalty >= 6 ? "warning" : "info";
        expect(t.severity, path).toBe(expected);
      }
    });
    // 21 historical tiers (+ the reversal template = the 22 original push sites) and the 4 D4 additions.
    expect(tiers).toBe(25);
  });

  it("every rule code is listed in V1_FINDING_CODES with its dimension, and vice versa", () => {
    const fromModel = new Map<string, string>();
    walk(V1_MODEL, "", (path, v) => {
      if (typeof v === "string" && /(^|\.)(code|wideCode|narrowCode)$/.test(path)) {
        fromModel.set(v, path.split(".")[0]);
      }
    });
    expect(Object.fromEntries(fromModel)).toEqual({ ...V1_FINDING_CODES });
    for (const code of Object.keys(V1_FINDING_CODES)) expect(code).toMatch(/^(lightness|hue|chroma|rhythm)\/[a-z]+(-[a-z]+)*$/);
  });

  it("the scoring and refine code contain no numeric constant of their own", () => {
    const src = readFileSync(new URL("../src/gradient-engine.ts", import.meta.url), "utf-8");
    const start = src.indexOf("export function scoreGradient");
    const end = src.indexOf("export function suggestGradient");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const code = src
      .slice(start, end)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/`[^`]*`|"[^"]*"/g, "");
    const numbers = [...code.matchAll(/(?<![\w.])\d+(\.\d+)?(e-?\d+)?/g)].map((m) => Number(m[0]));
    // Only geometry and units: 0/1/2 (indices, halves, squares), 100 (percent
    // scale), 180/360 (degrees).
    expect([...new Set(numbers)].sort((a, b) => a - b)).toEqual([0, 1, 2, 100, 180, 360]);
  });
});

describe("measurements and the boundary table", () => {
  const corpus = (
    JSON.parse(readFileSync(new URL("../spec/vectors/v1-score.json", import.meta.url), "utf-8")) as {
      cases: ScoreCase[];
    }
  ).cases;

  it("engine measurements equal the independent recomputation in scripts/vector-lib (measure)", () => {
    let n = 0;
    for (const c of corpus) {
      const r = scoreGradient(c.stops.map((s) => ({ ...s })));
      if (r.status !== "ok") continue;
      n++;
      const m = measure(c.stops);
      for (const k of LEGACY_MEASUREMENTS) expect(r.details.measurements![k], `${c.name}: ${k}`).toBe(m[k]);
    }
    expect(n).toBeGreaterThan(300);
  });

  it("every measurement in the table exists on ScoreMeasurements", () => {
    const r = scoreGradient([
      { id: 1, color: "#ff0000", position: 0 },
      { id: 2, color: "#00ff00", position: 50 },
      { id: 3, color: "#0000ff", position: 100 },
    ]);
    const keys = Object.keys(r.details.measurements!);
    for (const e of V1_BOUNDARY_TABLE) expect(keys).toContain(e.measurement);
  });

  it("boundaryHits uses eps * max(1, |t|)", () => {
    expect(boundaryHits({ worstDip: 0.5 + 5e-7 })).toEqual(["worstDip@0.5"]);
    expect(boundaryHits({ worstDip: 0.5 + 2e-6 })).toEqual([]);
    expect(boundaryHits({ enclosingArc: 180 + 1e-4 })).toEqual(["enclosingArc@180"]);
    expect(boundaryHits({ enclosingArc: 180 + 1e-3 })).toEqual([]);
    expect(boundaryHits({ hueSteps: [3, -5.0000001] })).toEqual(["hueSteps@5"]);
    expect(boundaryHits({ velocityCv: null })).toEqual([]);
    expect(boundaryHits({ edgeGap: 40, span: 20 }, 1e-6, ["span"])).toEqual(["span@20"]);
  });
});
