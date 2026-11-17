// ── v1 vs v2-experimental over the v1 vector corpus ────────────────────────────
// Run with:  npm run experiments:v2   (prints Markdown tables to stdout)
//
// Reads the INPUTS of spec/vectors/v1-score.json, scores each scorable case
// with v1 (`score`) and with `scoreV2` under srgb, oklab and oklch (shorter
// hue; and oklch with clip gamut mapping), and reports score-delta
// distributions and which findings flip. Deterministic apart from the timing
// line. Feeds docs/v2-experiments.md; changes nothing on disk.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { score } from "../src/api/score";
import type { GradientDocument, Interpolation } from "../src/api/types";
import { V2_FINDING_CODES, scoreV2, type ScoreV2Options } from "../src/experimental/v2";

interface VStop {
  id: number;
  color: string;
  position: number;
}
interface VCase {
  name: string;
  stops: VStop[];
}

const here = dirname(fileURLToPath(import.meta.url));
const corpus = (JSON.parse(readFileSync(resolve(here, "../../../spec/vectors/v1-score.json"), "utf-8")) as { cases: VCase[] }).cases;

function toDoc(c: VCase): GradientDocument {
  const stops = [...c.stops].sort((a, b) => a.position - b.position);
  return { kind: "linear", angle: 180, stops: stops.map((s) => ({ color: s.color, position: s.position / 100 })) };
}

const CONFIGS: { key: string; opts: ScoreV2Options }[] = [
  { key: "srgb", opts: { interpolation: { space: "srgb" } } },
  { key: "oklab", opts: { interpolation: { space: "oklab" } } },
  { key: "oklch", opts: { interpolation: { space: "oklch", hue: "shorter" } as Interpolation } },
  { key: "oklch-clip", opts: { interpolation: { space: "oklch", hue: "shorter" } as Interpolation, gamutMapping: "clip" } },
];

// v1 code -> the v2 code that measures the same concern.
const V1_TO_V2: Record<string, string> = {};
for (const [code, info] of Object.entries(V2_FINDING_CODES)) {
  if (info.origin === "v1-unchanged") V1_TO_V2[code] = code;
  if (info.replaces) V1_TO_V2[info.replaces] = code;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "–");

interface Row {
  name: string;
  doc: GradientDocument;
  v1: number;
  v1codes: Set<string>;
  v2: Record<string, { score: number; codes: Set<string> }>;
}

const rows: Row[] = [];
let unscorable = 0;
let maxMs = 0;
let totalMs = 0;
let calls = 0;
for (const c of corpus) {
  const doc = toDoc(c);
  const r1 = score(doc);
  if (r1.status !== "ok") {
    unscorable++;
    continue;
  }
  const row: Row = { name: c.name, doc, v1: r1.score, v1codes: new Set(r1.issues.map((i) => i.code)), v2: {} };
  for (const cfg of CONFIGS) {
    const t0 = performance.now();
    const r2 = scoreV2(doc, cfg.opts);
    const ms = performance.now() - t0;
    maxMs = Math.max(maxMs, ms);
    totalMs += ms;
    calls++;
    if (r2.status !== "ok") throw new Error(`v2 unscorable on a v1-scorable case: ${c.name}: ${r2.reason}`);
    row.v2[cfg.key] = { score: r2.score, codes: new Set(r2.issues.map((i) => i.code)) };
  }
  rows.push(row);
}

const out: string[] = [];
out.push(`Corpus: ${corpus.length} cases in v1-score.json, ${rows.length} scorable under v1 (${unscorable} unscorable, skipped).`, "");

out.push("## Score deltas (v2 − v1)", "");
out.push("| config | mean | median | p10 | p90 | min | max | |Δ| ≤ 5 | v2 > v1 | v2 < v1 | Spearman ρ(v1, v2) |");
out.push("|---|---|---|---|---|---|---|---|---|---|---|");
function ranks(xs: number[]): number[] {
  const idx = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const r = new Array(xs.length).fill(0);
  let k = 0;
  while (k < idx.length) {
    let j = k;
    while (j + 1 < idx.length && idx[j + 1].x === idx[k].x) j++;
    for (let m = k; m <= j; m++) r[idx[m].i] = (k + j) / 2 + 1;
    k = j + 1;
  }
  return r;
}
function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
}
for (const cfg of CONFIGS) {
  const d = rows.map((r) => r.v2[cfg.key].score - r.v1).sort((a, b) => a - b);
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  const rho = pearson(ranks(rows.map((r) => r.v1)), ranks(rows.map((r) => r.v2[cfg.key].score)));
  out.push(
    `| ${cfg.key} | ${fmt(mean)} | ${fmt(quantile(d, 0.5))} | ${fmt(quantile(d, 0.1))} | ${fmt(quantile(d, 0.9))} | ${d[0]} | ${d[d.length - 1]} | ${d.filter((x) => Math.abs(x) <= 5).length} | ${d.filter((x) => x > 0).length} | ${d.filter((x) => x < 0).length} | ${fmt(rho, 3)} |`,
  );
}
out.push("");

out.push("## Histogram of deltas (count of cases)", "");
const BUCKETS: [string, (x: number) => boolean][] = [
  ["≤ −20", (x) => x <= -20],
  ["−19…−10", (x) => x >= -19 && x <= -10],
  ["−9…−5", (x) => x >= -9 && x <= -5],
  ["−4…−1", (x) => x >= -4 && x <= -1],
  ["0", (x) => x === 0],
  ["+1…+5", (x) => x >= 1 && x <= 5],
  ["+6…+10", (x) => x >= 6 && x <= 10],
  ["> +10", (x) => x > 10],
];
out.push(`| bucket | ${CONFIGS.map((c) => c.key).join(" | ")} |`);
out.push(`|---|${CONFIGS.map(() => "---").join("|")}|`);
for (const [label, test] of BUCKETS) {
  const cells = CONFIGS.map((cfg) => String(rows.filter((r) => test(r.v2[cfg.key].score - r.v1)).length));
  out.push(`| ${label} | ${cells.join(" | ")} |`);
}
out.push("");

out.push("## Finding flips per rule (v1 code → v2 counterpart)", "");
out.push("Cells: both / v1 only / v2 only (number of cases).", "");
out.push(`| v1 code | v2 code | ${CONFIGS.map((c) => c.key).join(" | ")} |`);
out.push(`|---|---|${CONFIGS.map(() => "---").join("|")}|`);
for (const [v1code, v2code] of Object.entries(V1_TO_V2).sort()) {
  const cells = CONFIGS.map((cfg) => {
    let both = 0, only1 = 0, only2 = 0;
    for (const r of rows) {
      const a = r.v1codes.has(v1code);
      const b = r.v2[cfg.key].codes.has(v2code);
      if (a && b) both++;
      else if (a) only1++;
      else if (b) only2++;
    }
    return `${both} / ${only1} / ${only2}`;
  });
  out.push(`| \`${v1code}\` | \`${v2code}\` | ${cells.join(" | ")} |`);
}
out.push("");
out.push("## New v2 rules: cases firing", "");
out.push(`| code | ${CONFIGS.map((c) => c.key).join(" | ")} |`);
out.push(`|---|${CONFIGS.map(() => "---").join("|")}|`);
for (const [code, info] of Object.entries(V2_FINDING_CODES)) {
  if (info.origin !== "new") continue;
  out.push(`| \`${code}\` | ${CONFIGS.map((cfg) => rows.filter((r) => r.v2[cfg.key].codes.has(code)).length).join(" | ")} |`);
}
out.push("");

out.push("## oklch: CSS Color 4 gamut mapping vs clipping", "");
const differ = rows.filter((r) => r.v2["oklch"].score !== r.v2["oklch-clip"].score);
out.push(`${differ.length} of ${rows.length} cases score differently; max |Δ| = ${Math.max(0, ...differ.map((r) => Math.abs(r.v2["oklch"].score - r.v2["oklch-clip"].score)))}.`, "");

out.push("## Largest |v2(srgb) − v1| and |v2(oklch) − v1|", "");
out.push("| case | stops | v1 | srgb | oklab | oklch | v1 codes | v2 srgb codes | v2 oklch codes |");
out.push("|---|---|---|---|---|---|---|---|---|");
const pick = new Set<Row>();
for (const key of ["srgb", "oklch"]) {
  [...rows].sort((a, b) => Math.abs(b.v2[key].score - b.v1) - Math.abs(a.v2[key].score - a.v1) || a.name.localeCompare(b.name)).slice(0, 4).forEach((r) => pick.add(r));
}
for (const r of pick) {
  const stops = r.doc.stops.map((s) => `${s.color} ${Math.round((s.position ?? 0) * 1000) / 10}%`).join(", ");
  out.push(
    `| ${r.name} | ${stops} | ${r.v1} | ${r.v2.srgb.score} | ${r.v2.oklab.score} | ${r.v2.oklch.score} | ${[...r.v1codes].join(", ")} | ${[...r.v2.srgb.codes].join(", ")} | ${[...r.v2.oklch.codes].join(", ")} |`,
  );
}
out.push("");
out.push(`Timing (this machine, vite-node, not a benchmark): mean ${fmt(totalMs / calls, 2)} ms, max ${fmt(maxMs, 2)} ms per scoreV2 call over ${calls} calls.`);
console.log(out.join("\n"));
