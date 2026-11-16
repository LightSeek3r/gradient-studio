import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { V1_FINDING_CODES } from "@opal42/gradient";
import { RULE_CODES as WEB_RULE_CODES } from "../../web/src/explain/explain";
import { REASON_TEXT, reasonText, warningText, WARNING_TEXT } from "../src/lib/reasons";
import { RULE_TEXT, ruleText, SEVERITY_LABEL } from "../src/lib/rule-text";

const MODEL_CODES = Object.keys(V1_FINDING_CODES).sort();
const spec = (name: string) => readFileSync(new URL(`../../../spec/${name}`, import.meta.url), "utf8");

describe("rule text", () => {
  it("covers exactly the finding codes of the v1 model", () => {
    expect(Object.keys(RULE_TEXT).sort()).toEqual(MODEL_CODES);
  });

  it("has the same codes as the web app's table (the two copies cannot silently diverge in coverage)", () => {
    expect(Object.keys(RULE_TEXT).sort()).toEqual([...WEB_RULE_CODES].sort());
  });

  it("covers every code with a section in spec/scoring-v1.md", () => {
    const codes = [...spec("scoring-v1.md").matchAll(/^### `([a-z]+\/[a-z-]+)`/gm)].map((m) => m[1]).sort();
    expect(codes).toEqual(MODEL_CODES);
  });

  it("gives each rule a short lower-case name and one plain sentence, without verdict words", () => {
    const names = new Set<string>();
    for (const code of MODEL_CODES) {
      const t = RULE_TEXT[code];
      expect(t.name.length, code).toBeGreaterThan(3);
      expect(t.name, code).toBe(t.name.toLowerCase());
      expect(names.has(t.name), `duplicate ${t.name}`).toBe(false);
      names.add(t.name);
      expect(t.measures, code).toMatch(/^[A-Z].*\.$/);
      expect(`${t.name} ${t.measures}`, code).not.toMatch(/\b(bad|poor|ugly|wrong|excellent|good|quality|fail)\b/i);
    }
  });

  it("has a neutral fallback for an unknown code, without throwing on prototype names", () => {
    expect(ruleText("lightness/new-rule").name).toBe("new rule");
    expect(ruleText("constructor").name).toBe("constructor");
    expect(ruleText("__proto__").measures).toMatch(/deduction/);
    expect(ruleText("").name).toBe("deduction");
  });

  it("labels severities as deductions, never as verdicts", () => {
    expect(Object.values(SEVERITY_LABEL)).toEqual(["large deduction", "medium deduction", "small deduction"]);
  });
});

describe("reason text", () => {
  it("has a reason for every skip code in spec/parser.md", () => {
    const section = spec("parser.md").split("## Skip codes")[1].split("Warnings (never skips)")[0];
    const codes = [...section.matchAll(/^\| `([A-Za-z-]+)` \|/gm)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThanOrEqual(19);
    for (const code of codes) expect(Object.hasOwn(REASON_TEXT, code), code).toBe(true);
  });

  it("has a reason for every unscorable code in spec/api.md", () => {
    const section = spec("api.md").split("Unscorable (never a number) with these codes:")[1].split("Notes:")[0];
    const codes = [...section.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThanOrEqual(10);
    for (const code of codes) expect(Object.hasOwn(REASON_TEXT, code), code).toBe(true);
  });

  it("every reason is a plain sentence without verdict words", () => {
    for (const [code, text] of Object.entries(REASON_TEXT)) {
      expect(text, code).toMatch(/^[A-Z].*[.:]$|^[A-Z].*\.$/);
      expect(text, code).not.toMatch(/\b(bad|poor|ugly|wrong|excellent|good|fail|invalid)\b/i);
    }
  });

  it("falls back for an unknown code and does not read prototype members", () => {
    expect(reasonText("brand-new")).toBe("Not scored.");
    expect(reasonText("constructor")).toBe("Not scored.");
  });

  it("explains every parser warning", () => {
    for (const code of ["color-hint-ignored", "corner-angle", "position-out-of-range", "gamut-mapped"]) expect(warningText(code), code).not.toBe("");
    expect(warningText("toString")).toBe("");
    expect(Object.keys(WARNING_TEXT)).toHaveLength(4);
  });
});
