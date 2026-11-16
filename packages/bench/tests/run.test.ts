import { score } from "@opal42/gradient";
import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF_SET } from "../src/briefs";
import { parseResults, type ResultRecord } from "../src/results";
import { deltaEOK, scoreOutput, scoreRecords } from "../src/run";

const rec = (briefId: string, output: string, extra: Partial<ResultRecord> = {}): ResultRecord => ({ briefId, model: "m", condition: "baseline", sample: 0, synthetic: false, output, ...extra });

describe("parseResults", () => {
  const good = JSON.stringify({ briefId: "saas-hero-01", model: "m", condition: "baseline", output: "x" });

  it("reads lines, ignores blanks and a BOM, tolerates CRLF", () => {
    const r = parseResults(`\uFEFF${good}\r\n\r\n${good.replace("baseline", "with-skill")}\r\n`, "f.jsonl");
    expect(r.diagnostics).toEqual([]);
    expect(r.records.map((x) => x.condition)).toEqual(["baseline", "with-skill"]);
    expect(r.records[0]).toMatchObject({ sample: 0, synthetic: false });
  });

  it("reads optional sample and synthetic", () => {
    const r = parseResults(JSON.stringify({ briefId: "a-01", model: "m", condition: "c", output: "", sample: 3, synthetic: true }), "f");
    expect(r.records[0]).toMatchObject({ sample: 3, synthetic: true, output: "" });
  });

  it.each([
    ["not json", "{nope", "invalid-json"],
    ["array", "[1]", "invalid-line"],
    ["missing model", JSON.stringify({ briefId: "a-01", condition: "c", output: "" }), "invalid-field"],
    ["bad condition chars", JSON.stringify({ briefId: "a-01", model: "m", condition: "a\nb", output: "" }), "invalid-field"],
    ["output not a string", JSON.stringify({ briefId: "a-01", model: "m", condition: "c", output: 5 }), "invalid-field"],
    ["negative sample", JSON.stringify({ briefId: "a-01", model: "m", condition: "c", output: "", sample: -1 }), "invalid-field"],
    ["synthetic not boolean", JSON.stringify({ briefId: "a-01", model: "m", condition: "c", output: "", synthetic: "yes" }), "invalid-field"],
  ])("reports a diagnostic with a line number: %s", (_n, line, code) => {
    const r = parseResults(`${good}\n${line}`, "f.jsonl");
    expect(r.records).toHaveLength(1);
    expect(r.diagnostics).toEqual([expect.objectContaining({ source: "f.jsonl", line: 2, code })]);
  });
});

describe("deltaEOK", () => {
  it("is 0 for equal colours and about 1 for black to white", () => {
    expect(deltaEOK("#336699", "#336699")).toBe(0);
    expect(deltaEOK("#000000", "#ffffff")).toBeCloseTo(1, 3);
  });
  it("is symmetric", () => {
    expect(deltaEOK("#ff0000", "#00ff00")).toBeCloseTo(deltaEOK("#00ff00", "#ff0000"), 12);
  });
});

describe("scoreOutput", () => {
  it("scores each gradient with the core score and aggregates per brief", () => {
    const a = "linear-gradient(90deg, #ff0000, #00ff00, #0000ff)";
    const b = "linear-gradient(#ffffff, #eeeeee)";
    const r = scoreOutput(rec("saas-hero-01", `${a}\n${b}`), "saas-hero", {});
    const sa = score({ kind: "linear", angle: 90, stops: [{ color: "#ff0000" }, { color: "#00ff00" }, { color: "#0000ff" }] });
    const sb = score({ kind: "linear", angle: 180, stops: [{ color: "#ffffff" }, { color: "#eeeeee" }] });
    if (sa.status !== "ok" || sb.status !== "ok") throw new Error("fixture must be scorable");
    expect(r.found).toBe(2);
    expect(r.scored).toBe(2);
    expect(r.anyGradientFound).toBe(true);
    expect(r.scorableRatio).toBe(1);
    expect(r.minScore).toBe(Math.min(sa.score, sb.score));
    expect(r.meanScore).toBeCloseTo((sa.score + sb.score) / 2, 4);
    expect(r.gradients.map((g) => g.score)).toEqual([sa.score, sb.score]);
    expect(r.gradients[0]!.findingCodes).toEqual([...new Set(sa.issues.map((i) => i.code))].sort());
  });

  it("counts finding codes once per gradient", () => {
    const g = "linear-gradient(90deg, #ff0000, #00ff00, #0000ff)";
    const r = scoreOutput(rec("saas-hero-01", `${g}\n.x{background:linear-gradient(90deg,#ff0000,#00ff00,#0000ee)}`), "saas-hero", {});
    for (const [code, n] of Object.entries(r.findingCodes)) {
      expect(n, code).toBeLessThanOrEqual(r.scored);
      expect(n).toBeGreaterThan(0);
    }
    expect(Object.keys(r.findingCodes)).toEqual([...Object.keys(r.findingCodes)].sort());
  });

  it("separates skipped (parser) from unscorable (core) from scored", () => {
    const out = [
      "linear-gradient(#fff, #000)",
      "radial-gradient(#fff, #000)",
      "linear-gradient(rgba(0,0,0,.5), transparent)",
      "linear-gradient(var(--x), #000)",
    ].join("\n");
    const r = scoreOutput(rec("saas-hero-01", out), "saas-hero", {});
    expect(r.gradients.map((g) => g.status)).toEqual(["scored", "skipped", "unscorable", "skipped"]);
    expect(r.gradients.map((g) => g.code)).toEqual([undefined, "unsupported-kind", "alpha", "var"]);
    expect(r.found).toBe(4);
    expect(r.scored).toBe(1);
    expect(r.scorableRatio).toBe(0.25);
  });

  it("handles outputs without gradients", () => {
    const r = scoreOutput(rec("saas-hero-01", "no gradient"), "saas-hero", {});
    expect(r).toMatchObject({ found: 0, scored: 0, anyGradientFound: false, scorableRatio: null, minScore: null, meanScore: null, colourChangedCount: 0, meanRefineDeltaE: null });
  });

  it("reports how much refine changes the colours", () => {
    const changed = scoreOutput(rec("saas-hero-01", "linear-gradient(90deg, #ff0000, #00ff00, #0000ff)"), "saas-hero", {}).gradients[0]!;
    expect(changed.refine!.scoreAfter).toBeGreaterThanOrEqual(changed.score!);
    if (changed.refine!.colourChanged) {
      expect(changed.refine!.meanDeltaE).toBeGreaterThan(0);
      expect(changed.refine!.maxDeltaE).toBeGreaterThanOrEqual(changed.refine!.meanDeltaE);
    }
    // Black to white has nothing to fix: refine may rewrite positions but moves no colour.
    const same = scoreOutput(rec("saas-hero-01", "linear-gradient(#ffffff, #000000)"), "saas-hero", {}).gradients[0]!;
    expect(same.refine).toMatchObject({ colourChanged: false, meanDeltaE: 0, maxDeltaE: 0 });
    expect(scoreOutput(rec("saas-hero-01", "linear-gradient(#ffffff, #000000)"), "saas-hero", {}).colourChangedCount).toBe(0);
  });

  it("is deterministic", () => {
    const o = "```css\nlinear-gradient(135deg,#7f00ff,#e100ff,#00c6ff)\n```";
    expect(scoreOutput(rec("saas-hero-01", o), "saas-hero", {})).toEqual(scoreOutput(rec("saas-hero-01", o), "saas-hero", {}));
  });
});

describe("scoreRecords", () => {
  it("ignores unknown briefs and duplicates with diagnostics", () => {
    const r = scoreRecords(
      [rec("saas-hero-01", "linear-gradient(#fff,#000)"), rec("nope-01", "x"), rec("saas-hero-01", "linear-gradient(#fff,#111)"), rec("saas-hero-01", "linear-gradient(#fff,#222)", { sample: 1 })],
      DEFAULT_BRIEF_SET,
      {},
      "f.jsonl",
    );
    expect(r.records).toHaveLength(2);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["unknown-brief", "duplicate-record"]);
    expect(r.records[0]!.category).toBe("saas-hero");
  });
});
