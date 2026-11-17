// Determinism across engines (defect D8, docs/DETERMINISM.md).
//
// Locations (findings[].stops / segment), the stops a fix edits and refine's
// output must not depend on floating-point noise. The inputs below are built
// so that the deciding values tie in exact arithmetic: same-hue families
// (pure-channel / two-equal-channel ramps, whose OKLab a/b scale together so
// their hue is identical up to ~1e-13°), palindromes, and every 3-stop
// gradient (its two velocity deviations from the mean are equal). Every input
// is checked
//   - against a golden file generated on Node 22 (tests/golden/determinism-*.json;
//     CI runs this suite on Node 22 AND Node 24, so the golden pins both),
//   - across all permutations of the input array (the engine sorts by position),
//   - across repeated runs.
import { describe, expect, it } from "vitest";
import { proposeFixes } from "../src/api/fixes";
import { refineGradient, scoreGradient, type GradientTick } from "../src/gradient-engine";

type Pair = [string, number];
const ticks = (pairs: Pair[]): GradientTick[] => pairs.map(([color, position], i) => ({ id: i + 1, color, position }));

/** Everything observable that a tie could move, keyed by stop id where it refers to input stops. */
function observe(input: GradientTick[]) {
  const score = scoreGradient(input.map((t) => ({ ...t })));
  const fixes = proposeFixes(input.map((t) => ({ ...t })));
  const refined = refineGradient(input.map((t) => ({ ...t })));
  return {
    score: score.score,
    findings: score.findings.map((f) => ({ code: f.code, stops: f.stops, segment: f.segment })),
    fixes: fixes.map((f) => ({
      code: f.code,
      gain: f.gain,
      label: f.label,
      // Edited stops by id, with their new colour / position: independent of input array order.
      edits: f.changedStops
        .map((i) => ({ id: f.document[i].id, color: f.document[i].color, position: f.document[i].position }))
        .sort((a, b) => a.id - b.id),
    })),
    refine: { refined: refined.refined, after: refined.after, stops: refined.stops.map((t) => [t.id, t.color, t.position]) },
  };
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

// Same-hue families: [mid, light, dark] of one hue.
const FAMILIES: Record<string, [string, string, string]> = {
  green: ["#00a600", "#00ff00", "#006900"],
  red: ["#a60000", "#ff0000", "#690000"],
  blue: ["#0000a6", "#0000ff", "#000069"],
  yellow: ["#a6a600", "#ffff00", "#696900"],
  magenta: ["#a600a6", "#ff00ff", "#690069"],
  cyan: ["#00a6a6", "#00ffff", "#006969"],
};

function cases(): Record<string, Pair[]> {
  const out: Record<string, Pair[]> = {};
  for (const [name, [m, l, d]] of Object.entries(FAMILIES)) {
    out[`${name} m-l-d`] = [[m, 0], [l, 50], [d, 100]];
    out[`${name} d-m-l`] = [[d, 0], [m, 50], [l, 100]];
    out[`${name} l-d-m uneven`] = [[l, 0], [d, 30], [m, 100]];
    out[`${name} palindrome 3`] = [[d, 0], [l, 50], [d, 100]];
    out[`${name} palindrome 5`] = [[d, 0], [m, 25], [l, 50], [m, 75], [d, 100]];
    out[`${name} two-hue`] = [[m, 0], [d, 40], ["#ffffff", 100]];
  }
  // Two families at once: two tie groups at each end of the hue arc.
  out["green+red"] = [["#00a600", 0], ["#ff0000", 33], ["#006900", 66], ["#690000", 100]];
  out["blue+yellow"] = [["#0000ff", 0], ["#a6a600", 33], ["#000069", 66], ["#ffff00", 100]];
  // Generic 3-stop gradients: the two velocity deviations always tie.
  out["3-stop warm"] = [["#ff512f", 0], ["#dd2476", 50], ["#4a00e0", 100]];
  out["3-stop abrupt"] = [["#ff0000", 0], ["#0000ff", 11], ["#00ff00", 100]];
  out["3-stop greys"] = [["#000000", 0], ["#808080", 30], ["#ffffff", 100]];
  // Symmetric multi-stop gradients.
  out["palindrome rainbow"] = [["#ff0000", 0], ["#00ff00", 25], ["#0000ff", 50], ["#00ff00", 75], ["#ff0000", 100]];
  out["palindrome muddy"] = [["#00ff00", 0], ["#ff00ff", 50], ["#00ff00", 100]];
  return out;
}

describe("determinism (D8)", () => {
  it("the reported reproduction gives one answer on every engine", () => {
    const input = ticks([["#00a600", 0], ["#00ff00", 50], ["#006900", 100]]);
    const s = scoreGradient(input);
    const narrow = s.findings.find((f) => f.code === "hue/narrow-arc");
    // All three stops have the same hue: the arc names the lowest and highest index.
    expect(narrow?.stops).toEqual([0, 2]);
    const fix = proposeFixes(input).find((f) => f.code === "hue/narrow-arc");
    expect(fix?.gain).toBe(5);
    expect(fix?.changedStops).toEqual([2]);
    expect(fix?.document.map((t) => t.color)).toEqual(["#00a600", "#00ff00", "#4b5f00"]);
  });

  it("3-stop gradients name the first segment for lightness/uneven-speed", () => {
    const s = scoreGradient(ticks([["#ff0000", 0], ["#0000ff", 11], ["#00ff00", 100]]));
    expect(s.findings.find((f) => f.code === "lightness/uneven-speed")).toMatchObject({ stops: [0, 1], segment: [0, 11] });
  });

  const all = cases();

  it("matches the golden file (generated on Node 22, asserted on every Node version)", async () => {
    const golden: Record<string, ReturnType<typeof observe>> = {};
    for (const [name, pairs] of Object.entries(all)) golden[name] = observe(ticks(pairs));
    await expect(JSON.stringify(golden, null, 1) + "\n").toMatchFileSnapshot("./golden/determinism-families.json");
  });

  for (const [name, pairs] of Object.entries(all)) {
    it(`${name}: identical across input permutations and repeated runs`, () => {
      const base = ticks(pairs);
      const want = observe(base);
      expect(observe(base)).toEqual(want);
      const perms = base.length <= 4 ? permutations(base) : [[...base].reverse(), [base[2], base[0], base[4], base[1], base[3]]];
      for (const p of perms) expect(observe(p)).toEqual(want);
    });
  }
});
