// Replays every characterisation vector in spec/vectors/ against the current
// engine: exact for scores, strings, codes and locations; a 1e-9 relative
// tolerance for floating-point measurements (engines differ in the last digits). The vectors freeze v1 (after the pre-freeze
// defect fixes, spec/vectors/CHANGES-v1.md), so any behavioural drift shows up
// here. Regenerate with `npm run vectors` only as a reviewed, intentional act,
// and account for every changed case with `npm run vectors:diff`.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evalColor,
  evalCss,
  evalFindings,
  evalInterpolate,
  evalScore,
  evalSuggest,
  spreadDirectionAngles,
  type ColorCase,
  type CssCase,
  type FindingsCase,
  type InterpolateCase,
  type ScoreCase,
  type SuggestCase,
} from "../scripts/vector-lib";
import { firstDifference } from "./vector-compare";

/** Exact for everything but non-integer floats (see ./vector-compare.ts). */
function expectVector(actual: unknown, expected: unknown): void {
  expect(firstDifference(actual, expected)).toBeNull();
}

interface VectorFile<T> {
  vectorVersion: number;
  kind: string;
  cases: T[];
  [key: string]: unknown;
}

function load<T>(name: string): VectorFile<T> {
  const url = new URL(`../../../spec/vectors/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf-8")) as VectorFile<T>;
}

/** Normalise like the JSON file did (NaN -> null, -0 -> 0, undefined dropped). */
function viaJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("characterisation vectors v1", () => {
  const score = load<ScoreCase>("v1-score.json");
  const suggest = load<SuggestCase>("v1-suggest.json");
  const css = load<CssCase>("v1-css.json");
  const interp = load<InterpolateCase>("v1-interpolate.json");
  const color = load<ColorCase>("v1-color.json");
  const findings = load<FindingsCase>("v1-findings.json");

  it("has the expected corpus sizes", () => {
    expect(score.cases.length).toBeGreaterThanOrEqual(300);
    expect(suggest.cases.length).toBe(score.cases.length);
    expect(interp.cases.length).toBe(score.cases.length);
    expect(findings.cases.length).toBe(score.cases.length);
    expect(css.cases.length).toBeGreaterThanOrEqual(300);
    expect(color.cases.length).toBeGreaterThanOrEqual(100);
    for (const f of [score, suggest, css, interp, color, findings]) expect(f.vectorVersion).toBe(1);
  });

  describe("scoreGradient findings and measurements", () => {
    it.each(findings.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
      expectVector(viaJson(evalFindings(c.name, c.stops)), c);
    });
  });

  describe("scoreGradient", () => {
    it.each(score.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
      expectVector(viaJson(evalScore(c.name, c.stops)), c);
    });
  });

  describe("suggestGradient", () => {
    it.each(suggest.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
      expectVector(viaJson(evalSuggest(c.name, c.stops)), c);
    });
  });

  describe("buildGradientCSS / buildMultiGradientStyle", () => {
    it.each(css.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
      expectVector(viaJson(evalCss(c.name, c.stops, c.angle, c.directions, c.blend)), c);
    });

    it("spreadDirectionAngles", () => {
      const expected = css["spreadDirectionAngles"] as Record<string, number[]>;
      const actual: Record<string, number[]> = {};
      for (const key of Object.keys(expected)) {
        actual[key] = key.includes("@")
          ? spreadDirectionAngles(Number(key.split("@")[0]), Number(key.split("@")[1]))
          : spreadDirectionAngles(Number(key));
      }
      expect(actual).toEqual(expected);
    });
  });

  describe("interpolateGradient / colorAtPosition", () => {
    it.each(interp.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
      expectVector(viaJson(evalInterpolate(c.name, c.stops)), c);
    });
  });

  describe("colour conversions, parsing and formatting", () => {
    it.each(color.cases.map((c, i) => [`${i} ${c.kind} ${JSON.stringify(c.input)}`, c] as const))(
      "%s",
      (_name, c) => {
        expectVector(viaJson(evalColor(c)), c);
      },
    );
  });
});
