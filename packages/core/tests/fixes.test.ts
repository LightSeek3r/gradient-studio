// proposeFixes (spec/api.md): the contract of a targeted fix, checked over
// every input of the v1 vector corpus, as engine ticks and as documents.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  hexToOklch,
  proposeFixes,
  score,
  scoreGradient,
  V1_MODEL,
  type Finding,
  type GradientDocument,
  type GradientTick,
} from "../src/index";

const corpus = JSON.parse(readFileSync(new URL("../../../spec/vectors/v1-score.json", import.meta.url), "utf8")) as {
  cases: { name: string; stops: GradientTick[] }[];
};

const RANK = { info: 0, warning: 1, error: 2 } as const;
const GAP = V1_MODEL.refine.hardStopGap;
const ACHROMATIC = V1_MODEL.refine.achromaticAtMost;

const sortStable = (ticks: readonly GradientTick[]) =>
  ticks.map((t, i) => ({ t, i })).sort((a, b) => a.t.position - b.t.position || a.i - b.i);

/** Sorted indices the finding names: its stops plus the stops on its segment. */
function named(f: Finding, sorted: GradientTick[]): Set<number> {
  const set = new Set<number>(f.stops ?? []);
  if (f.segment) sorted.forEach((t, i) => t.position >= f.segment![0] && t.position <= f.segment![1] && set.add(i));
  return set;
}

function checkContract(input: GradientTick[], fixedStops: GradientTick[], code: string, gain: number, label: string) {
  const before = scoreGradient(input);
  const after = scoreGradient(fixedStops);
  const ctx = `${JSON.stringify(input)} → ${code}`;
  expect(after.status, ctx).toBe("ok");
  // Strictly better, by exactly the advertised gain.
  expect(gain, ctx).toBeGreaterThan(0);
  expect(after.score - before.score, ctx).toBe(gain);
  // The targeted finding is gone.
  const target = before.findings.find((f) => f.code === code);
  expect(target, ctx).toBeDefined();
  expect(after.findings.map((f) => f.code), ctx).not.toContain(code);
  // Nothing got more severe; nothing new outranks what was fixed.
  for (const f of after.findings) {
    const was = before.findings.find((b) => b.code === f.code);
    expect(RANK[f.severity], `${ctx}: ${f.code}`).toBeLessThanOrEqual(was ? RANK[was.severity] : RANK[target!.severity]);
  }
  // Same count, same ids in the same array slots.
  expect(fixedStops.length, ctx).toBe(input.length);
  expect(fixedStops.map((t) => t.id), ctx).toEqual(input.map((t) => t.id));
  // Same position order.
  const orderBefore = sortStable(input);
  const orderAfter = sortStable(fixedStops);
  expect(orderAfter.map((o) => o.i), ctx).toEqual(orderBefore.map((o) => o.i));
  // Only named stops change; the rest are byte-identical.
  const sortedBefore = orderBefore.map((o) => o.t);
  const allowed = named(target!, sortedBefore);
  let changed = 0;
  orderBefore.forEach((o, k) => {
    const a = input[o.i];
    const b = fixedStops[o.i];
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    changed++;
    expect(allowed.has(k), `${ctx}: stop ${k} is not named by the finding`).toBe(true);
    expect(b.color, ctx).toMatch(/^#[0-9a-f]{6}$/);
    expect(b.position, ctx).toBeGreaterThanOrEqual(0);
    expect(b.position, ctx).toBeLessThanOrEqual(100);
    // Achromatic stays achromatic.
    if (hexToOklch(a.color).C <= ACHROMATIC) expect(hexToOklch(b.color).C, ctx).toBeLessThanOrEqual(ACHROMATIC);
  });
  expect(changed, ctx).toBeGreaterThan(0);
  // Hard stops: every close pair keeps its exact gap, and no new one appears.
  for (let k = 1; k < orderBefore.length; k++) {
    const gapBefore = orderBefore[k].t.position - orderBefore[k - 1].t.position;
    const gapAfter = orderAfter[k].t.position - orderAfter[k - 1].t.position;
    if (gapBefore <= GAP) expect(gapAfter, ctx).toBe(gapBefore);
    else expect(gapAfter, ctx).toBeGreaterThan(GAP);
  }
  expect(label.length, ctx).toBeGreaterThan(0);
}

describe("proposeFixes: contract over the vector corpus", () => {
  it("holds for every corpus input as engine ticks", () => {
    let fixes = 0;
    let findings = 0;
    const perCode = new Map<string, [number, number]>();
    for (const c of corpus.cases) {
      const before = scoreGradient(c.stops);
      const proposed = proposeFixes(c.stops);
      if (before.status !== "ok") {
        expect(proposed, c.name).toEqual([]);
        continue;
      }
      findings += before.findings.length;
      for (const f of before.findings) {
        const e = perCode.get(f.code) ?? [0, 0];
        e[1]++;
        perCode.set(f.code, e);
      }
      // At most one fix per finding, in finding order.
      const codes = proposed.map((f) => f.code);
      expect(new Set(codes).size, c.name).toBe(codes.length);
      expect(codes, c.name).toEqual(before.findings.map((f) => f.code).filter((code) => codes.includes(code)));
      for (const fix of proposed) {
        fixes++;
        perCode.get(fix.code)![0]++;
        checkContract(c.stops, fix.document, fix.code, fix.gain, fix.label);
        expect(fix.before.status === "ok" && fix.after.status === "ok" && fix.after.score - fix.before.score, c.name).toBe(fix.gain);
        // changedStops names exactly the edited input slots.
        const diff = c.stops.map((t, i) => (JSON.stringify(t) === JSON.stringify(fix.document[i]) ? -1 : i)).filter((i) => i >= 0);
        expect(fix.changedStops, c.name).toEqual(diff);
        // Untouched stops are the caller's own objects.
        c.stops.forEach((t, i) => !diff.includes(i) && expect(fix.document[i]).toBe(t));
      }
    }
    // The search is useful, not just safe: most findings in the corpus get a fix.
    expect(findings).toBeGreaterThan(100);
    expect(fixes / findings).toBeGreaterThan(0.5);
    // Every code the corpus exercises is fixable at least once.
    for (const [code, [fixed, seen]] of perCode) expect(fixed, `${code} (${seen} findings)`).toBeGreaterThan(0);
  });

  it("holds for every corpus input as a document", () => {
    for (const c of corpus.cases) {
      const sorted = sortStable(c.stops).map((o) => o.t);
      const doc: GradientDocument = {
        kind: "linear",
        angle: 135,
        interpolation: { space: "oklab" },
        stops: sorted.map((t) => ({ color: t.color, position: t.position / 100, id: `s${t.id}` })),
      };
      const before = score(doc);
      const proposed = proposeFixes(doc);
      if (before.status !== "ok") {
        expect(proposed, c.name).toEqual([]);
        continue;
      }
      for (const fix of proposed) {
        expect(fix.document.angle).toBe(135);
        expect(fix.document.interpolation).toEqual({ space: "oklab" });
        expect(fix.document.stops.map((s) => s.id)).toEqual(doc.stops.map((s) => s.id));
        const ticks = (d: GradientDocument) =>
          d.stops.map((s, i) => ({ id: i, color: s.color, position: Math.round(s.position! * 1e12) / 1e10 }));
        checkContract(ticks(doc), ticks(fix.document), fix.code, fix.gain, fix.label);
        expect(fix.after).toEqual(score(fix.document));
        doc.stops.forEach((s, i) => !fix.changedStops.includes(i) && expect(fix.document.stops[i]).toBe(s));
      }
    }
  });
});

describe("proposeFixes: behaviour", () => {
  const ticks = (...stops: [string, number][]): GradientTick[] => stops.map(([color, position], i) => ({ id: i + 1, color, position }));

  it("fixes the spec's lightness-reversal example by editing only the dipping stop", () => {
    const input = ticks(["#e0e7ff", 0], ["#1e1b4b", 50], ["#c7d2fe", 100]);
    const fix = proposeFixes(input).find((f) => f.code === "lightness/reversal");
    expect(fix).toBeDefined();
    expect(fix!.changedStops).toEqual([1]);
    expect(fix!.kind).toBe("lightness");
    expect(fix!.label).toBe("Make stop 2 lighter");
    expect(fix!.gain).toBeGreaterThan(0);
  });

  it("moves short stops to the edges", () => {
    const fix = proposeFixes(ticks(["#ff0000", 32], ["#ffa500", 67])).find((f) => f.code === "rhythm/edge-gap");
    expect(fix).toBeDefined();
    expect(fix!.kind).toBe("position");
  });

  it("is deterministic and does not modify its input", () => {
    const input = ticks(["#ff0000", 0], ["#00ff00", 35], ["#0000ff", 100]);
    const copy = JSON.stringify(input);
    const a = proposeFixes(input);
    const b = proposeFixes(input);
    expect(JSON.stringify(input)).toBe(copy);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.length).toBeGreaterThan(0);
  });

  it("numbers stops in position order whatever the array order", () => {
    const input = ticks(["#c7d2fe", 100], ["#1e1b4b", 50], ["#e0e7ff", 0]);
    const fix = proposeFixes(input).find((f) => f.code === "lightness/reversal")!;
    expect(fix.changedStops).toEqual([1]);
    expect(fix.document[0]).toBe(input[0]);
  });

  it("returns [] for clean, unscorable or malformed input and never throws", () => {
    expect(proposeFixes(ticks(["#ffa500", 0], ["#800080", 100]))).toEqual([]);
    expect(proposeFixes(ticks(["#ffa500", 0]))).toEqual([]);
    expect(proposeFixes(ticks(["red", 0], ["#800080", 100]))).toEqual([]);
    for (const bad of [null, undefined, 42, "x", {}, { stops: 3 }, [null, 1], { kind: "linear", angle: 0, stops: [{}, {}] }]) {
      expect(() => proposeFixes(bad as never)).not.toThrow();
      expect(proposeFixes(bad as never)).toEqual([]);
    }
    const translucent: GradientDocument = { kind: "linear", angle: 0, stops: [{ color: "#ff0000", alpha: 0.5 }, { color: "#00ff00" }] };
    expect(proposeFixes(translucent)).toEqual([]);
  });

  it("leaves positions alone when a document has automatic positions", () => {
    const doc: GradientDocument = { kind: "linear", angle: 0, stops: [{ color: "#e0e7ff" }, { color: "#1e1b4b" }, { color: "#c7d2fe" }] };
    const proposed = proposeFixes(doc);
    expect(proposed.length).toBeGreaterThan(0);
    for (const fix of proposed) {
      expect(fix.kind).not.toBe("position");
      for (const s of fix.document.stops) expect(s.position).toBeUndefined();
    }
  });

  it("never moves a hard stop", () => {
    const input = ticks(["#ff0000", 20], ["#0000ff", 20], ["#00ff00", 60]);
    for (const fix of proposeFixes(input)) {
      expect(fix.document[0].position).toBe(20);
      expect(fix.document[1].position).toBe(20);
    }
  });
});
