import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF_SET } from "../src/briefs";
import { CAVEAT, SYNTHETIC_NOTICE } from "../src/constants";
import { esc, fmtNum, fmtP, fmtPct, fmtSigned, ranked, renderHtml, renderMarkdown } from "../src/report";
import { parseResults } from "../src/results";
import { scoreOutput, scoreRecords } from "../src/run";
import { briefInfo, buildSummary, type Summary } from "../src/summary";
import { here, readText } from "./helpers";

function build(text: string): Summary {
  const parsed = parseResults(text, "synthetic-results.jsonl");
  const scored = scoreRecords(parsed.records, DEFAULT_BRIEF_SET, {}, "synthetic-results.jsonl");
  return buildSummary(scored.records, briefInfo(DEFAULT_BRIEF_SET), { sources: ["synthetic-results.jsonl"], diagnostics: [...parsed.diagnostics, ...scored.diagnostics] });
}

const resultsText = readText("examples/synthetic-results.jsonl");
const summary = build(resultsText);

function golden(path: string, actual: string): string {
  // UPDATE_GOLDEN=1 npx vitest run tests/report.test.ts rewrites the committed example outputs.
  if (process.env.UPDATE_GOLDEN === "1") writeFileSync(here(path), actual);
  return readText(path);
}

describe("synthetic example: golden files", () => {
  it("summary.json is reproduced exactly", () => {
    const actual = JSON.stringify(summary, null, 2) + "\n";
    expect(actual).toBe(golden("examples/synthetic-report/summary.json", actual));
  });

  it("report.md is reproduced exactly", () => {
    const actual = renderMarkdown(summary);
    expect(actual).toBe(golden("examples/synthetic-report/report.md", actual));
  });

  it("leaderboard.html is reproduced exactly", () => {
    const actual = renderHtml(summary);
    expect(actual).toBe(golden("examples/synthetic-report/leaderboard.html", actual));
  });

  it("every example record is marked synthetic", () => {
    expect(parseResults(resultsText, "x").records.every((r) => r.synthetic)).toBe(true);
    expect(summary.provenance.synthetic).toBe(true);
  });
});

describe("determinism", () => {
  it("same input, same bytes, regardless of line order", () => {
    const shuffled = resultsText.trim().split("\n").reverse().join("\n") + "\n";
    const other = build(shuffled);
    expect(renderMarkdown(other)).toBe(renderMarkdown(summary));
    expect(renderHtml(other)).toBe(renderHtml(summary));
    expect(JSON.stringify(other)).toBe(JSON.stringify(summary));
  });

  it("outputs contain no dates, hostnames or absolute paths", () => {
    for (const text of [JSON.stringify(summary), renderMarkdown(summary), renderHtml(summary)]) {
      expect(text).not.toMatch(/20\d\d-\d\d-\d\d/);
      expect(text).not.toMatch(/\/home\/|\/Users\/|C:\\/);
    }
  });
});

describe("caveat and provenance are always present", () => {
  const empty = buildSummary([], briefInfo(DEFAULT_BRIEF_SET), { sources: [], diagnostics: [] });
  for (const [name, s] of [["example", summary], ["empty", empty]] as const) {
    it(`${name}: markdown, html and json carry the verbatim caveat`, () => {
      expect(s.caveat).toBe(CAVEAT);
      expect(renderMarkdown(s)).toContain(CAVEAT);
      expect(renderHtml(s)).toContain(esc(CAVEAT));
    });

    it(`${name}: provenance lists bench version, scoring model, core version and brief-set hash`, () => {
      const hash = briefInfo(DEFAULT_BRIEF_SET).hash;
      for (const text of [renderMarkdown(s), renderHtml(s)]) {
        expect(text).toContain(hash);
        expect(text).toMatch(/Scoring model/);
        expect(text).toMatch(/Core version/);
        expect(text).toMatch(/Bench version/);
      }
      expect(s.provenance).toMatchObject({ benchVersion: expect.any(String), scoringModel: "v1", coreVersion: expect.any(String) });
    });
  }

  it("the caveat text is the one required by the plan", () => {
    expect(CAVEAT).toBe("Measures perceptual smoothness by the Opal42 v1 definition - not aesthetics, brand fit or human preference; the same metric drives the refine step, so with-skill gains are expected by construction and are not validation of the metric.");
  });

  it("synthetic data carries an extra notice; real data does not", () => {
    expect(renderMarkdown(summary)).toContain(SYNTHETIC_NOTICE);
    expect(renderHtml(summary)).toContain(esc(SYNTHETIC_NOTICE));
    const real = build(resultsText.replaceAll('"synthetic":true,', ""));
    expect(real.provenance.synthetic).toBe(false);
    expect(renderMarkdown(real)).not.toContain("SYNTHETIC");
    expect(renderHtml(real)).not.toContain("SYNTHETIC");
  });

  it("the report functions take no options that could drop the caveat", () => {
    expect(renderMarkdown.length).toBe(1);
    expect(renderHtml.length).toBe(1);
  });
});

describe("report content", () => {
  it("markdown has the per-model/condition, pooled and paired tables", () => {
    const md = renderMarkdown(summary);
    for (const h of ["## Results by model and condition", "## By condition", "## By model", "## Paired comparison against the baseline condition", "## Most frequent finding codes", "## How much would refine change the colours", "## Limits"]) expect(md).toContain(h);
    expect(md).toMatch(/synthetic-model-a \| with-skill/);
    expect(md).toMatch(/Wilcoxon p/);
    expect(md).toMatch(/exact, n=9/);
  });

  const odd = (model: string, condition: string) =>
    buildSummary([scoreOutput({ briefId: "saas-hero-01", model, condition, sample: 0, synthetic: false, output: "linear-gradient(#fff,#000)" }, "saas-hero", {})], briefInfo(DEFAULT_BRIEF_SET), { sources: [], diagnostics: [] });

  it("markdown escapes pipes and markup in names", () => {
    const md = renderMarkdown(odd("a|b *x*", "c"));
    expect(md).toContain("a\\|b \\*x\\*");
    expect(renderHtml(odd("a|b *x*", "c"))).toContain("a|b *x*");
  });

  it("html escapes model and condition names", () => {
    const html = renderHtml(odd("<script>alert(1)</script>", 'c"onload="x'));
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain('c"onload=');
  });

  it("empty summaries render without tables or NaN", () => {
    const s = buildSummary([], briefInfo(DEFAULT_BRIEF_SET), { sources: [], diagnostics: [] });
    for (const t of [renderMarkdown(s), renderHtml(s).replace(/<script>[\s\S]*?<\/script>/, "")]) {
      expect(t).toContain("No records were scored.");
      expect(t).not.toMatch(/NaN|undefined|\[object/);
    }
  });

  it("shows diagnostics", () => {
    const parsed = parseResults(resultsText + "{bad\n", "synthetic-results.jsonl");
    const s = buildSummary(scoreRecords(parsed.records, DEFAULT_BRIEF_SET).records, briefInfo(DEFAULT_BRIEF_SET), { sources: [], diagnostics: parsed.diagnostics });
    expect(renderMarkdown(s)).toMatch(/## Diagnostics/);
    expect(renderHtml(s)).toMatch(/invalid-json/);
  });

  it("ranks by mean score, highest first, with missing scores last", () => {
    const order = ranked(summary.groups).map((g) => `${g.model}/${g.condition}`);
    expect(order).toEqual(["synthetic-model-a/with-skill", "synthetic-model-b/with-skill", "synthetic-model-b/baseline", "synthetic-model-a/baseline"]);
    const withNull = ranked([{ ...summary.groups[0]!, briefScore: { ...summary.groups[0]!.briefScore, mean: null } }, summary.groups[1]!]);
    expect(withNull[1]!.briefScore.mean).toBeNull();
  });
});

describe("formatters", () => {
  it("format numbers, percentages, p-values", () => {
    expect(fmtNum(null)).toBe("n/a");
    expect(fmtNum(12.345)).toBe("12.3");
    expect(fmtNum(0.04567, 3)).toBe("0.046");
    expect(fmtPct(0.8333)).toBe("83.3%");
    expect(fmtPct(null)).toBe("n/a");
    expect(fmtP(0.00001)).toBe("<0.0001");
    expect(fmtP(0.0391)).toBe("0.0391");
    expect(fmtSigned(3)).toBe("+3.0");
    expect(fmtSigned(-3)).toBe("-3.0");
    expect(fmtSigned(0)).toBe("0.0");
  });
});
