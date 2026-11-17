// ── Performance benchmark: scoring, refining and fixing at 3 to 32 stops ──────
// Run with:  npm run bench:perf -w @opal42/gradient
//   BENCH_MS=<ms per case>   time budget per case (default 400)
//   BENCH_JSON=1             also print the result as JSON (for docs / diffing)
//
// Inputs are deterministic: a seeded PRNG (mulberry32) draws random sRGB
// colours at evenly spread positions, the shape that gives the engine the most
// findings (and so proposeFixes the most work). Times are wall time of
// synchronous, I/O-free code (`performance.now()`), in milliseconds; each case
// is warmed up first. Timing is machine dependent. The operation counts (how
// many times the engine scores) are not, and the tests assert on those.
//
// "growth" is the empirical exponent k in  time ~ stops^k  between consecutive
// sizes (log of the median ratio over log of the stop ratio): 1 is linear, 2
// quadratic, 3 cubic.

import { performance } from "node:perf_hooks";
import { parseGradient, proposeFixes, refine, refineGradient, score, scoreGradient, scoreParsed } from "../src/index";
import type { GradientDocument, GradientTick } from "../src/index";

const SIZES = [3, 8, 16, 32];
const BUDGET_MS = Number(process.env.BENCH_MS ?? 400);
const MIN_RUNS = 5;
const MAX_RUNS = 2000;

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

interface Input {
  ticks: GradientTick[];
  doc: GradientDocument;
  css: string;
}

function makeInput(stops: number, seed = 20260101): Input {
  const rnd = mulberry32(seed + stops);
  const hex = () => `#${Math.floor(rnd() * 0x1000000).toString(16).padStart(6, "0")}`;
  const colours = Array.from({ length: stops }, hex);
  const ticks = colours.map((color, id) => ({ id, color, position: (id / (stops - 1)) * 100 }));
  const doc: GradientDocument = {
    kind: "linear",
    angle: 90,
    stops: ticks.map((t) => ({ color: t.color, position: t.position / 100 })),
  };
  const css = `linear-gradient(90deg, ${ticks.map((t) => `${t.color} ${t.position.toFixed(2)}%`).join(", ")})`;
  return { ticks, doc, css };
}

interface Stat {
  median: number;
  p95: number;
  runs: number;
}

function measure(fn: () => unknown): Stat {
  for (let i = 0; i < 3; i++) fn();
  const times: number[] = [];
  const start = performance.now();
  while (times.length < MIN_RUNS || (performance.now() - start < BUDGET_MS && times.length < MAX_RUNS)) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const at = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
  return { median: at(0.5), p95: at(0.95), runs: times.length };
}

interface Case {
  name: string;
  run: (input: Input) => unknown;
}

const CASES: Case[] = [
  { name: "scoreGradient", run: (i) => scoreGradient(i.ticks) },
  { name: "score (document)", run: (i) => score(i.doc) },
  { name: "refineGradient", run: (i) => refineGradient(i.ticks) },
  { name: "refine (document)", run: (i) => refine(i.doc) },
  { name: "proposeFixes", run: (i) => proposeFixes(i.doc) },
  {
    name: "parse+scoreParsed+refine",
    run: (i) => {
      for (const p of parseGradient(i.css).gradients) {
        scoreParsed(p);
        if (p.document) refine(p.document);
      }
    },
  },
  {
    name: "handler flow (+proposeFixes)",
    run: (i) => {
      for (const p of parseGradient(i.css).gradients) {
        scoreParsed(p);
        if (p.document) {
          refine(p.document);
          proposeFixes(p.document);
        }
      }
    },
  },
];

const fmt = (ms: number) => (ms >= 100 ? ms.toFixed(0) : ms >= 10 ? ms.toFixed(1) : ms >= 1 ? ms.toFixed(2) : ms.toFixed(3));
const results: Record<string, Record<number, Stat>> = {};

console.log(`node ${process.version}, ${BUDGET_MS} ms budget per case, stops ${SIZES.join("/")}\n`);
console.log(`${"case".padEnd(30)}${SIZES.map((n) => `${n} stops`.padStart(22)).join("")}`);
console.log(`${"".padEnd(30)}${SIZES.map(() => "median / p95 ms".padStart(22)).join("")}`);
for (const c of CASES) {
  results[c.name] = {};
  let line = c.name.padEnd(30);
  for (const n of SIZES) {
    const input = makeInput(n);
    const stat = measure(() => c.run(input));
    results[c.name][n] = stat;
    line += `${fmt(stat.median)} / ${fmt(stat.p95)}`.padStart(22);
  }
  console.log(line);
}

console.log("\ngrowth exponent k in time ~ stops^k (median, consecutive sizes)");
console.log(`${"case".padEnd(30)}${SIZES.slice(1).map((n, k) => `${SIZES[k]}->${n}`.padStart(10)).join("")}`);
for (const c of CASES) {
  let line = c.name.padEnd(30);
  for (let k = 1; k < SIZES.length; k++) {
    const a = results[c.name][SIZES[k - 1]].median;
    const b = results[c.name][SIZES[k]].median;
    line += (Math.log(b / a) / Math.log(SIZES[k] / SIZES[k - 1])).toFixed(2).padStart(10);
  }
  console.log(line);
}

if (process.env.BENCH_JSON) console.log("\n" + JSON.stringify(results));
