import { describe, expect, it } from "vitest";
import { resolveTargets, setPrivate } from "../set-private.mjs";
import { candidates } from "../release-check.mjs";

const pkg = '{\n  "name": "a",\n  "version": "0.0.0",\n  "private": true,\n  "type": "module"\n}\n';
const cands = candidates({ scope: "@s", cliName: "c", tiers: { 1: [{ dir: "p/a", name: "{scope}/a" }, { dir: "p/c", name: "{cli}" }], 2: [{ dir: "p/b", name: "{scope}/b" }] } });

describe("setPrivate", () => {
  it("removes only the private line", () => expect(setPrivate(pkg, false)).toEqual({ text: '{\n  "name": "a",\n  "version": "0.0.0",\n  "type": "module"\n}\n', changed: true }));
  it("is idempotent when already public", () => { const a = setPrivate(pkg, false).text; expect(setPrivate(a, false)).toEqual({ text: a, changed: false }); });
  it("re-adds it after version", () => expect(setPrivate(setPrivate(pkg, false).text, true).text).toBe(pkg));
  it("does not duplicate", () => expect(setPrivate(pkg, true).changed).toBe(false));
  it("keeps the result valid JSON", () => expect(() => JSON.parse(setPrivate(pkg, false).text)).not.toThrow());
  it("handles CRLF files", () => expect(setPrivate(pkg.replace(/\n/g, "\r\n"), false).text).not.toContain("private"));
});

describe("resolveTargets", () => {
  it("resolves names", () => expect(resolveTargets(["@s/a", "c"], cands).map((c) => c.dir)).toEqual(["p/a", "p/c"]));
  it("resolves tiers", () => expect(resolveTargets(["tier:1"], cands).map((c) => c.name)).toEqual(["@s/a", "c"]));
  it("deduplicates", () => expect(resolveTargets(["tier:1", "@s/a"], cands)).toHaveLength(2));
  it("refuses non-candidates", () => expect(() => resolveTargets(["gradient-studio-web"], cands)).toThrow(/not a publish candidate/));
  it("refuses empty tiers", () => expect(() => resolveTargets(["tier:9"], cands)).toThrow());
});
