// Aggregation: per-brief records in, the summary (schemaVersion 1) out.

import { createRequire } from "node:module";
import { briefSetHash, type BriefSet } from "./briefs";
import { round } from "./canon";
import { BENCH_VERSION, BOOTSTRAP_LEVEL, BOOTSTRAP_RESAMPLES, BOOTSTRAP_SEED, CAVEAT, LARGE_CHANGE_DELTA_E, SCHEMA_VERSION, SCORING_MODEL } from "./constants";
import type { Diagnostic } from "./results";
import { recordKey, type BriefRecord } from "./run";
import { mean, median, pairedBootstrapCI, quantile, sd, wilcoxonSignedRank } from "./stats";

function readCoreVersion(): string {
  try {
    const v = (createRequire(import.meta.url)("@opal42/gradient/package.json") as { version?: unknown }).version;
    return typeof v === "string" ? v : "unknown";
  } catch {
    return "unknown";
  }
}

/** Version of the installed @opal42/gradient (the scoring engine). */
export const CORE_VERSION: string = readCoreVersion();

export interface ScoreStats {
  n: number;
  mean: number | null;
  median: number | null;
  sd: number | null;
  min: number | null;
  q1: number | null;
  q3: number | null;
  max: number | null;
}

export interface GroupAggregate {
  /** null = pooled over all models / all conditions. */
  model: string | null;
  condition: string | null;
  records: number;
  briefs: number;
  /** briefs / size of the brief set. */
  coverage: number | null;
  syntheticRecords: number;
  anyGradientRate: number | null;
  found: number;
  scored: number;
  /** scored / found over all gradients of the group. */
  scorableRatio: number | null;
  /** Statistics of the per-record mean score (records with at least one scored gradient). */
  briefScore: ScoreStats;
  /** Mean of the per-record minimum score. */
  meanMinScore: number | null;
  /** Counts of per-record mean scores in [0,10), [10,20) ... [90,100]. */
  histogram: number[];
  findingCodes: { code: string; gradients: number; share: number }[];
  refine: {
    scoredGradients: number;
    /** Gradients for which refine returned a rewrite (colours or only positions). */
    refined: number;
    /** Gradients whose stop colours refine would move. */
    colourChanged: number;
    colourChangedRate: number | null;
    /** Mean over colour-changed gradients of the mean OKLAB ΔE between original and refined stops. */
    meanDeltaE: number | null;
    /** Colour-changed gradients with mean ΔE at or above LARGE_CHANGE_DELTA_E. */
    largeChange: number;
    largeChangeRate: number | null;
    /** Mean over all scored gradients of (score after refine) - (score before). */
    meanScoreGain: number | null;
  };
}

export interface PairComparison {
  model: string;
  baseline: string;
  condition: string;
  pairedBriefs: number;
  /** Briefs present in only one of the two conditions or without a scored gradient in one of them. */
  unpairedBriefs: number;
  meanBaseline: number | null;
  meanCondition: number | null;
  meanDelta: number | null;
  ci: { lo: number; hi: number; level: number; resamples: number; seed: number } | null;
  wilcoxon: { n: number; wPlus: number; wMinus: number; p: number; method: "exact" | "normal" } | null;
  better: number;
  tied: number;
  worse: number;
}

export interface Provenance {
  benchVersion: string;
  scoringModel: string;
  coreVersion: string;
  briefSet: { name: string; version: string; hash: string; count: number };
  extraction: { tailwindPaletteEntries: number };
  bootstrap: { resamples: number; seed: number; level: number };
  sources: string[];
  synthetic: boolean;
}

export interface Summary {
  schemaVersion: 1;
  caveat: string;
  provenance: Provenance;
  diagnostics: Diagnostic[];
  groups: GroupAggregate[];
  byModel: GroupAggregate[];
  byCondition: GroupAggregate[];
  pairs: PairComparison[];
  records: BriefRecord[];
}

const r4 = (x: number): number | null => round(x, 4);
const orNull = (xs: number[], f: (xs: number[]) => number): number | null => (xs.length ? r4(f(xs)) : null);

export function scoreStats(xs: number[]): ScoreStats {
  if (xs.length === 0) return { n: 0, mean: null, median: null, sd: null, min: null, q1: null, q3: null, max: null };
  return {
    n: xs.length,
    mean: r4(mean(xs)),
    median: r4(median(xs)),
    sd: xs.length > 1 ? r4(sd(xs)) : null,
    min: r4(Math.min(...xs)),
    q1: r4(quantile(xs, 0.25)),
    q3: r4(quantile(xs, 0.75)),
    max: r4(Math.max(...xs)),
  };
}

export function aggregate(records: readonly BriefRecord[], model: string | null, condition: string | null, briefCount: number): GroupAggregate {
  const rs = records.filter((r) => (model === null || r.model === model) && (condition === null || r.condition === condition));
  const found = rs.reduce((a, r) => a + r.found, 0);
  const scored = rs.reduce((a, r) => a + r.scored, 0);
  const briefIds = new Set(rs.map((r) => r.briefId));
  const means = rs.filter((r) => r.meanScore !== null).map((r) => r.meanScore!);
  const histogram = new Array<number>(10).fill(0);
  for (const m of means) histogram[Math.min(9, Math.max(0, Math.floor(m / 10)))]!++;
  const codeCounts = new Map<string, number>();
  const allScored = rs.flatMap((r) => r.gradients.filter((g) => g.status === "scored"));
  for (const g of allScored) for (const c of g.findingCodes) codeCounts.set(c, (codeCounts.get(c) ?? 0) + 1);
  const refinedG = allScored.filter((g) => g.refine?.refined);
  const changedG = allScored.filter((g) => g.refine?.colourChanged);
  const large = changedG.filter((g) => g.refine!.meanDeltaE >= LARGE_CHANGE_DELTA_E);
  return {
    model,
    condition,
    records: rs.length,
    briefs: briefIds.size,
    coverage: briefCount ? r4(briefIds.size / briefCount) : null,
    syntheticRecords: rs.filter((r) => r.synthetic).length,
    anyGradientRate: rs.length ? r4(rs.filter((r) => r.anyGradientFound).length / rs.length) : null,
    found,
    scored,
    scorableRatio: found ? r4(scored / found) : null,
    briefScore: scoreStats(means),
    meanMinScore: orNull(rs.filter((r) => r.minScore !== null).map((r) => r.minScore!), mean),
    histogram,
    findingCodes: [...codeCounts]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([code, gradients]) => ({ code, gradients, share: r4(gradients / allScored.length)! })),
    refine: {
      scoredGradients: allScored.length,
      refined: refinedG.length,
      colourChanged: changedG.length,
      colourChangedRate: allScored.length ? r4(changedG.length / allScored.length) : null,
      meanDeltaE: orNull(changedG.map((g) => g.refine!.meanDeltaE), mean),
      largeChange: large.length,
      largeChangeRate: changedG.length ? r4(large.length / changedG.length) : null,
      meanScoreGain: orNull(allScored.map((g) => (g.refine ? g.refine.scoreAfter - g.score! : 0)), mean),
    },
  };
}

const BASELINE = "baseline";

function condRank(c: string): number {
  return c === BASELINE ? 0 : c === "with-skill" ? 1 : 2;
}

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareConditions(a: string, b: string): number {
  return condRank(a) - condRank(b) || compareStrings(a, b);
}

/** Per-brief score of one (model, condition): the mean over samples of the per-record mean score. */
function perBrief(records: readonly BriefRecord[], model: string, condition: string): Map<string, number> {
  const acc = new Map<string, number[]>();
  for (const r of records) {
    if (r.model !== model || r.condition !== condition || r.meanScore === null) continue;
    const list = acc.get(r.briefId) ?? [];
    list.push(r.meanScore);
    acc.set(r.briefId, list);
  }
  return new Map([...acc].map(([k, v]) => [k, mean(v)]));
}

export function comparePairs(records: readonly BriefRecord[]): PairComparison[] {
  const models = [...new Set(records.map((r) => r.model))].sort(compareStrings);
  const out: PairComparison[] = [];
  for (const model of models) {
    const conds = [...new Set(records.filter((r) => r.model === model).map((r) => r.condition))].sort(compareConditions);
    if (!conds.includes(BASELINE)) continue;
    const base = perBrief(records, model, BASELINE);
    for (const condition of conds) {
      if (condition === BASELINE) continue;
      const other = perBrief(records, model, condition);
      const ids = [...base.keys()].filter((id) => other.has(id)).sort(compareStrings);
      const diffs = ids.map((id) => other.get(id)! - base.get(id)!);
      const all = new Set([...base.keys(), ...other.keys(), ...records.filter((r) => r.model === model && (r.condition === condition || r.condition === BASELINE)).map((r) => r.briefId)]);
      const ci = pairedBootstrapCI(diffs, BOOTSTRAP_RESAMPLES, BOOTSTRAP_SEED, BOOTSTRAP_LEVEL);
      const w = wilcoxonSignedRank(diffs.map((d) => round(d, 9)!));
      out.push({
        model,
        baseline: BASELINE,
        condition,
        pairedBriefs: ids.length,
        unpairedBriefs: all.size - ids.length,
        meanBaseline: ids.length ? r4(mean(ids.map((id) => base.get(id)!))) : null,
        meanCondition: ids.length ? r4(mean(ids.map((id) => other.get(id)!))) : null,
        meanDelta: ids.length ? r4(mean(diffs)) : null,
        ci: ci ? { lo: r4(ci.lo)!, hi: r4(ci.hi)!, level: ci.level, resamples: ci.resamples, seed: ci.seed } : null,
        wilcoxon: w ? { n: w.n, wPlus: w.wPlus, wMinus: w.wMinus, p: round(w.p, 6)!, method: w.method } : null,
        better: diffs.filter((d) => round(d, 9)! > 0).length,
        tied: diffs.filter((d) => round(d, 9) === 0).length,
        worse: diffs.filter((d) => round(d, 9)! < 0).length,
      });
    }
  }
  return out;
}

export interface BuildMeta {
  sources: string[];
  diagnostics: Diagnostic[];
  tailwindPaletteEntries?: number;
  coreVersion?: string;
}

export type BriefInfo = Provenance["briefSet"];

export function briefInfo(set: BriefSet): BriefInfo {
  return { name: set.name, version: set.version, hash: briefSetHash(set), count: set.briefs.length };
}

export function buildSummary(records: readonly BriefRecord[], briefs: BriefInfo, meta: BuildMeta): Summary {
  const sorted = [...records].sort((a, b) => compareStrings(a.model, b.model) || compareConditions(a.condition, b.condition) || compareStrings(a.briefId, b.briefId) || a.sample - b.sample);
  const count = briefs.count;
  const models = [...new Set(sorted.map((r) => r.model))].sort(compareStrings);
  const conditions = [...new Set(sorted.map((r) => r.condition))].sort(compareConditions);
  const groups: GroupAggregate[] = [];
  for (const m of models) for (const c of conditions) if (sorted.some((r) => r.model === m && r.condition === c)) groups.push(aggregate(sorted, m, c, count));
  return {
    schemaVersion: SCHEMA_VERSION,
    caveat: CAVEAT,
    provenance: {
      benchVersion: BENCH_VERSION,
      scoringModel: SCORING_MODEL,
      coreVersion: meta.coreVersion ?? CORE_VERSION,
      briefSet: { ...briefs },
      extraction: { tailwindPaletteEntries: meta.tailwindPaletteEntries ?? 0 },
      bootstrap: { resamples: BOOTSTRAP_RESAMPLES, seed: BOOTSTRAP_SEED, level: BOOTSTRAP_LEVEL },
      sources: [...meta.sources],
      synthetic: sorted.some((r) => r.synthetic),
    },
    diagnostics: meta.diagnostics,
    groups,
    byModel: models.map((m) => aggregate(sorted, m, null, count)),
    byCondition: conditions.map((c) => aggregate(sorted, null, c, count)),
    pairs: comparePairs(sorted),
    records: sorted,
  };
}

// ── reading and merging summaries ───────────────────────────────────────

/** Shallow structural check of a parsed summary.json. Returns the problems found. */
export function validateSummary(v: unknown): string[] {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return ["summary must be an object"];
  const s = v as Record<string, unknown>;
  const problems: string[] = [];
  if (s.schemaVersion !== SCHEMA_VERSION) problems.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  const p = s.provenance as Record<string, unknown> | undefined;
  const bs = p?.briefSet as Record<string, unknown> | undefined;
  if (!p || typeof p !== "object") problems.push("provenance is missing");
  else {
    if (typeof p.scoringModel !== "string") problems.push("provenance.scoringModel is missing");
    if (!bs || typeof bs.hash !== "string" || typeof bs.name !== "string" || typeof bs.version !== "string" || typeof bs.count !== "number") problems.push("provenance.briefSet is incomplete");
  }
  if (!Array.isArray(s.records)) problems.push("records must be an array");
  else
    s.records.forEach((r: unknown, i: number) => {
      const o = r as Record<string, unknown>;
      if (!o || typeof o.briefId !== "string" || typeof o.model !== "string" || typeof o.condition !== "string" || typeof o.sample !== "number" || !Array.isArray(o.gradients) || typeof o.found !== "number") problems.push(`records[${i}] is malformed`);
    });
  return problems.slice(0, 10);
}

export function mergeSummaries(inputs: { name: string; summary: Summary }[]): { summary: Summary } | { error: string } {
  const first = inputs[0];
  if (!first) return { error: "no summaries to merge" };
  const hash = first.summary.provenance.briefSet.hash;
  const model = first.summary.provenance.scoringModel;
  for (const { name, summary } of inputs) {
    if (summary.provenance.briefSet.hash !== hash) return { error: `${name}: brief-set hash ${summary.provenance.briefSet.hash} differs from ${hash}; results from different brief sets are not comparable` };
    if (summary.provenance.scoringModel !== model) return { error: `${name}: scoring model ${summary.provenance.scoringModel} differs from ${model}` };
  }
  const seen = new Set<string>();
  const records: BriefRecord[] = [];
  const diagnostics: Diagnostic[] = [];
  const sources: string[] = [];
  const cores = new Set<string>();
  let palette = 0;
  for (const { name, summary } of inputs) {
    sources.push(...summary.provenance.sources);
    cores.add(summary.provenance.coreVersion);
    palette = Math.max(palette, summary.provenance.extraction?.tailwindPaletteEntries ?? 0);
    diagnostics.push(...summary.diagnostics);
    for (const r of summary.records) {
      const k = recordKey(r);
      if (seen.has(k)) {
        diagnostics.push({ source: name, code: "duplicate-record", message: `duplicate (briefId, model, condition, sample) for "${r.briefId}" / "${r.model}" / "${r.condition}" / ${r.sample}; later record ignored` });
        continue;
      }
      seen.add(k);
      records.push(r);
    }
  }
  const summary = buildSummary(records, first.summary.provenance.briefSet, { sources: [...new Set(sources)].sort(compareStrings), diagnostics, tailwindPaletteEntries: palette, coreVersion: [...cores].sort(compareStrings).join(",") });
  return { summary };
}
