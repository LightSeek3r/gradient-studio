import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF_SET } from "../src/briefs";
import type { BriefRecord } from "../src/run";
import { aggregate, briefInfo, buildSummary, comparePairs, mergeSummaries, scoreStats, validateSummary } from "../src/summary";
import { pairedBootstrapCI, wilcoxonSignedRank } from "../src/stats";

function rec(briefId: string, model: string, condition: string, meanScore: number | null, extra: Partial<BriefRecord> = {}): BriefRecord {
  const scored = meanScore === null ? 0 : 1;
  return {
    briefId,
    category: briefId.replace(/-\d+$/, ""),
    model,
    condition,
    sample: 0,
    synthetic: false,
    outputChars: 10,
    found: scored,
    scored,
    anyGradientFound: scored > 0,
    scorableRatio: scored ? 1 : null,
    minScore: meanScore,
    meanScore,
    findingCodes: {},
    colourChangedCount: 0,
    meanRefineDeltaE: null,
    duplicatesDropped: 0,
    notes: [],
    gradients:
      meanScore === null
        ? []
        : [{ form: "css", css: "linear-gradient(#000,#fff)", status: "scored", score: meanScore, findingCodes: [], refine: { refined: false, colourChanged: false, scoreAfter: meanScore, meanDeltaE: 0, maxDeltaE: 0 } }],
    ...extra,
  };
}

const ids = DEFAULT_BRIEF_SET.briefs.slice(0, 12).map((b) => b.id);

describe("scoreStats", () => {
  it("summarises", () => {
    expect(scoreStats([10, 20, 30, 40])).toEqual({ n: 4, mean: 25, median: 25, sd: 12.9099, min: 10, q1: 17.5, q3: 32.5, max: 40 });
    expect(scoreStats([])).toEqual({ n: 0, mean: null, median: null, sd: null, min: null, q1: null, q3: null, max: null });
    expect(scoreStats([7]).sd).toBeNull();
  });
});

describe("aggregate", () => {
  it("computes rates, ratios, histogram bins and coverage", () => {
    const rs = [rec(ids[0]!, "m", "baseline", 5), rec(ids[1]!, "m", "baseline", 10), rec(ids[2]!, "m", "baseline", 99), rec(ids[3]!, "m", "baseline", 100), rec(ids[4]!, "m", "baseline", null)];
    const g = aggregate(rs, "m", "baseline", 100);
    expect(g.records).toBe(5);
    expect(g.briefs).toBe(5);
    expect(g.coverage).toBe(0.05);
    expect(g.anyGradientRate).toBe(0.8);
    expect(g.found).toBe(4);
    expect(g.scored).toBe(4);
    expect(g.scorableRatio).toBe(1);
    expect(g.briefScore.n).toBe(4);
    expect(g.briefScore.mean).toBe(53.5);
    // bins: [0,10) has 5; [10,20) has 10; [90,100] has 99 and 100
    expect(g.histogram).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 0, 2]);
    expect(g.histogram.reduce((a, b) => a + b, 0)).toBe(g.briefScore.n);
  });

  it("computes a micro scorable ratio over gradients", () => {
    const a = rec(ids[0]!, "m", "c", 80, { found: 4, scored: 1, scorableRatio: 0.25 });
    const b = rec(ids[1]!, "m", "c", 60, { found: 1, scored: 1, scorableRatio: 1 });
    expect(aggregate([a, b], "m", "c", 100).scorableRatio).toBe(0.4);
  });

  it("counts finding-code shares over scored gradients and refine statistics", () => {
    const g = (score: number, codes: string[], d: number | null) => ({
      form: "css",
      css: "x",
      status: "scored" as const,
      score,
      findingCodes: codes,
      refine: { refined: d !== null, colourChanged: d !== null, scoreAfter: score + (d === null ? 0 : 10), meanDeltaE: d ?? 0, maxDeltaE: d ?? 0 },
    });
    const r1 = rec(ids[0]!, "m", "c", 60, { gradients: [g(60, ["a/x", "b/y"], 0.2), g(70, ["a/x"], 0.01)] });
    const r2 = rec(ids[1]!, "m", "c", 90, { gradients: [g(90, [], null)] });
    const a = aggregate([r1, r2], "m", "c", 100);
    expect(a.findingCodes).toEqual([
      { code: "a/x", gradients: 2, share: 0.6667 },
      { code: "b/y", gradients: 1, share: 0.3333 },
    ]);
    expect(a.refine).toEqual({ scoredGradients: 3, refined: 2, colourChanged: 2, colourChangedRate: 0.6667, meanDeltaE: 0.105, largeChange: 1, largeChangeRate: 0.5, meanScoreGain: 6.6667 });
  });

  it("pools when model or condition is null", () => {
    const rs = [rec(ids[0]!, "a", "baseline", 10), rec(ids[0]!, "b", "with-skill", 30)];
    expect(aggregate(rs, null, null, 100).records).toBe(2);
    expect(aggregate(rs, "a", null, 100).records).toBe(1);
    expect(aggregate(rs, null, "with-skill", 100).briefScore.mean).toBe(30);
  });

  it("empty group has nulls, not NaN", () => {
    const a = aggregate([], "m", "c", 100);
    expect(a.anyGradientRate).toBeNull();
    expect(a.scorableRatio).toBeNull();
    expect(a.briefScore.mean).toBeNull();
    expect(JSON.stringify(a)).not.toContain("NaN");
  });
});

describe("comparePairs", () => {
  const base = [60, 70, 55, 80, 65, 72, 58, 90];
  const skill = [75, 78, 65, 82, 80, 70, 70, 95];

  it("pairs by brief and reports mean difference, bootstrap interval and Wilcoxon p", () => {
    const rs = [...base.map((s, i) => rec(ids[i]!, "m", "baseline", s)), ...skill.map((s, i) => rec(ids[i]!, "m", "with-skill", s))];
    const [p] = comparePairs(rs);
    const diffs = skill.map((s, i) => s - base[i]!);
    expect(p).toMatchObject({ model: "m", baseline: "baseline", condition: "with-skill", pairedBriefs: 8, unpairedBriefs: 0, better: 7, tied: 0, worse: 1 });
    expect(p!.meanDelta).toBeCloseTo(diffs.reduce((a, b) => a + b, 0) / 8, 4);
    const ci = pairedBootstrapCI(diffs, 2000, p!.ci!.seed)!;
    expect(p!.ci).toMatchObject({ level: 0.95, resamples: 2000, lo: Math.round(ci.lo * 1e4) / 1e4, hi: Math.round(ci.hi * 1e4) / 1e4 });
    const w = wilcoxonSignedRank(diffs)!;
    expect(p!.wilcoxon).toMatchObject({ n: 8, wPlus: w.wPlus, method: "exact" });
    expect(p!.wilcoxon!.p).toBeCloseTo(w.p, 5);
  });

  it("uses the 2,000 resamples and a fixed seed", () => {
    const rs = [...base.map((s, i) => rec(ids[i]!, "m", "baseline", s)), ...skill.map((s, i) => rec(ids[i]!, "m", "with-skill", s))];
    const [p] = comparePairs(rs);
    expect(p!.ci!.resamples).toBe(2000);
    expect(comparePairs(rs)).toEqual(comparePairs([...rs].reverse()));
  });

  it("drops briefs without a scored gradient on either side and counts them as unpaired", () => {
    const rs = [rec(ids[0]!, "m", "baseline", 50), rec(ids[0]!, "m", "with-skill", 60), rec(ids[1]!, "m", "baseline", null), rec(ids[1]!, "m", "with-skill", 90), rec(ids[2]!, "m", "baseline", 40)];
    const [p] = comparePairs(rs);
    expect(p).toMatchObject({ pairedBriefs: 1, unpairedBriefs: 2, meanDelta: 10 });
    expect(p!.ci).toBeNull();
  });

  it("averages samples per brief", () => {
    const rs = [rec(ids[0]!, "m", "baseline", 50), rec(ids[0]!, "m", "baseline", 70, { sample: 1 }), rec(ids[0]!, "m", "with-skill", 80)];
    expect(comparePairs(rs)[0]).toMatchObject({ pairedBriefs: 1, meanBaseline: 60, meanDelta: 20 });
  });

  it("needs a baseline condition; other conditions are compared against it", () => {
    expect(comparePairs([rec(ids[0]!, "m", "with-skill", 50)])).toEqual([]);
    const rs = [rec(ids[0]!, "m", "baseline", 50), rec(ids[0]!, "m", "my-prompt", 55), rec(ids[0]!, "m", "with-skill", 60)];
    expect(comparePairs(rs).map((p) => p.condition)).toEqual(["with-skill", "my-prompt"]);
  });

  it("all-tied pairs give no Wilcoxon result", () => {
    const rs = [rec(ids[0]!, "m", "baseline", 50), rec(ids[1]!, "m", "baseline", 60), rec(ids[0]!, "m", "with-skill", 50), rec(ids[1]!, "m", "with-skill", 60)];
    expect(comparePairs(rs)[0]).toMatchObject({ wilcoxon: null, tied: 2, meanDelta: 0 });
  });
});

describe("buildSummary and mergeSummaries", () => {
  const info = briefInfo(DEFAULT_BRIEF_SET);
  const all = ids.flatMap((id, i) => [rec(id, "m", "baseline", 50 + i), rec(id, "m", "with-skill", 60 + i * 2)]);
  const meta = (s: string) => ({ sources: [s], diagnostics: [] });

  it("carries schema version, caveat and provenance", () => {
    const s = buildSummary(all, info, meta("a.jsonl"));
    expect(s.schemaVersion).toBe(1);
    expect(s.caveat).toMatch(/not aesthetics, brand fit or human preference/);
    expect(s.provenance).toMatchObject({ scoringModel: "v1", synthetic: false, briefSet: { count: 100, hash: info.hash } });
    expect(s.groups.map((g) => g.condition)).toEqual(["baseline", "with-skill"]);
  });

  it("sorts records deterministically regardless of input order", () => {
    expect(buildSummary([...all].reverse(), info, meta("a"))).toEqual(buildSummary(all, info, meta("a")));
  });

  it("merging disjoint halves equals scoring everything at once", () => {
    const half1 = buildSummary(all.slice(0, 10), info, meta("a.jsonl"));
    const half2 = buildSummary(all.slice(10), info, meta("b.jsonl"));
    const merged = mergeSummaries([
      { name: "a", summary: half1 },
      { name: "b", summary: half2 },
    ]);
    if ("error" in merged) throw new Error(merged.error);
    const whole = buildSummary(all, info, { sources: ["a.jsonl", "b.jsonl"], diagnostics: [] });
    expect(merged.summary).toEqual(whole);
  });

  it("a single summary merges to itself", () => {
    const s = buildSummary(all, info, meta("a.jsonl"));
    const m = mergeSummaries([{ name: "a", summary: s }]);
    expect("summary" in m && m.summary).toEqual(s);
  });

  it("rejects summaries from different brief sets or scoring models", () => {
    const s = buildSummary(all, info, meta("a"));
    const other = { ...s, provenance: { ...s.provenance, briefSet: { ...s.provenance.briefSet, hash: "deadbeefdeadbeef" } } };
    expect(mergeSummaries([{ name: "a", summary: s }, { name: "b", summary: other }])).toEqual({ error: expect.stringMatching(/brief-set hash/) });
    const v2 = { ...s, provenance: { ...s.provenance, scoringModel: "v2" } };
    expect(mergeSummaries([{ name: "a", summary: s }, { name: "b", summary: v2 }])).toEqual({ error: expect.stringMatching(/scoring model/) });
    expect(mergeSummaries([])).toEqual({ error: expect.any(String) });
  });

  it("drops duplicate records with a diagnostic", () => {
    const s = buildSummary(all, info, meta("a"));
    const m = mergeSummaries([{ name: "a", summary: s }, { name: "b", summary: s }]);
    if ("error" in m) throw new Error(m.error);
    expect(m.summary.records).toHaveLength(all.length);
    expect(m.summary.diagnostics.filter((d) => d.code === "duplicate-record")).toHaveLength(all.length);
  });

  it("flags synthetic data in the provenance", () => {
    expect(buildSummary([rec(ids[0]!, "m", "baseline", 1, { synthetic: true })], info, meta("a")).provenance.synthetic).toBe(true);
  });

  it("validateSummary accepts built summaries and rejects junk", () => {
    expect(validateSummary(buildSummary(all, info, meta("a")))).toEqual([]);
    expect(validateSummary(null)).not.toEqual([]);
    expect(validateSummary({ schemaVersion: 2 })).not.toEqual([]);
    expect(validateSummary({ schemaVersion: 1, provenance: {}, records: [{}] }).length).toBeGreaterThan(0);
  });
});
