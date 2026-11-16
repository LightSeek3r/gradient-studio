import { describe, expect, it } from "vitest";
import plugins, { minScore, noFinding, ruleNames, validGradient } from "../src/index";

describe("plugin export", () => {
  it("the default export is the array stylelint loads", () => {
    expect(plugins).toEqual([minScore, noFinding, validGradient]);
  });

  it("rule names live in the opal42 namespace", () => {
    expect(ruleNames).toEqual({ minScore: "opal42/min-score", noFinding: "opal42/no-finding", validGradient: "opal42/valid-gradient" });
    expect(plugins.map((p) => p.ruleName)).toEqual(Object.values(ruleNames));
  });

  it("rules declare meta: url and fixable", () => {
    expect(minScore.rule.meta).toMatchObject({ fixable: true });
    expect(noFinding.rule.meta).toMatchObject({ fixable: true });
    expect(validGradient.rule.meta).toMatchObject({ fixable: false });
    for (const p of plugins) expect(p.rule.meta?.url).toMatch(/^https:\/\/github\.com\/LightSeek3r\/gradient-studio\//);
  });

  it("no-finding takes an array as its primary option", () => {
    expect(noFinding.rule.primaryOptionArray).toBe(true);
  });

  it("every message is registered under its rule and ends with the rule name", () => {
    expect((minScore.rule.messages.below as (...a: unknown[]) => string)(1, 2, "")).toMatch(/\(opal42\/min-score\)$/);
    expect((noFinding.rule.messages.found as (...a: unknown[]) => string)("a/b", 1, "m")).toMatch(/\(opal42\/no-finding\)$/);
    expect((validGradient.rule.messages.invalid as (...a: unknown[]) => string)("syntax", "r")).toMatch(/\(opal42\/valid-gradient\)$/);
  });
});
