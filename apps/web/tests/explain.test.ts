import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { V1_FINDING_CODES, V1_MODEL, scoreGradient, type Finding, type GradientTick } from "@opal42/gradient";
import { DIMENSIONS, RULE_TEXT, ruleText } from "../src/explain/explain";
import { buildLedger, ledgerEquation, ledgerSentence, locationText } from "../src/explain/ledger";
import { EXAMPLES, exampleDocument, exampleTicks, findExample } from "../src/examples";
import { issueHash, issueLink, parseIssueHash } from "../src/persist/issue-link";
import { decodeDocument, encodeDocument } from "../src/persist/url-codec";
import { deltaSentence, formatDelta, scoreBand } from "../src/score-band";
import { curvePath, describeTrend, sampleCurves, unwrapHues } from "../src/explain/curves";
import { layoutLane } from "../src/explain/lane";
import type { LedgerRow } from "../src/explain/ledger";

const MODEL_CODES = Object.keys(V1_FINDING_CODES).sort();
const ticks = (...stops: [string, number][]): GradientTick[] => stops.map(([color, position], i) => ({ id: i + 1, color, position }));

describe("explain: one text per rule", () => {
  it("covers exactly the codes of the v1 model", () => {
    expect(Object.keys(RULE_TEXT).sort()).toEqual(MODEL_CODES);
  });

  it("covers every code that has a section in spec/scoring-v1.md", () => {
    const spec = readFileSync(new URL("../../../spec/scoring-v1.md", import.meta.url), "utf8");
    const specCodes = [...spec.matchAll(/^### `([a-z]+\/[a-z-]+)`/gm)].map((m) => m[1]).sort();
    expect(specCodes).toEqual(MODEL_CODES);
    for (const code of specCodes) expect(RULE_TEXT[code], code).toBeDefined();
  });

  it("gives each rule a short name and one plain sentence, without verdict words", () => {
    const names = new Set<string>();
    for (const code of MODEL_CODES) {
      const t = RULE_TEXT[code];
      expect(t.name.length, code).toBeGreaterThan(3);
      expect(t.name.length, code).toBeLessThanOrEqual(28);
      expect(t.name, code).toBe(t.name.toLowerCase());
      expect(names.has(t.name), `duplicate name ${t.name}`).toBe(false);
      names.add(t.name);
      expect(t.measures, code).toMatch(/^[A-Z].*\.$/);
      expect(t.measures.length, code).toBeLessThanOrEqual(190);
      expect(`${t.name} ${t.measures}`, code).not.toMatch(/\b(bad|poor|ugly|wrong|excellent|good|quality|fail)\b/i);
    }
  });

  it("falls back safely for an unknown code", () => {
    expect(ruleText("future/new-rule").name).toBe("new rule");
    expect(ruleText("constructor").measures).toMatch(/deduction/);
    expect(ruleText(undefined as never).name).toBe("deduction");
  });

  it("lists the four dimensions with the model's budgets", () => {
    expect(DIMENSIONS.map((d) => d.key).sort()).toEqual(Object.keys(V1_MODEL.weights).sort());
  });
});

describe("examples: one per rule, each triggering its rule", () => {
  it("has exactly one example per code of the model", () => {
    expect(EXAMPLES.map((e) => e.code).sort()).toEqual(MODEL_CODES);
  });

  for (const code of MODEL_CODES) {
    it(`${code} is triggered by its example`, () => {
      const example = findExample(code);
      expect(example, `no example for ${code}`).not.toBeNull();
      const result = scoreGradient(exampleTicks(example!));
      expect(result.status).toBe("ok");
      expect(result.findings.map((f) => f.code)).toContain(code);
    });
  }

  it("examples are small, sorted, and survive the URL codec", () => {
    for (const e of EXAMPLES) {
      expect(e.stops.length).toBeGreaterThanOrEqual(2);
      expect(e.stops.length).toBeLessThanOrEqual(4);
      const positions = e.stops.map((s) => s[1]);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      const doc = exampleDocument(e);
      expect(decodeDocument(encodeDocument(doc))).toEqual(doc);
    }
  });

  it("findExample ignores unknown input", () => {
    for (const bad of ["", "nope", "lightness", "lightness/", null, undefined, 3, {}, "__proto__"]) {
      expect(findExample(bad)).toBeNull();
    }
  });
});

describe("issue links", () => {
  it("round-trips every code", () => {
    for (const code of MODEL_CODES) {
      expect(parseIssueHash(issueHash(code))).toBe(code);
      expect(parseIssueHash(issueHash(code).slice(1))).toBe(code);
      expect(parseIssueHash(`#issue=${encodeURIComponent(code)}`)).toBe(code);
    }
  });

  it("ignores unknown codes and malformed fragments without throwing", () => {
    for (const bad of [
      "",
      "#",
      "#issue=",
      "#issue=nope/nothing",
      "#issue=lightness/reversal;x",
      "#issue=%E0%A4%A",
      "#ISSUE=lightness/reversal",
      "#v1;s=101b45@0,9333ea@100",
      `#issue=${"a".repeat(500)}`,
      null,
      undefined,
      42,
    ]) {
      expect(parseIssueHash(bad)).toBeNull();
    }
  });

  it("does not collide with document links", () => {
    for (const code of MODEL_CODES) expect(decodeDocument(issueHash(code))).toBeNull();
    expect(parseIssueHash(`#${encodeDocument(exampleDocument(EXAMPLES[0]))}`)).toBeNull();
  });

  it("builds a full link from a location", () => {
    expect(issueLink("hue/wide-arc", { origin: "https://example.test", pathname: "/app/", search: "?x=1" })).toBe(
      "https://example.test/app/?x=1#issue=hue/wide-arc",
    );
  });
});

describe("ledger arithmetic", () => {
  it("is 100 with no deductions", () => {
    const s = scoreGradient(ticks(["#ffa500", 0], ["#800080", 100]));
    const ledger = buildLedger(s.findings, s.score);
    expect(ledger.rows).toEqual([]);
    expect(ledger.total).toBe(100);
    expect(ledgerEquation(ledger)).toBe("100 = 100");
    expect(ledgerSentence(ledger)).toBe("100 points, no deductions.");
  });

  it("sorts by loss and adds up without clamping (red, lime, blue = 58)", () => {
    const s = scoreGradient(ticks(["#ff0000", 0], ["#00ff00", 50], ["#0000ff", 100]));
    const ledger = buildLedger(s.findings, s.score);
    expect(ledger.rows.map((r) => [r.code, r.pointsLost])).toEqual([
      ["hue/wide-arc", 20],
      ["lightness/reversal", 12],
      ["chroma/muddy-midpoint", 10],
    ]);
    expect(ledger.floors).toEqual([]);
    expect(ledger.nominal).toBe(42);
    expect(ledger.total).toBe(58);
    expect(ledger.balanced).toBe(true);
    expect(ledgerEquation(ledger)).toBe("100 − 20 − 12 − 10 = 58");
    expect(ledgerSentence(ledger)).toBe(
      "100 minus 20 for wide hue arc, minus 12 for lightness reversal, minus 10 for muddy midpoint, equals 58.",
    );
  });

  it("shows the floor when a dimension's penalties exceed its budget", () => {
    // Three lightness reversals (36) in a 30-point dimension.
    const s = scoreGradient(ticks(["#ffffff", 0], ["#000000", 25], ["#ffffff", 50], ["#000000", 75], ["#ffffff", 100]));
    const ledger = buildLedger(s.findings, s.score);
    const lightness = ledger.floors.find((f) => f.dimension === "lightness");
    expect(lightness).toBeDefined();
    expect(lightness!.nominal).toBeGreaterThan(30);
    expect(lightness!.absorbed).toBe(lightness!.nominal - 30);
    expect(ledger.nominal).toBeGreaterThan(100 - s.score);
    expect(ledger.absorbed).toBe(ledger.nominal - (100 - s.score));
    expect(ledger.total).toBe(s.score);
    expect(ledger.balanced).toBe(true);
    expect(ledgerEquation(ledger)).toContain(`+ ${lightness!.absorbed} (lightness flow floor 0)`);
    expect(ledgerEquation(ledger).endsWith(`= ${s.score}`)).toBe(true);
    expect(ledgerSentence(ledger)).toContain("cannot go below 0");
  });

  it("balances for every corpus input, and the dimension summary matches the engine", () => {
    const corpus = JSON.parse(readFileSync(new URL("../../../spec/vectors/v1-score.json", import.meta.url), "utf8")) as {
      cases: { stops: GradientTick[] }[];
    };
    let clamped = 0;
    for (const c of corpus.cases) {
      const s = scoreGradient(c.stops);
      if (s.status !== "ok") continue;
      const ledger = buildLedger(s.findings, s.score);
      expect(ledger.balanced).toBe(true);
      if (ledger.floors.length) clamped++;
      const kept = Object.fromEntries(ledger.dimensions.map((d) => [d.dimension, d.kept]));
      expect(kept).toEqual({ lightness: s.details.lightness, hue: s.details.hue, chroma: s.details.chroma, rhythm: s.details.spacing });
      for (let i = 1; i < ledger.rows.length; i++) expect(ledger.rows[i - 1].pointsLost).toBeGreaterThanOrEqual(ledger.rows[i].pointsLost);
    }
    expect(clamped).toBeGreaterThan(0);
  });

  it("describes locations", () => {
    expect(locationText({ stops: [1] })).toBe("stop 2");
    expect(locationText({ stops: [0, 2] })).toBe("stops 1 and 3");
    expect(locationText({ stops: [0, 1, 3] })).toBe("stops 1, 2 and 4");
    expect(locationText({ segment: [0, 35] })).toBe("0%–35%");
    expect(locationText({ stops: [0, 1], segment: [0, 5] })).toBe("stops 1 and 2, 0%–5%");
    expect(locationText({})).toBe("");
  });

  it("names an unknown future code instead of failing", () => {
    const f: Finding = { code: "future/thing", severity: "info", dimension: "hue", pointsLost: 3, message: "m" };
    expect(buildLedger([f], 97).rows[0].name).toBe("thing");
  });
});

describe("score band and delta wording", () => {
  it("uses neutral descriptions, never verdicts", () => {
    const labels = [100, 80, 79, 65, 64, 45, 44, 0].map((s) => scoreBand(s).label);
    expect(labels).toEqual(["smooth", "smooth", "mostly smooth", "mostly smooth", "uneven", "uneven", "rough", "rough"]);
    for (const s of [0, 50, 70, 100]) {
      expect(scoreBand(s).label).not.toMatch(/excellent|good|fair|poor|bad|fail|pass/i);
      expect(scoreBand(s).color).toMatch(/^var\(--band-[1-4]\)$/);
    }
  });

  it("formats deltas with a real minus sign", () => {
    expect(formatDelta(3)).toBe("+3");
    expect(formatDelta(-7)).toBe("−7");
    expect(formatDelta(0)).toBe("±0");
    expect(deltaSentence(58, 61)).toBe("Score up 3, now 61");
    expect(deltaSentence(58, 51)).toBe("Score down 7, now 51");
    expect(deltaSentence(58, 58)).toBe("");
  });
});

describe("curves", () => {
  it("unwraps hue across 0°/360° and keeps greys undefined", () => {
    expect(unwrapHues([350, 355, 5, 15])).toEqual([350, 355, 365, 375]);
    expect(unwrapHues([10, 350])).toEqual([10, -10]);
    expect(unwrapHues([null, 20, null, 40])).toEqual([null, 20, null, 40]);
  });

  it("describes trends, ignoring small wiggles", () => {
    expect(describeTrend([0, 0.2, 0.5, 1], 0.02)).toBe("rises");
    expect(describeTrend([1, 0.5, 0.2], 0.02)).toBe("falls");
    expect(describeTrend([0.5, 0.505, 0.5], 0.02)).toBe("flat");
    expect(describeTrend([0.9, 0.3, 0.8], 0.02)).toBe("dips, then rises");
    expect(describeTrend([0.2, 0.9, 0.3], 0.02)).toBe("peaks, then falls");
    expect(describeTrend([0, 1, 0, 1, 0], 0.02)).toBe("changes direction 3 times");
    expect(describeTrend([null, null], 0.02)).toBe("undefined");
  });

  it("shows a lightness reversal as a dip and a muddy midpoint as a chroma trough", () => {
    const dip = sampleCurves(ticks(["#e0e7ff", 0], ["#1e1b4b", 50], ["#c7d2fe", 100]))!;
    expect(dip.curves[0].trend).toBe("dips, then rises");
    const muddy = sampleCurves(ticks(["#00ff00", 0], ["#ff00ff", 100]))!;
    const chroma = muddy.curves[1];
    expect(chroma.trend).toBe("dips, then rises");
    expect(chroma.min!).toBeLessThan(0.05);
    // The grey middle has no hue: the hue line has a gap there.
    expect(muddy.curves[2].values.some((v) => v === null)).toBe(true);
  });

  it("handles a fully grey gradient", () => {
    const grey = sampleCurves(ticks(["#000000", 0], ["#ffffff", 100]))!;
    expect(grey.curves[2].min).toBeNull();
    expect(grey.curves[2].summary).toMatch(/grey/);
    expect(grey.curves[0].trend).toBe("rises");
    expect(grey.xs[0]).toBe(0);
    expect(grey.xs[grey.xs.length - 1]).toBe(100);
  });

  it("returns null for unsampleable input", () => {
    expect(sampleCurves([])).toBeNull();
    expect(sampleCurves(ticks(["#000000", 0]))).toBeNull();
    expect(sampleCurves(ticks(["nope", 0], ["#ffffff", 100]))).toBeNull();
  });

  it("builds path data with gaps", () => {
    expect(curvePath([0, 50, 100], [0, 1, 0], [0, 1], 100, 10)).toBe("M0.00 10.00L50.00 0.00L100.00 10.00");
    expect(curvePath([0, 50, 100], [0, null, 1], [0, 1], 100, 10)).toBe("M0.00 10.00M100.00 0.00");
    expect(curvePath([0, 100], [5, 5], [5, 5], 100, 10)).toBe("M0.00 10.00L100.00 10.00");
  });
});

describe("issue lane layout", () => {
  const row = (code: string, pointsLost: number, extra: Partial<LedgerRow>): LedgerRow => ({
    code,
    name: code,
    measures: "",
    severity: "info",
    dimension: "hue",
    pointsLost,
    message: "",
    ...extra,
  });

  it("stacks overlapping findings into rows and keeps separate ones on one row", () => {
    const layout = layoutLane(
      [
        row("a", 20, { stops: [0, 2] }),
        row("b", 12, { stops: [1] }),
        row("c", 10, { stops: [1, 2], segment: [50, 100] }),
        row("d", 4, { segment: [0, 20] }),
      ],
      [0, 50, 100],
    );
    expect(layout.marks.map((m) => [m.code, m.row, m.start, m.end, m.bracket])).toEqual([
      ["a", 0, 0, 100, false],
      ["b", 1, 50, 50, false],
      ["c", 2, 50, 100, true],
      ["d", 1, 0, 20, true],
    ]);
    expect(layout.rows).toBe(3);
    expect(layout.overflow).toBe(0);
  });

  it("caps the rows, counts the overflow and skips unlocated findings", () => {
    const rows = [1, 2, 3].map((n) => row(`r${n}`, 10 - n, { segment: [0, 100] }));
    const layout = layoutLane([...rows, row("nowhere", 1, {}), row("bad", 1, { stops: [9] })], [0, 100], 2);
    expect(layout.marks.map((m) => m.code)).toEqual(["r1", "r2"]);
    expect(layout.overflow).toBe(1);
  });
});
