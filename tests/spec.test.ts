// spec/scoring-v1.md must describe exactly the code: one section per finding
// code, and every numeric constant of V1_MODEL listed with its current value.
// Deliberately simple parsing: `### \`code\`` headings and
// "- `V1_MODEL.path` = value" lines.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scoreGradient } from "../src/gradient-engine";
import { V1_FINDING_CODES, V1_MODEL } from "../src/scoring-model-v1";

const spec = readFileSync(new URL("../spec/scoring-v1.md", import.meta.url), "utf-8");

function get(path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], V1_MODEL);
}

function numericLeaves(v: unknown, path = ""): string[] {
  if (typeof v === "number") return [path];
  if (v && typeof v === "object") {
    return Object.entries(v).flatMap(([k, c]) => numericLeaves(c, path ? `${path}.${k}` : k));
  }
  return [];
}

describe("spec/scoring-v1.md", () => {
  const sections = [...spec.matchAll(/^### `([^`]+)`/gm)].map((m) => m[1]);
  const constants = [...spec.matchAll(/^- `V1_MODEL\.([\w.]+)` = (.+)$/gm)].map((m) => [m[1], m[2].trim()] as const);

  it("has one section per finding code, and no section for an unknown code", () => {
    expect(new Set(sections).size).toBe(sections.length);
    expect([...sections].sort()).toEqual(Object.keys(V1_FINDING_CODES).sort());
  });

  it("every listed constant matches V1_MODEL", () => {
    expect(constants.length).toBeGreaterThan(50);
    for (const [path, value] of constants) {
      expect(get(path), path).toBe(Number(value));
    }
  });

  it("lists every numeric constant of V1_MODEL", () => {
    const listed = new Set(constants.map(([p]) => p));
    for (const path of numericLeaves(V1_MODEL)) expect(listed.has(path), path).toBe(true);
  });

  it("worked examples quoted in the spec hold", () => {
    const g = (pairs: [string, number][]) => pairs.map(([color, position], i) => ({ id: i + 1, color, position }));
    const codes = (pairs: [string, number][]) =>
      scoreGradient(g(pairs)).findings.map((f) => [f.code, f.pointsLost] as const);
    expect(codes([["#ff0000", 0], ["#00ff00", 50], ["#0000ff", 100]])).toContainEqual(["hue/wide-arc", 20]);
    expect(codes([["#ff0000", 0], ["#00ff80", 100]])).toContainEqual(["hue/wide-arc", 8]);
    expect(codes([["#3b82f6", 0], ["#2563eb", 100]])).toEqual([["hue/narrow-arc", 5]]);
    expect(codes([["#ff0000", 32], ["#0000ff", 67]])).toEqual(
      expect.arrayContaining([["rhythm/narrow-span", 4], ["rhythm/edge-gap", 12]]),
    );
    expect(codes([["#f97316", 0], ["#ec4899", 35], ["#8b5cf6", 100]])).toEqual([["rhythm/uneven-gaps", 4]]);
    expect(codes([["#336699", 0], ["#346699", 100]])).toContainEqual(["lightness/low-contrast", 15]);
  });
});
