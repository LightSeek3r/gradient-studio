import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without type declarations
import { parseFrontmatter, validateSkill } from "../../../skills/gradient-quality/scripts/validate-skill.mjs";

const skillDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "skills", "gradient-quality");
const read = (p: string) => readFileSync(join(skillDir, p), "utf8");

describe("skills/gradient-quality", () => {
  it("is a valid Agent Skill", () => {
    const { errors, metadata } = validateSkill(skillDir);
    expect(errors).toEqual([]);
    expect(metadata.name).toBe("gradient-quality");
    expect(metadata.description.length).toBeLessThanOrEqual(1024);
  });

  it("has a description that says when to use it and what the number is", () => {
    const { metadata } = validateSkill(skillDir);
    expect(metadata.description).toMatch(/Use whenever/);
    expect(metadata.description).toMatch(/smoothness score/);
    expect(metadata.description).toMatch(/not a quality verdict/);
  });

  it("tells the agent to run the CLI or the MCP tool", () => {
    const body = read("SKILL.md");
    expect(body).toContain("npx opal42 score --json -");
    expect(body).toContain("score_gradient");
    expect(body).toContain("refine_gradient");
  });

  it("hard-codes no pass threshold (PLAN D5)", () => {
    const all = ["SKILL.md", "references/anti-patterns.md", "references/issue-codes.md"].map(read).join("\n") + readFileSync(join(skillDir, "..", "README.md"), "utf8");
    expect(all).not.toMatch(/\bscore\b[^.\n]{0,40}(>=|<=|<|>|above|below|at least|under|over)\s*\d/i);
    expect(all).not.toMatch(/--min-score\s+\d/);
    expect(all).toMatch(/no pass threshold/i);
    expect(all).toMatch(/not a quality (or taste )?verdict/i);
  });

  it("covers the four common anti-patterns with a fix each", () => {
    const ap = read("references/anti-patterns.md");
    for (const code of ["chroma/muddy-midpoint", "hue/wide-arc", "lightness/reversal", "rhythm/edge-gap"]) expect(ap).toContain(code);
    expect((ap.match(/\*\*Fix:\*\*/g) ?? []).length).toBe(4);
  });

  it("documents every v1 finding code", () => {
    const codes = read("references/issue-codes.md");
    const spec = readFileSync(join(skillDir, "..", "..", "spec", "scoring-v1.md"), "utf8");
    const specCodes = [...spec.matchAll(/^### `([a-z]+\/[a-z-]+)`/gm)].map((m) => m[1]);
    expect(specCodes.length).toBe(15);
    for (const c of specCodes) expect(codes, c).toContain(`\`${c}\``);
  });

  it("tells the agent to check colour changes and to ask when brand colours are affected", () => {
    const body = read("SKILL.md");
    expect(body).toMatch(/colorShift/);
    expect(body).toMatch(/brand/);
    expect(body).toMatch(/ask/);
  });
});

describe("validate-skill.mjs", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const make = (dirName: string, front: string, body = "Instructions.\n") => {
    const d = join(root, dirName);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "SKILL.md"), `---\n${front}\n---\n${body}`);
    return d;
  };

  it("accepts a minimal skill", () => {
    expect(validateSkill(make("ok-skill", "name: ok-skill\ndescription: Does a thing.")).errors).toEqual([]);
  });
  it("rejects a name that does not match the directory", () => {
    expect(validateSkill(make("dir-a", "name: dir-b\ndescription: x")).errors.join()).toMatch(/must match/);
  });
  it.each([["Bad-Name"], ["-lead"], ["trail-"], ["dou--ble"], ["has space"], ["under_score"]])("rejects the name %s", (n) => {
    expect(validateSkill(make(n.replace(/\s/g, "_"), `name: ${n}\ndescription: x`)).errors.length).toBeGreaterThan(0);
  });
  it("rejects a missing description, unknown fields and an over-long description", () => {
    expect(validateSkill(make("no-desc", "name: no-desc")).errors.join()).toMatch(/description/);
    expect(validateSkill(make("extra-f", "name: extra-f\ndescription: x\nfoo: bar")).errors.join()).toMatch(/unexpected frontmatter field/);
    expect(validateSkill(make("long-d", `name: long-d\ndescription: ${"x".repeat(1025)}`)).errors.join()).toMatch(/exceeds 1024/);
  });
  it("rejects a missing file, missing frontmatter, empty body and broken links", () => {
    expect(validateSkill(join(root, "nonexistent")).errors[0]).toMatch(/not a directory/);
    mkdirSync(join(root, "empty-dir"));
    expect(validateSkill(join(root, "empty-dir")).errors[0]).toMatch(/missing required file/);
    mkdirSync(join(root, "nofm"));
    writeFileSync(join(root, "nofm", "SKILL.md"), "no frontmatter");
    expect(validateSkill(join(root, "nofm")).errors[0]).toMatch(/frontmatter/);
    expect(validateSkill(make("empty-body", "name: empty-body\ndescription: x", "")).errors.join()).toMatch(/no instructions/);
    expect(validateSkill(make("bad-link", "name: bad-link\ndescription: x", "See [x](references/nope.md)\n")).errors.join()).toMatch(/broken link/);
  });
  it("parses a metadata map and quoted values", () => {
    const { metadata } = parseFrontmatter('---\nname: a\ndescription: "q: x"\nmetadata:\n  k: v\n---\nbody');
    expect(metadata).toEqual({ name: "a", description: "q: x", metadata: { k: "v" } });
  });
});
