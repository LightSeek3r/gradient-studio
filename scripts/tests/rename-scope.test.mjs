import { describe, expect, it } from "vitest";
import { isCliOwned, isSkipped, normalizeCliName, normalizeScope, rewriteCliName, rewriteFile, rewriteScope } from "../rename-scope.mjs";

const S = (t, to = "@acme") => rewriteScope(t, "@opal42", to);
const C = (t, rel = "docs/x.md", to = "acme") => rewriteCliName(t, "opal42", to, rel).text;

describe("normalize", () => {
  it("adds the @", () => expect(normalizeScope("acme")).toBe("@acme"));
  it("keeps the @", () => expect(normalizeScope("@acme-test")).toBe("@acme-test"));
  it("rejects uppercase and spaces", () => { expect(() => normalizeScope("@Acme")).toThrow(); expect(() => normalizeScope("@a b")).toThrow(); });
  it("rejects an empty scope", () => expect(() => normalizeScope("@")).toThrow());
  it("accepts a CLI name and rejects scoped ones", () => { expect(normalizeCliName("acme")).toBe("acme"); expect(() => normalizeCliName("@a/b")).toThrow(); expect(() => normalizeCliName("A")).toThrow(); });
});

describe("rewriteScope", () => {
  it("renames imports", () => expect(S('import { x } from "@opal42/gradient";').text).toBe('import { x } from "@acme/gradient";'));
  it("renames subpaths", () => expect(S("import c from '@opal42/gradient/color'").text).toContain("@acme/gradient/color"));
  it("renames package.json names and dependency keys", () => expect(S('{"name":"@opal42/mcp","dependencies":{"@opal42/gradient":"^0.1.0"}}').text).toBe('{"name":"@acme/mcp","dependencies":{"@acme/gradient":"^0.1.0"}}'));
  it("renames workspace commands", () => expect(S("npm run build -w @opal42/gradient -w @opal42/mcp").text).toBe("npm run build -w @acme/gradient -w @acme/mcp"));
  it("renames regex literals", () => expect(S("alwaysBundle: [/^@opal42\\//]").text).toBe("alwaysBundle: [/^@acme\\//]"));
  it("renames a bare scope", () => expect(S("create the @opal42 org").text).toBe("create the @acme org"));
  it("renames at the end of a sentence", () => expect(S("Use @opal42.").text).toBe("Use @acme."));
  it("renames lockfile paths", () => expect(S('"node_modules/@opal42/gradient"').text).toBe('"node_modules/@acme/gradient"'));
  it("renames URL-encoded scopes", () => expect(S("https://registry/%40opal42%2Fgradient").text).toBe("https://registry/%40acme%2Fgradient"));
  it("renames shields and unpkg URLs", () => expect(S("https://unpkg.com/@opal42/element/dist/x.js").text).toContain("@acme/element"));
  it("leaves longer scopes alone", () => expect(S("@opal42x/a @opal42-labs/b").count).toBe(0));
  it("leaves e-mail addresses alone", () => expect(S("me@opal42.com").count).toBe(0));
  it("leaves the unscoped name and the rule namespace alone", () => expect(S("opal42/min-score and opal42 score").count).toBe(0));
  it("does not touch CSS variables or custom elements", () => expect(S("--opal42-fg <opal42-gradient-score>").count).toBe(0));
  it("counts replacements", () => expect(S("@opal42/a @opal42/b").count).toBe(2));
  it("handles a replacement containing $", () => expect(rewriteScope("@opal42/a", "@opal42", "@a$&b").text).toBe("@a$&b/a"));
  it("is idempotent", () => { const once = S("@opal42/gradient").text; expect(S(once).count).toBe(0); expect(S(once).text).toBe(once); });
  it("is a no-op when old equals new", () => expect(rewriteFile("a", "@opal42/x", { oldScope: "@opal42", newScope: "@opal42" }).count).toBe(0));
  it("handles a new scope that contains the old one", () => { const once = rewriteScope("@opal42/a", "@opal42", "@opal42-test").text; expect(once).toBe("@opal42-test/a"); expect(rewriteScope(once, "@opal42", "@opal42-test").count).toBe(0); });
});

describe("rewriteCliName", () => {
  it("renames npx usage", () => expect(C("run `npx opal42 score src/`")).toBe("run `npx acme score src/`"));
  it("renames npx flags and versions", () => expect(C('exec npx --yes "opal42@${V:-latest}" "$@"', "actions/x.yml")).toContain('npx --yes "acme@'));
  it("renames workspace flags", () => expect(C("npm run build -w opal42 -w @opal42/mcp")).toBe("npm run build -w acme -w @opal42/mcp"));
  it("renames the bin key and package name", () => expect(C('{"name": "opal42", "version": "0.1.0", "bin": {"opal42": "./dist/cli.js"}}', "docs/x.json")).toBe('{"name": "acme", "version": "0.1.0", "bin": {"acme": "./dist/cli.js"}}'));
  it("renames every bare token in the CLI package", () => expect(C("opal42: error: x\nTry \"opal42 --help\"", "packages/cli/src/run.ts")).toBe('acme: error: x\nTry "acme --help"'));
  it("renames the golden output title", () => expect(C("title=opal42 lightness/reversal::x", "packages/cli/tests/golden/a.txt")).toBe("title=acme lightness/reversal::x"));
  it("renames derived bins", () => expect(C("npx opal42-mcp --version and opal42-bench score")).toBe("npx acme-mcp --version and acme-bench score"));
  it("keeps the worker package name", () => expect(C("npm run build -w opal42-mcp-worker")).toBe("npm run build -w opal42-mcp-worker"));
  it("keeps the MCP registry name", () => expect(C('"name": "io.github.Owner/opal42-mcp"', "packages/mcp/server.json")).toBe('"name": "io.github.Owner/opal42-mcp"'));
  it("keeps the stylelint rule namespace", () => expect(C("opal42/min-score and 'opal42/no-finding'")).toBe("opal42/min-score and 'opal42/no-finding'"));
  it("keeps VS Code settings and attributes", () => expect(C("opal42.minScore and attributes.opal42.score")).toBe("opal42.minScore and attributes.opal42.score"));
  it("keeps the scope", () => expect(C("`@opal42/gradient` and npx opal42")).toBe("`@opal42/gradient` and npx acme"));
  it("keeps brand words outside CLI-owned files", () => expect(C("opal42 MCP (hosted)", "apps/worker/src/status.ts")).toBe("opal42 MCP (hosted)"));
  it("renames the CLI sentence form", () => expect(C("with the opal42 CLI")).toBe("with the acme CLI"));
  it("renames pre-commit entries", () => expect(C("entry: opal42 score", ".pre-commit-hooks.yaml")).toBe("entry: acme score"));
  it("renames npm install forms", () => expect(C("npm install -g opal42\nnpm i opal42@latest")).toBe("npm install -g acme\nnpm i acme@latest"));
  it("renames the tool name in JSON", () => expect(C('"tool": { "name": "opal42", "version": "1" }', "docs/other.md")).toContain('"name": "acme"'));
  it("renames release.config.json", () => expect(C('"cliName": "opal42"', "release.config.json")).toBe('"cliName": "acme"'));
  it("renames backticked names in the packaging docs", () => expect(C("`opal42` (CLI)", "docs/PACKAGING.md")).toBe("`acme` (CLI)"));
  it("does not rename backticked names in other docs", () => expect(C("source `opal42`", "apps/vscode/README.md")).toBe("source `opal42`"));
  it("is idempotent", () => { const once = C("npx opal42 score"); expect(C(once)).toBe(once); });
  it("is a no-op for the same name", () => expect(rewriteCliName("npx opal42", "opal42", "opal42", "a").count).toBe(0));
  it("copes with a new name that starts with the old one", () => { const once = C("npx opal42 score", "docs/x.md", "opal42-cli"); expect(once).toBe("npx opal42-cli score"); expect(C(once, "docs/x.md", "opal42-cli")).toBe(once); });
});

describe("file selection", () => {
  it("skips binaries, build output and the planning record", () => {
    for (const p of ["docs/social-preview.png", "packages/core/dist/a.js", "docs/PLAN.md", "docs/plan-research/a.md", "apps/worker/.wrangler/state/x.sqlite", "scripts/tests/a.test.mjs", "scripts/rename-scope.mjs"]) expect(isSkipped(p), p).toBe(true);
  });
  it("includes sources, docs, workflows and changesets", () => {
    for (const p of ["packages/core/src/a.ts", "README.md", "docs/RELEASING.md", ".github/workflows/ci.yml", ".changeset/a.md", "release.config.json", "CHANGELOG.md"]) expect(isSkipped(p), p).toBe(false);
  });
  it("knows which files own the CLI name", () => { expect(isCliOwned("packages/cli/README.md")).toBe(true); expect(isCliOwned("packages/mcp/README.md")).toBe(false); });
});

describe("worker config", () => {
  it("renames the scope in wrangler aliases", () => expect(isSkipped("apps/worker/wrangler.jsonc")).toBe(false));
  it("keeps the deployed service name when the CLI is renamed", () => expect(rewriteCliName('"name": "opal42-mcp"', "opal42", "acme", "apps/worker/wrangler.jsonc").count).toBe(0));
});

describe("regex literals", () => {
  it("renames the CLI name inside a regex literal in a test", () => expect(C("expect(x).toMatch(/opal42 --help/)", "packages/cli/tests/a.test.ts")).toBe("expect(x).toMatch(/acme --help/)"));
  it("renames derived bins inside a regex literal", () => expect(C("toMatch(/opal42-bench:/)", "packages/bench/tests/cli.test.ts")).toBe("toMatch(/acme-bench:/)"));
  it("leaves path-like text alone", () => expect(C("import x from 'a/opal42/b'", "a.ts")).toBe("import x from 'a/opal42/b'"));
});
it("leaves regex literals of brand words alone", () => expect(C("toMatch(/opal42-gradient-score/)", "a.test.ts")).toBe("toMatch(/opal42-gradient-score/)"));

describe("changesets and punctuation", () => {
  it("renames the package key in a changeset frontmatter", () => expect(C('---\n"@opal42/gradient": minor\n"opal42": minor\n---\nx', ".changeset/a.md")).toBe('---\n"@opal42/gradient": minor\n"acme": minor\n---\nx'));
  it("renames an unquoted changeset key", () => expect(C("---\nopal42: patch\n---", ".changeset/a.md")).toBe("---\nacme: patch\n---"));
  it("renames npx followed by a closing parenthesis", () => expect(C("(npx opal42)")).toBe("(npx acme)"));
});

describe("rewriteFile", () => {
  const o = { oldScope: "@opal42", newScope: "@acme", oldCli: "opal42", newCli: "acme" };
  it("keeps example commands of this tool", () => expect(rewriteFile("docs/RELEASING.md", "node scripts/rename-scope.mjs @opal42 @acme\nimport '@opal42/gradient'", o).text).toBe("node scripts/rename-scope.mjs @opal42 @acme\nimport '@acme/gradient'"));
  it("applies the CLI rule before the scope rule", () => expect(rewriteFile("a.md", "npx opal42 and @opal42/mcp", o).text).toBe("npx acme and @acme/mcp"));
  it("counts both kinds of replacement", () => expect(rewriteFile("a.md", "npx opal42 and @opal42/mcp", o).count).toBe(2));
  it("renames only the scope without a CLI name", () => expect(rewriteFile("a.md", "npx opal42 and @opal42/mcp", { oldScope: "@opal42", newScope: "@acme" }).text).toBe("npx opal42 and @acme/mcp"));
});
