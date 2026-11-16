import { describe, expect, it } from "vitest";
import { parseGradient, proposeFixes, refine, score, toCSS } from "@opal42/gradient";
import {
  analyzeGroup,
  GROUP_LIMITS,
  groupHits,
  safeSwatch,
  sortEntries,
  summarize,
  summaryText,
  type Entry,
  type ScoredEntry,
} from "../src/lib/analyze";
import type { RawHit } from "../src/lib/scan-types";

const hit = (value: string, extra: Partial<RawHit> = {}): RawHit => ({
  source: "computed",
  property: "background-image",
  value,
  selector: "div.a",
  path: "html > body:nth-child(2) > div:nth-child(1)",
  origin: "",
  ...extra,
});

const ROUGH = "linear-gradient(90deg, rgb(255, 0, 0), rgb(0, 255, 0) 50%, rgb(0, 0, 255))";
const SMOOTH = "linear-gradient(90deg, #1e3a8a, #3b82f6)";

const analyzeOne = (value: string): Entry => {
  const { groups } = groupHits([hit(value)]);
  return analyzeGroup(groups[0]);
};
const scored = (value: string): ScoredEntry => {
  const e = analyzeOne(value);
  if (e.status !== "scored") throw new Error(`not scored: ${e.code}`);
  return e;
};

describe("groupHits: dedupe", () => {
  it("merges the same text found on several elements into one gradient with several usages", () => {
    const { groups } = groupHits([hit(SMOOTH, { selector: "div.a", path: "p1" }), hit(SMOOTH, { selector: "div.b", path: "p2" }), hit(SMOOTH, { selector: "div.c", path: "p3" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].usageCount).toBe(3);
    expect(groups[0].usages.map((u) => u.selector)).toEqual(["div.a", "div.b", "div.c"]);
  });

  it("merges the same gradient written in different notations (hex in a rule, rgb() in computed style)", () => {
    const { groups } = groupHits([
      hit("linear-gradient(to right, #ff0000, #0000ff)", { source: "stylesheet", selector: ".hero", path: "", origin: "<style>" }),
      hit("linear-gradient(90deg, rgb(255, 0, 0), rgb(0, 0, 255))", { selector: "div.hero", path: "x" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].usages.map((u) => u.source)).toEqual(["stylesheet", "computed"]);
  });

  it("does not merge different gradients", () => {
    expect(groupHits([hit(SMOOTH), hit(ROUGH)]).groups).toHaveLength(2);
  });

  it("does not count the same element and rule twice (shorthand + longhand, repeated scans of a value)", () => {
    const h = hit(SMOOTH);
    const { groups } = groupHits([h, { ...h, property: "mask-image" }, h]);
    expect(groups[0].usageCount).toBe(1);
  });

  it("splits a multi-layer value into one entry per gradient and ignores url() layers", () => {
    const { groups } = groupHits([hit(`${SMOOTH}, url("x.png"), radial-gradient(red, blue)`)]);
    expect(groups.map((g) => g.parsed?.kind)).toEqual(["linear", "radial"]);
  });

  it("keeps first-seen order", () => {
    const { groups } = groupHits([hit(ROUGH), hit(SMOOTH)]);
    expect(groups.map((g) => g.order)).toEqual([0, 1]);
    expect(groups[0].id).toBe("g1");
  });

  it("merges skipped gradients by normalised text", () => {
    const { groups } = groupHits([hit("linear-gradient(var(--a),  red)"), hit("LINEAR-GRADIENT( var(--a), red )")]);
    expect(groups).toHaveLength(1);
  });

  it("counts hits that hold no gradient the parser knows (e.g. a made-up function)", () => {
    const r = groupHits([hit("foo-gradient(1, 2)"), hit(SMOOTH)]);
    expect(r.groups).toHaveLength(1);
    expect(r.unparsedHits).toBe(1);
  });
});

describe("groupHits: caps", () => {
  it("lists at most maxUsagesStored usages but counts them all", () => {
    const hits = Array.from({ length: GROUP_LIMITS.maxUsagesStored + 40 }, (_, i) => hit(SMOOTH, { selector: `div.n${i}`, path: `p${i}` }));
    const { groups } = groupHits(hits);
    expect(groups[0].usages).toHaveLength(GROUP_LIMITS.maxUsagesStored);
    expect(groups[0].usageCount).toBe(GROUP_LIMITS.maxUsagesStored + 40);
  });

  it("keeps at most maxGroups gradients and counts the dropped ones", () => {
    const hits = Array.from({ length: GROUP_LIMITS.maxGroups + 25 }, (_, i) => hit(`linear-gradient(#${(i % 4096).toString(16).padStart(3, "0")}, #fff ${i % 90}%)`, { path: `p${i}`, selector: `s${i}` }));
    const r = groupHits(hits);
    expect(r.groups).toHaveLength(GROUP_LIMITS.maxGroups);
    expect(r.droppedGroups).toBeGreaterThan(0);
  });

  it("an existing gradient still gets new usages after the group cap is reached", () => {
    const hits = [hit(SMOOTH, { path: "first", selector: "first" })];
    for (let i = 0; i < GROUP_LIMITS.maxGroups; i++) hits.push(hit(`linear-gradient(#${(i % 4096).toString(16).padStart(3, "0")}, #fff ${(i * 7) % 99}%, #000)`, { path: `p${i}`, selector: `s${i}` }));
    hits.push(hit(SMOOTH, { path: "later", selector: "later" }));
    const r = groupHits(hits);
    expect(r.groups[0].usageCount).toBe(2);
  });

  it("turns a truncated value into a not-scored 'too-long' entry without parsing it", () => {
    const { groups } = groupHits([hit("linear-gradient(red, blue, " + "red,".repeat(100), { truncated: true })]);
    expect(groups[0].truncated).toBe(true);
    const e = analyzeGroup(groups[0]);
    expect(e).toMatchObject({ status: "not-scored", code: "too-long" });
  });
});

describe("analyzeGroup: scored", () => {
  it("scores with the core library and nothing else", () => {
    const e = scored(ROUGH);
    const doc = parseGradient(ROUGH).gradients[0].document!;
    const expected = score(doc);
    expect(expected.status).toBe("ok");
    if (expected.status === "ok") {
      expect(e.score).toBe(expected.score);
      expect(e.issues.map((i) => i.code)).toEqual(expected.issues.map((i) => i.code));
    }
  });

  it("explains each issue with a plain name, one sentence and the points lost", () => {
    const e = scored(ROUGH);
    expect(e.issues.length).toBeGreaterThan(0);
    for (const issue of e.issues) {
      expect(issue.name).toBe(issue.name.toLowerCase());
      expect(issue.measures).toMatch(/^[A-Z].*\.$/);
      expect(issue.pointsLost).toBeGreaterThan(0);
      expect(issue.severityLabel).toMatch(/deduction$/);
    }
  });

  it("numbers stops in CSS order in the location text", () => {
    const e = scored(ROUGH);
    const reversal = e.issues.find((i) => i.code === "lightness/reversal");
    expect(reversal?.where).toBe("stop 2");
    expect(e.issues.find((i) => i.code === "hue/wide-arc")?.where).toBe("stops 1 and 3");
    expect(e.issues.find((i) => i.code === "chroma/muddy-midpoint")?.where).toContain("between 50% and 100%");
  });

  it("offers one fix per finding, each a gain, with CSS that scores what it says", () => {
    const e = scored(ROUGH);
    const doc = parseGradient(ROUGH).gradients[0].document!;
    expect(e.fixes.map((f) => f.code)).toEqual(proposeFixes(doc).map((f) => f.code));
    for (const fix of e.fixes) {
      expect(fix.gain).toBeGreaterThan(0);
      const reparsed = parseGradient(fix.css).gradients[0].document!;
      const s = score(reparsed);
      expect(s.status === "ok" && s.score).toBe(fix.scoreAfter);
      expect(fix.scoreAfter).toBe(e.score + fix.gain);
    }
  });

  it("offers a refinement only when it raises the score, and its CSS scores as announced", () => {
    const e = scored(ROUGH);
    const doc = parseGradient(ROUGH).gradients[0].document!;
    const r = refine(doc);
    expect(e.refined?.css).toBe(toCSS(r.document));
    expect(e.refined!.gain).toBeGreaterThan(0);
    const s = score(parseGradient(e.refined!.css).gradients[0].document!);
    expect(s.status === "ok" && s.score).toBe(e.refined!.scoreAfter);
  });

  it("has no refinement and no fixes for a gradient with nothing to fix", () => {
    const e = scored(SMOOTH);
    if (e.issues.length === 0) {
      expect(e.fixes).toEqual([]);
      expect(e.refined).toBeNull();
    } else {
      expect(e.fixes.length).toBeLessThanOrEqual(e.issues.length);
    }
  });

  it("prints a normalised swatch/copy text, not the page's raw text", () => {
    const e = scored("linear-gradient(to right,   RGB(0,0,0),  white)");
    expect(e.normalizedCss).toBe(toCSS(parseGradient("linear-gradient(to right, rgb(0,0,0), white)").gradients[0].document!));
    expect(e.swatch).toBe(e.normalizedCss);
    expect(e.normalizedCss).toMatch(/^linear-gradient\(/);
  });

  it("notes hard stops instead of hiding the score", () => {
    const e = scored("linear-gradient(90deg, #f00 0%, #f00 50%, #00f 50%, #00f 100%)");
    expect(e.hasHardStops).toBe(true);
    expect(e.notes.join(" ")).toMatch(/hard stops/);
    expect(typeof e.score).toBe("number");
  });

  it("notes parser warnings in plain words", () => {
    const e = scored("linear-gradient(red, 30%, blue)");
    expect(e.notes.join(" ")).toMatch(/hint/);
  });

  it("uses neutral wording: no verdict words in anything it prints", () => {
    const e = scored(ROUGH);
    const text = JSON.stringify([e.issues.map((i) => [i.name, i.measures, i.severityLabel]), e.fixes.map((f) => f.label), e.notes]);
    expect(text).not.toMatch(/\b(bad|poor|ugly|wrong|excellent|good|great|fail|pass|quality|terrible)\b/i);
  });

  it("builds a Gradient Studio hash for what it can carry", () => {
    const e = scored(SMOOTH);
    expect(e.studio).toEqual({ ok: true, hash: "v1;s=1e3a8a@0,3b82f6@100;d=90:100:1;b=normal" });
  });
});

describe("analyzeGroup: not scored, with reasons", () => {
  it.each([
    ["var()", "linear-gradient(var(--a), red)", "var"],
    ["calc()", "linear-gradient(red calc(10% + 5px), blue)", "calc"],
    ["vendor prefix", "-webkit-linear-gradient(left, red, blue)", "legacy-syntax"],
    ["lab()", "linear-gradient(lab(50% 40 59), red)", "lab-lch"],
    ["color()", "linear-gradient(color(display-p3 1 0 0), red)", "color-function"],
    ["length position", "linear-gradient(red 10px, blue)", "length-position"],
    ["transparency", "linear-gradient(to right, rgba(0, 0, 0, 0), rgb(255, 0, 0))", "alpha"],
    ["repeating", "repeating-linear-gradient(red 0, blue 10%)", "repeating"],
    ["single stop", "linear-gradient(red)", "too-few-stops"],
    ["radial", "radial-gradient(red, blue)", "unsupported-kind"],
    ["conic", "conic-gradient(red, blue)", "unsupported-kind"],
  ])("%s", (_name, css, code) => {
    const e = analyzeOne(css);
    expect(e.status).toBe("not-scored");
    if (e.status === "not-scored") {
      expect(e.code).toBe(code);
      expect(e.reason.length).toBeGreaterThan(10);
      expect(e.reason).not.toBe("Not scored.");
    }
  });

  it("reports the kind of radial and conic gradients", () => {
    expect(analyzeOne("radial-gradient(red, blue)")).toMatchObject({ kind: "radial" });
    expect(analyzeOne("conic-gradient(red, blue)")).toMatchObject({ kind: "conic" });
  });

  it("still previews a translucent gradient (from the normalised document)", () => {
    const e = analyzeOne("linear-gradient(to right, rgba(0, 0, 0, 0), rgb(255, 0, 0))");
    expect(e.status === "not-scored" && e.swatch).toMatch(/^linear-gradient\(/);
  });

  it("previews plain radial and conic gradients from the allow-listed raw text", () => {
    const e = analyzeOne("radial-gradient(circle at center, rgb(255, 0, 0), rgb(0, 0, 255))");
    expect(e.status === "not-scored" && e.swatch).toBe("radial-gradient(circle at center, rgb(255, 0, 0), rgb(0, 0, 255))");
  });

  it("gives no preview for a gradient that mentions url()", () => {
    const e = analyzeOne("radial-gradient(url(https://evil.example/x.png), blue)");
    expect(e.status === "not-scored" && e.swatch).toBeNull();
  });
});

describe("safeSwatch", () => {
  it.each([
    "radial-gradient(red, blue)",
    "conic-gradient(from 90deg at 50% 50%, rgb(1, 2, 3), color(srgb 0.1 0.2 0.3 / 0.5) 40%, oklch(0.5 0.2 30deg))",
    "repeating-linear-gradient(45deg, #fff 0px, #000 10px)",
  ])("allows %s", (css) => {
    expect(safeSwatch(css)).toBe(css);
  });

  it.each([
    "linear-gradient(red, url(https://evil.example/a))",
    "linear-gradient(red, blue); background: url(x)",
    'linear-gradient(red, "blue")',
    "linear-gradient(red, blue) , url(x)",
    "linear-gradient(red, image-set(x 1x))",
    "linear-gradient(var(--x), blue)",
    "linear-gradient(red, blue",
    "linear-gradient(red, blue))",
    "radial-gradient(red, blue) extra",
    "linear-gradient(red, blue)}",
    "linear-gradient(red, attr(x))",
    "url(x)",
    "",
    "linear-gradient(" + "x".repeat(2000) + ")",
    "linear-gradient(red, \\75rl(x))",
    "linear-gradient(red, blue)/*x*/;",
  ])("refuses %s", (css) => {
    expect(safeSwatch(css)).toBeNull();
  });
});

describe("summary and sorting", () => {
  const entries = (): Entry[] => {
    const { groups } = groupHits([
      hit(ROUGH, { path: "a", selector: "a" }),
      hit(SMOOTH, { path: "b", selector: "b" }),
      hit(SMOOTH, { path: "c", selector: "c" }),
      hit("radial-gradient(red, blue)", { path: "d", selector: "d" }),
      hit("linear-gradient(red 20%, #ffffff 60%, blue 90%)", { path: "e", selector: "e" }),
    ]);
    return groups.map(analyzeGroup);
  };

  it("summarises counts", () => {
    const s = summarize(entries());
    expect(s).toMatchObject({ total: 4, scored: 3, notScored: 1 });
    expect(s.withIssues).toBeGreaterThan(0);
  });

  it("writes the announcement sentence", () => {
    expect(summaryText({ total: 0, scored: 0, notScored: 0, withIssues: 0 })).toBe("No gradients found on this page.");
    expect(summaryText({ total: 1, scored: 1, notScored: 0, withIssues: 0 })).toBe("1 gradient found, 1 scored.");
    expect(summaryText({ total: 5, scored: 3, notScored: 2, withIssues: 1 })).toBe("5 gradients found, 3 scored, 2 not scored.");
  });

  it("sorts by score ascending with not-scored last, stable by page order", () => {
    const sorted = sortEntries(entries(), "score-asc");
    const scores = sorted.filter((e): e is ScoredEntry => e.status === "scored").map((e) => e.score);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    expect(sorted.at(-1)?.status).toBe("not-scored");
  });

  it("sorts by score descending with not-scored last", () => {
    const sorted = sortEntries(entries(), "score-desc");
    const scores = sorted.filter((e): e is ScoredEntry => e.status === "scored").map((e) => e.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(sorted.at(-1)?.status).toBe("not-scored");
  });

  it("sorts by usage, then by page order", () => {
    const sorted = sortEntries(entries(), "usage");
    expect(sorted[0].usageCount).toBe(2);
  });

  it("restores page order and does not mutate its input", () => {
    const list = entries();
    const copy = [...list];
    expect(sortEntries(list, "page").map((e) => e.order)).toEqual([0, 1, 2, 3]);
    expect(list).toEqual(copy);
  });
});
