// The performance work (prepared scoring data, per-search memoisation, finding
// persistence pruning) must not change a single output. This file proves it by
// differential testing against FROZEN COPIES of the original implementation
// (tests/reference/*-v1-ref.ts, taken from commit 0584db9; the only edit since is
// the D8 tie-break, applied to src/ and to the references IN LOCKSTEP and marked
// "D8 (lockstep)" there, so the comparison is still like for like):
//
//   - scoreGradient / refineGradient / score / refine / proposeFixes return
//     results that are bit-identical (numbers compared with Object.is, object
//     key order included) on thousands of seeded random inputs of 2 to 32
//     stops: even and uneven positions, hard stops, greys, duplicates, upper
//     case hex, shuffled arrays, documents with automatic positions;
//   - every (finding, candidate) pair the search skips without scoring really
//     keeps the finding (the exactness argument in src/api/fix-persistence.ts,
//     audited here candidate by candidate against the reference scorer);
//   - every candidate the search does score is scored exactly as the
//     reference scorer scores the edited stops.
//
// The same inputs also run the regression guards (operation counts and a very
// generous wall-clock limit) at the end of the file.

import { describe, expect, it } from "vitest";
import {
  proposeFixes,
  refine,
  refineGradient,
  score,
  scoreGradient,
  type GradientDocument,
  type GradientTick,
} from "../src/index";
import { searchForTests, type SearchHooks } from "../src/api/fixes";
import { prepareSorted, scorePrepared } from "../src/gradient-engine";
import { proposeFixes as refProposeFixes } from "./reference/fixes-v1-ref";
import { refineGradient as refRefineGradient, scoreGradient as refScoreGradient } from "./reference/gradient-engine-v1-ref";
import { refine as refRefine, score as refScore } from "./reference/score-v1-ref";

// ── Seeded inputs ─────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => byte(v).toString(16).padStart(2, "0")).join("");

type Colours = (n: number, rnd: () => number) => string[];
const FAMILIES: Colours[] = [
  // random sRGB
  (n, rnd) => Array.from({ length: n }, () => hex(rnd() * 255, rnd() * 255, rnd() * 255)),
  // a smooth ramp with a little noise
  (n, rnd) => Array.from({ length: n }, (_, i) => hex(30 + i * 6 + rnd() * 8, 60 + i * 3 + rnd() * 8, 200 - i * 5 + rnd() * 8)),
  // near-identical colours (low contrast)
  (n, rnd) => Array.from({ length: n }, () => hex(120 + rnd() * 6, 120 + rnd() * 6, 120 + rnd() * 6)),
  // pastels
  (n, rnd) => Array.from({ length: n }, () => hex(200 + rnd() * 55, 180 + rnd() * 75, 200 + rnd() * 55)),
  // greys, some of them chromatic by a hair
  (n, rnd) =>
    Array.from({ length: n }, () => {
      const v = rnd() * 255;
      return hex(v, v, v + (rnd() < 0.3 ? rnd() * 6 : 0));
    }),
  // a few greys among vivid colours
  (n, rnd) => Array.from({ length: n }, (_, i) => (i % 3 === 1 ? hex(128, 128, 128) : hex(rnd() * 255, rnd() * 255, rnd() * 255))),
  // repeated colours and a hue sweep
  (n, rnd) => {
    const palette = Array.from({ length: 3 }, () => hex(rnd() * 255, rnd() * 255, rnd() * 255));
    return Array.from({ length: n }, (_, i) => (rnd() < 0.4 ? palette[i % 3] : hex(255 - i * 8, i * 8, 128 + rnd() * 40)));
  },
];

type Positions = (n: number, rnd: () => number) => number[];
const POSITIONS: Positions[] = [
  (n) => Array.from({ length: n }, (_, i) => (i / (n - 1)) * 100),
  (n, rnd) => Array.from({ length: n }, () => rnd() * 100).sort((a, b) => a - b),
  (n, rnd) => Array.from({ length: n }, () => Math.round(rnd() * 20) * 5).sort((a, b) => a - b), // coarse: ties, hard stops
  (n) => Array.from({ length: n }, (_, i) => Math.min(100, (i / (n - 1)) ** 3 * 100)), // clustered at the start
  (n, rnd) => Array.from({ length: n }, (_, i) => 10 + (i / (n - 1)) * (60 + rnd() * 20)), // short of both edges
  (n) => Array.from({ length: n }, (_, i) => (i === 0 ? 0 : i === n - 1 ? 100 : 20 + (i % 3) * 25 + i / 100)).sort((a, b) => a - b),
];

interface Input {
  name: string;
  /** Engine stops, possibly in shuffled array order. */
  ticks: GradientTick[];
  /** The same gradient as a document (document order), some with automatic positions. */
  doc: GradientDocument;
}

function makeInput(seed: number, minStops: number, maxStops: number): Input {
  const rnd = mulberry32(seed);
  const n = minStops + Math.floor(rnd() * (maxStops - minStops + 1));
  const family = FAMILIES[Math.floor(rnd() * FAMILIES.length)];
  const positions = POSITIONS[Math.floor(rnd() * POSITIONS.length)](n, rnd);
  let colours = family(n, rnd);
  if (rnd() < 0.15) colours = colours.map((c) => c.toUpperCase().replace("#", "#"));
  const ordered = colours.map((color, i) => ({ id: i, color, position: positions[i] }));
  const ticks = rnd() < 0.3 ? ordered.map((t) => ({ ...t })).sort(() => rnd() - 0.5) : ordered;
  const auto = rnd() < 0.2;
  const doc: GradientDocument = {
    kind: "linear",
    angle: 90,
    stops: ordered.map((t, i) => (auto && i > 0 && i < n - 1 ? { color: t.color } : { color: t.color, position: t.position / 100 })),
  };
  return { name: `seed ${seed} (${n} stops)`, ticks, doc };
}

/** Bit-exact structural equality: numbers by Object.is, object key order included. */
function same(a: unknown, b: unknown, path = "$"): string | null {
  if (typeof a === "number" && typeof b === "number") return Object.is(a, b) ? null : `${path}: ${a} !== ${b}`;
  if (typeof a !== typeof b) return `${path}: type ${typeof a} !== ${typeof b}`;
  if (a === null || b === null || typeof a !== "object") return a === b ? null : `${path}: ${String(a)} !== ${String(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array mismatch`;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.join() !== kb.join()) return `${path}: keys ${ka.join()} !== ${kb.join()}`;
  for (const k of ka) {
    const r = same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (r) return r;
  }
  return null;
}

function expectSame(a: unknown, b: unknown, name: string) {
  const diff = same(a, b);
  if (diff) throw new Error(`${name}: ${diff}`);
}

// ── Output equivalence ────────────────────────────────────────────────────────

describe("optimised scoring and refining equal the original, bit for bit", () => {
  it("scoreGradient and refineGradient (3,000 inputs, 2-32 stops)", () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const input = makeInput(seed, 2, 32);
      expectSame(scoreGradient(input.ticks), refScoreGradient(input.ticks), `scoreGradient ${input.name}`);
      expectSame(refineGradient(input.ticks), refRefineGradient(input.ticks), `refineGradient ${input.name}`);
    }
  });

  it("score and refine on documents (1,500 inputs)", () => {
    for (let seed = 5001; seed <= 6500; seed++) {
      const input = makeInput(seed, 2, 32);
      expectSame(score(input.doc), refScore(input.doc), `score ${input.name}`);
      expectSame(refine(input.doc), refRefine(input.doc), `refine ${input.name}`);
    }
  });

  it("edge inputs: unscorable, two stops, hard stops, one position", () => {
    const edge: GradientTick[][] = [
      [],
      [{ id: 0, color: "#fff", position: 0 }],
      [{ id: 0, color: "#ff0000", position: 0 }, { id: 1, color: "#0000ff", position: Number.NaN }],
      [{ id: 0, color: "#ff0000", position: -1 }, { id: 1, color: "#0000ff", position: 100 }],
      [{ id: 0, color: "#ff0000", position: 0 }, { id: 1, color: "#0000ff", position: 100 }],
      [{ id: 0, color: "#ff0000", position: 50 }, { id: 1, color: "#0000ff", position: 50 }],
      [{ id: 0, color: "#ff0000", position: 0 }, { id: 1, color: "#00ff00", position: 50 }, { id: 2, color: "#0000ff", position: 50 }, { id: 3, color: "#ffff00", position: 100 }],
      [{ id: 0, color: "#777777", position: 0 }, { id: 1, color: "#777777", position: 50 }, { id: 2, color: "#777777", position: 100 }],
    ];
    for (const ticks of edge) {
      expectSame(scoreGradient(ticks), refScoreGradient(ticks), `scoreGradient ${JSON.stringify(ticks)}`);
      expectSame(refineGradient(ticks), refRefineGradient(ticks), `refineGradient ${JSON.stringify(ticks)}`);
      expectSame(proposeFixes(ticks), refProposeFixes(ticks), `proposeFixes ${JSON.stringify(ticks)}`);
    }
  });
});

describe("proposeFixes equals the original, bit for bit", () => {
  // The reference is the slow original (about 250 ms at 32 stops), so the
  // large inputs are fewer. The optimised version runs the same inputs.
  const check = (from: number, count: number, min: number, max: number) => {
    let fixes = 0;
    for (let seed = from; seed < from + count; seed++) {
      const input = makeInput(seed, min, max);
      const ticks = proposeFixes(input.ticks);
      expectSame(ticks, refProposeFixes(input.ticks), `proposeFixes(ticks) ${input.name}`);
      const doc = proposeFixes(input.doc);
      expectSame(doc, refProposeFixes(input.doc), `proposeFixes(doc) ${input.name}`);
      fixes += ticks.length + doc.length;
    }
    return fixes;
  };

  it("2-5 stops (400 inputs)", () => {
    expect(check(10_000, 400, 2, 5)).toBeGreaterThan(60); // not vacuous: fixes are really found
  });
  it("6-12 stops (120 inputs)", () => {
    expect(check(20_000, 120, 6, 12)).toBeGreaterThan(60);
  });
  it("13-32 stops (24 inputs)", () => {
    expect(check(30_000, 24, 13, 32)).toBeGreaterThan(4);
  });
});

// ── The search, candidate by candidate ────────────────────────────────────────

describe("the fix search skips and scores exactly what the original would", () => {
  /** The position-sorted ticks of `input`, as the search receives them. */
  const sortedOf = (input: Input): GradientTick[] =>
    input.ticks
      .map((t, i) => ({ t, i }))
      .sort((a, b) => a.t.position - b.t.position || a.i - b.i)
      .map(({ t }) => ({ id: t.id, color: t.color, position: t.position }));

  const keepsOrder = (ticks: GradientTick[]) => ticks.every((t, i) => i === 0 || t.position >= ticks[i - 1].position);

  it("every skipped candidate keeps its finding; every scored one is scored as the original scores it", () => {
    let skipped = 0;
    let scored = 0;
    let compared = 0;
    const failures: string[] = [];
    const perCode = new Map<string, number>();
    for (let seed = 40_000; seed < 40_150; seed++) {
      const input = makeInput(seed, 2, 32);
      if (scoreGradient(input.ticks).status !== "ok") continue;
      const sorted = sortedOf(input);
      const apply = (edits: Map<number, { color?: string; position?: number }>) =>
        sorted.map((t, i) => {
          const e = edits.get(i);
          return e ? { id: t.id, color: e.color ?? t.color, position: e.position ?? t.position } : t;
        });
      const hooks: SearchHooks = {
        pruned(code, c, prepared) {
          const next = apply(c.edits);
          // An edit that reorders the stops is rejected by the search anyway (and means nothing to prepared data).
          if (!keepsOrder(next)) return;
          skipped++;
          perCode.set(code, (perCode.get(code) ?? 0) + 1);
          const reference = refScoreGradient(next);
          // Skipped only if the original re-score would still report the finding ...
          if (!reference.findings.some((f) => f.code === code)) failures.push(`${input.name}: ${code} skipped for ${JSON.stringify([...c.edits])}`);
          // ... and (on a sample, it is a deep comparison) the candidate's prepared data gives the original's score.
          if (skipped % 8 === 0) {
            compared++;
            const diff = same(scorePrepared(prepared), reference);
            if (diff) failures.push(`${input.name}: prepared ${JSON.stringify([...c.edits])}: ${diff}`);
          }
        },
        scored(c, prepared, after) {
          scored++;
          const reference = refScoreGradient(apply(c.edits));
          const diff = same(after, reference) ?? same(scorePrepared(prepared), reference);
          if (diff) failures.push(`${input.name}: scored ${JSON.stringify([...c.edits])}: ${diff}`);
        },
      };
      searchForTests(sorted, seed % 5 === 0, hooks);
    }
    expect(failures.slice(0, 5)).toEqual([]);
    // The audit is not vacuous, and it reached every pruning rule.
    expect(skipped).toBeGreaterThan(5000);
    expect(compared).toBeGreaterThan(500);
    expect(scored).toBeGreaterThan(2000);
    for (const code of [
      "lightness/reversal",
      "lightness/abrupt-jump",
      "hue/wide-arc",
      "hue/direction-reversal",
      "chroma/saturation-range",
      "chroma/dead-zone",
      "chroma/muddy-midpoint",
      "chroma/banding",
      "rhythm/uneven-gaps",
      "lightness/low-contrast",
    ]) {
      expect(perCode.get(code) ?? 0, `${code} pruned at least once`).toBeGreaterThan(0);
    }
  });

  it("prepared data built from scratch equals the original's measurements (patched or not)", () => {
    for (let seed = 50_000; seed < 50_300; seed++) {
      const input = makeInput(seed, 2, 32);
      if (scoreGradient(input.ticks).status !== "ok") continue;
      const sorted = sortedOf(input);
      expectSame(scorePrepared(prepareSorted(sorted)), refScoreGradient(sorted), input.name);
    }
  });
});

// ── Regression guards ─────────────────────────────────────────────────────────
// Operation counts first: they do not depend on the machine. The wall-clock
// limits are 20x the measured time on purpose (they only catch a return to the
// old, quadratic behaviour, never noise).

describe("proposeFixes stays fast", () => {
  /** The benchmark's input (scripts/bench-perf.ts): random colours, even positions. */
  function benchTicks(stops: number, seed = 20260101): GradientTick[] {
    const rnd = mulberry32(seed + stops);
    return Array.from({ length: stops }, (_, id) => ({
      id,
      color: `#${Math.floor(rnd() * 0x1000000).toString(16).padStart(6, "0")}`,
      position: (id / (stops - 1)) * 100,
    }));
  }

  function counts(stops: number) {
    const sorted = benchTicks(stops);
    let scored = 0;
    let skipped = 0;
    searchForTests(sorted, false, { scored: () => scored++, pruned: () => skipped++ });
    return { scored, skipped };
  }

  it("re-scores a bounded number of candidates", () => {
    // Re-scores per proposeFixes call on the benchmark inputs, before the work: 122 / 512 / 1,025 / 2,003
    // for 3 / 8 / 16 / 32 stops. After: 69 / 54 / 45 / 38 (see docs/worker.md). The limits are about 4x that.
    expect(counts(32).scored).toBeLessThanOrEqual(200);
    expect(counts(16).scored).toBeLessThanOrEqual(200);
    expect(counts(8).scored).toBeLessThanOrEqual(200);
    expect(counts(3).scored).toBeLessThanOrEqual(150);
    // Most of the work is skipped by exact reasoning, not by scoring.
    expect(counts(32).skipped).toBeGreaterThan(counts(32).scored);
  });

  it("grows slowly with the stop count", () => {
    const small = counts(8).scored;
    const large = counts(32).scored;
    // 4x the stops: the original re-scored 4x (512 to 2003); allow 8x.
    expect(large).toBeLessThanOrEqual(Math.max(40, small) * 8);
  });

  it("32 stops take far under the original 260 ms (limit 20x the measured time)", () => {
    const doc: GradientDocument = {
      kind: "linear",
      angle: 90,
      stops: benchTicks(32).map((t) => ({ color: t.color, position: t.position / 100 })),
    };
    proposeFixes(doc); // warm up
    const start = performance.now();
    for (let i = 0; i < 3; i++) proposeFixes(doc);
    const each = (performance.now() - start) / 3;
    expect(each).toBeLessThan(200);
  });
});
