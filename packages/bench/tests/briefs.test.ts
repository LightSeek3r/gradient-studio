import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRIEF_LIMITS, DEFAULT_BRIEF_SET, briefSetHash, parseBriefSet, validateBriefSet, type BriefSet } from "../src/briefs";

const raw = readFileSync(new URL("../prompts/briefs.json", import.meta.url), "utf8");
const schema = JSON.parse(readFileSync(new URL("../prompts/briefs.schema.json", import.meta.url), "utf8")) as {
  required: string[];
  properties: Record<string, { pattern?: string }>;
  $defs: { brief: { required: string[]; properties: Record<string, { pattern?: string; maxLength?: number; minLength?: number; maxItems?: number }> } };
};

const clone = (): BriefSet => JSON.parse(raw) as BriefSet;
const issuesOf = (mut: (s: BriefSet) => void) => {
  const s = clone();
  mut(s);
  return validateBriefSet(s);
};

describe("shipped brief set", () => {
  it("is valid", () => {
    expect(validateBriefSet(JSON.parse(raw))).toEqual([]);
    expect(DEFAULT_BRIEF_SET.briefs).toHaveLength(100);
  });

  it("covers the ten categories with ten briefs each", () => {
    const counts = new Map<string, number>();
    for (const b of DEFAULT_BRIEF_SET.briefs) counts.set(b.category, (counts.get(b.category) ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual(
      ["accessibility-constrained", "brand-constrained", "dark-mode-button", "dashboard-card", "dataviz-heat-strip", "ecommerce-banner", "game-ui", "marketing-landing", "mobile-splash", "saas-hero"].sort(),
    );
    for (const n of counts.values()) expect(n).toBe(10);
  });

  it("has unique ids numbered per category", () => {
    const ids = DEFAULT_BRIEF_SET.briefs.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of DEFAULT_BRIEF_SET.briefs) expect(b.id.startsWith(`${b.category}-`)).toBe(true);
  });

  it("gives every brand-constrained brief brand colours and every accessibility brief a constraint", () => {
    for (const b of DEFAULT_BRIEF_SET.briefs) {
      if (b.category === "brand-constrained") expect(b.brandColors?.length, b.id).toBeGreaterThanOrEqual(2);
      if (b.category === "accessibility-constrained") expect(b.constraints?.length, b.id).toBeGreaterThanOrEqual(1);
    }
  });

  it("follows the authoring policy: no URLs, emails, trademark signs, or real brand names", () => {
    const text = DEFAULT_BRIEF_SET.briefs.map((b) => [b.brief, ...(b.constraints ?? [])].join(" ")).join("\n");
    expect(text).not.toMatch(/https?:|www\.|@\w+\.\w+|[™®©]/);
    // A denylist of well-known names; the policy is "invented names only".
    const real = /\b(apple|google|microsoft|amazon|nike|adidas|stripe|spotify|netflix|slack|notion|figma|airbnb|uber|tesla|ikea|starbucks|paypal|shopify|github|twitter|facebook|meta|instagram|tiktok|coca-cola|pepsi)\b/i;
    expect(text).not.toMatch(real);
  });

  it("never asks for a specific gradient in the brief text", () => {
    for (const b of DEFAULT_BRIEF_SET.briefs) expect(b.brief, b.id).not.toMatch(/gradient\(/i);
  });

  it("has a documented authoring policy", () => {
    expect(DEFAULT_BRIEF_SET.authoringPolicy).toMatch(/invented/);
    expect(DEFAULT_BRIEF_SET.authoringPolicy).toMatch(/no endorsement/);
  });

  it("has a stable content hash (update it when the briefs change on purpose)", () => {
    // Pinned: a changed brief changes the hash, which makes old results incomparable.
    expect(briefSetHash(DEFAULT_BRIEF_SET)).toBe("43fdc97bdcbded2f");
  });

  it("hash ignores key order and policy text but not brief content", () => {
    const a = clone();
    const b = clone();
    b.authoringPolicy = b.authoringPolicy + " (edited)";
    b.briefs = b.briefs.map((x) => Object.fromEntries(Object.entries(x).reverse()) as typeof x);
    expect(briefSetHash(b)).toBe(briefSetHash(a));
    b.briefs[0]!.brief += " x";
    expect(briefSetHash(b)).not.toBe(briefSetHash(a));
  });
});

describe("validator", () => {
  it("rejects non-objects and unknown properties", () => {
    expect(validateBriefSet(null)).not.toEqual([]);
    expect(validateBriefSet([])).not.toEqual([]);
    expect(issuesOf((s) => ((s as unknown as Record<string, unknown>).extra = 1))[0]?.path).toBe("$.extra");
    expect(issuesOf((s) => ((s.briefs[0] as unknown as Record<string, unknown>).extra = 1))[0]?.path).toBe("$.briefs[0].extra");
  });

  it("rejects bad top-level fields", () => {
    expect(issuesOf((s) => ((s as unknown as { schemaVersion: number }).schemaVersion = 2)).map((i) => i.path)).toContain("$.schemaVersion");
    expect(issuesOf((s) => (s.version = "1.0")).map((i) => i.path)).toContain("$.version");
    expect(issuesOf((s) => (s.name = "")).map((i) => i.path)).toContain("$.name");
    expect(issuesOf((s) => (s.authoringPolicy = "short")).map((i) => i.path)).toContain("$.authoringPolicy");
    expect(issuesOf((s) => (s.briefs = [])).map((i) => i.path)).toContain("$.briefs");
  });

  it("rejects bad ids, categories and duplicates", () => {
    expect(issuesOf((s) => (s.briefs[0]!.id = "Bad_ID")).map((i) => i.path)).toContain("$.briefs[0].id");
    expect(issuesOf((s) => (s.briefs[0]!.id = "saas-hero-1")).map((i) => i.path)).toContain("$.briefs[0].id");
    expect(issuesOf((s) => (s.briefs[1]!.id = s.briefs[0]!.id))[0]?.message).toMatch(/duplicate/);
    expect(issuesOf((s) => (s.briefs[0]!.category = "game-ui")).map((i) => i.message).join()).toMatch(/must start with/);
    expect(issuesOf((s) => (s.briefs[0]!.category = "Not Kebab")).map((i) => i.path)).toContain("$.briefs[0].category");
  });

  it("rejects bad brief text", () => {
    expect(issuesOf((s) => (s.briefs[0]!.brief = "too short")).map((i) => i.path)).toContain("$.briefs[0].brief");
    expect(issuesOf((s) => (s.briefs[0]!.brief = "x".repeat(601))).map((i) => i.path)).toContain("$.briefs[0].brief");
    expect(issuesOf((s) => (s.briefs[0]!.brief = " " + s.briefs[0]!.brief)).map((i) => i.message).join()).toMatch(/whitespace/);
    expect(issuesOf((s) => ((s.briefs[0] as unknown as { brief: number }).brief = 5)).map((i) => i.path)).toContain("$.briefs[0].brief");
  });

  it("rejects bad constraints and brand colours", () => {
    expect(issuesOf((s) => (s.briefs[0]!.constraints = [])).map((i) => i.path)).toContain("$.briefs[0].constraints");
    expect(issuesOf((s) => (s.briefs[0]!.constraints = ["a", "valid one"])).map((i) => i.path)).toContain("$.briefs[0].constraints[0]");
    expect(issuesOf((s) => (s.briefs[0]!.constraints = ["one", "two", "three", "four", "five"])).map((i) => i.path)).toContain("$.briefs[0].constraints");
    expect(issuesOf((s) => (s.briefs[0]!.brandColors = ["#FFFFFF"])).map((i) => i.path)).toContain("$.briefs[0].brandColors[0]");
    expect(issuesOf((s) => (s.briefs[0]!.brandColors = ["red"])).map((i) => i.path)).toContain("$.briefs[0].brandColors[0]");
  });

  it("never throws on hostile input", () => {
    for (const v of [undefined, 1, "x", { briefs: "no" }, { briefs: [null] }, { briefs: [[]] }]) expect(() => validateBriefSet(v)).not.toThrow();
  });
});

describe("parseBriefSet", () => {
  it("reports invalid JSON and invalid sets", () => {
    expect(parseBriefSet("{").ok).toBe(false);
    const r = parseBriefSet("{}");
    expect(r.ok).toBe(false);
    expect(parseBriefSet(raw).ok).toBe(true);
  });
});

describe("briefs.schema.json", () => {
  it("agrees with the validator's constants", () => {
    expect(schema.required).toEqual(["schemaVersion", "name", "version", "authoringPolicy", "briefs"]);
    expect(schema.$defs.brief.required).toEqual(["id", "category", "brief"]);
    expect(schema.$defs.brief.properties.id!.pattern).toBe(BRIEF_LIMITS.idPattern.source.replace(/\\\//g, "/"));
    expect(schema.$defs.brief.properties.category!.pattern).toBe(BRIEF_LIMITS.categoryPattern.source);
    expect(schema.$defs.brief.properties.brief!.minLength).toBe(BRIEF_LIMITS.briefMin);
    expect(schema.$defs.brief.properties.brief!.maxLength).toBe(BRIEF_LIMITS.briefMax);
    expect(schema.$defs.brief.properties.constraints!.maxItems).toBe(BRIEF_LIMITS.constraintMax);
    expect(schema.properties.version!.pattern).toBe(BRIEF_LIMITS.versionPattern.source);
  });

  it("accepts every shipped brief under its own patterns", () => {
    const idRe = new RegExp(schema.$defs.brief.properties.id!.pattern!);
    for (const b of DEFAULT_BRIEF_SET.briefs) expect(idRe.test(b.id)).toBe(true);
  });
});
