import { describe, expect, it } from "vitest";
import { scoreGradient } from "@opal42/gradient";
import { tEn } from "../src/i18n/translator";
import { candidateTicks, computeSuggestion, declineReason } from "../src/suggest/compare";

const rough = [
  { id: 1, color: "#ff0000", position: 0 },
  { id: 2, color: "#00ff00", position: 10 },
  { id: 3, color: "#0000ff", position: 100 },
];

describe("suggestion compare", () => {
  it("diffs every stop and never lowers the score", () => {
    const s = computeSuggestion(rough);
    expect(s.diffs).toHaveLength(3);
    expect(s.result.after).toBeGreaterThanOrEqual(s.result.before);
    if (s.useful) expect(s.diffs.some((d) => d.changed)).toBe(true);
  });

  it("candidate with all changed stops selected equals the suggestion", () => {
    const s = computeSuggestion(rough);
    const all = new Set(s.diffs.map((d) => d.id));
    const c = candidateTicks(s, all);
    expect(scoreGradient(c).score).toBe(s.result.after);
  });

  it("candidate with nothing selected is the original", () => {
    const s = computeSuggestion(rough);
    expect(candidateTicks(s, new Set())).toEqual(rough);
  });

  it("explains a decline instead of offering a no-op", () => {
    const hard = [
      { id: 1, color: "#ff0000", position: 50 },
      { id: 2, color: "#0000ff", position: 50 },
    ];
    const s = computeSuggestion(hard);
    expect(s.useful).toBe(false);
    expect(declineReason(s.result, tEn)).toMatch(/hard stop/);
  });
});
