import { describe, expect, it } from "vitest";
import {
  candidates, checkBins, checkChangeset, checkDependencies, checkDocs, checkFilesField, checkMetadata, checkPackList,
  checkSideEffects, checkTargets, collectTargets, expand, isUnpublishableRange, parseChangesetNames, parseSemver, rangeTest, satisfies, scanSecrets,
} from "../release-check.mjs";

const config = {
  scope: "@acme",
  cliName: "acme",
  tiers: {
    1: [{ dir: "packages/core", name: "{scope}/gradient" }, { dir: "packages/cli", name: "{cli}", bin: ["{cli}"] }],
    2: [{ dir: "packages/mcp", name: "{scope}/mcp", bin: ["{cli}-mcp"] }],
  },
};
const root = { license: "MIT", repoUrl: "git+https://github.com/o/r.git", nodeMin: ">=22" };
const goodPkg = () => ({
  name: "@acme/gradient", version: "0.1.0", description: "A deterministic gradient scorer for CSS.", license: "MIT", author: "A (https://a.dev)", type: "module",
  homepage: "https://github.com/o/r/tree/master/packages/core#readme", bugs: { url: "https://github.com/o/r/issues" },
  repository: { type: "git", url: "git+https://github.com/o/r.git", directory: "packages/core" },
  keywords: ["gradient", "css", "oklab"], engines: { node: ">=22" }, files: ["dist"], sideEffects: false,
  exports: { ".": { source: "./src/index.ts", types: "./dist/index.d.ts", default: "./dist/index.js" }, "./package.json": "./package.json" },
  main: "./dist/index.js", types: "./dist/index.d.ts", publishConfig: { access: "public", provenance: true },
});
const entry = { dir: "packages/core", name: "@acme/gradient", tier: 1, bin: [] };
const meta = (patch) => checkMetadata({ pkg: { ...goodPkg(), ...patch }, entry, config, root });

describe("config", () => {
  it("expands placeholders", () => expect(expand("{scope}/x-{cli}", config)).toBe("@acme/x-acme"));
  it("flattens tiers in publish order", () => expect(candidates(config).map((c) => `${c.tier}:${c.name}`)).toEqual(["1:@acme/gradient", "1:acme", "2:@acme/mcp"]));
  it("expands bin names", () => expect(candidates(config)[2].bin).toEqual(["acme-mcp"]));
});

describe("semver", () => {
  it("parses versions", () => expect(parseSemver("1.2.3-rc.1")).toMatchObject({ major: 1, minor: 2, patch: 3, pre: "rc.1" }));
  it("rejects bad versions", () => { expect(parseSemver("1.2")).toBeNull(); expect(parseSemver("v1.2.3")).toBeNull(); });
  it("caret on 0.0.x is exact", () => { expect(satisfies("0.0.0", "^0.0.0")).toBe(true); expect(satisfies("0.1.0", "^0.0.0")).toBe(false); });
  it("caret on 0.y allows patches only", () => { expect(satisfies("0.1.9", "^0.1.0")).toBe(true); expect(satisfies("0.2.0", "^0.1.0")).toBe(false); });
  it("caret on 1.x allows minors", () => { expect(satisfies("1.9.0", "^1.2.0")).toBe(true); expect(satisfies("2.0.0", "^1.2.0")).toBe(false); });
  it("tilde, comparators and ||", () => {
    expect(satisfies("1.2.9", "~1.2.3")).toBe(true);
    expect(satisfies("1.3.0", "~1.2.3")).toBe(false);
    expect(satisfies("16.20.0", ">=16.14.0")).toBe(true);
    expect(satisfies("3.0.0", ">=2 <3 || >=4")).toBe(false);
    expect(satisfies("4.1.0", ">=2 <3 || >=4")).toBe(true);
  });
  it("returns null for garbage ranges", () => expect(rangeTest("not a range")).toBeNull());
  it("flags unpublishable ranges", () => {
    for (const r of ["workspace:*", "file:../x", "link:../x", "*", "latest", "", "git+https://x/y.git", "github:o/r", "https://x/y.tgz", "o/r"]) expect(isUnpublishableRange(r), r).toBe(true);
    for (const r of ["^0.1.0", "~1.2.3", ">=16.14.0", "1.2.3"]) expect(isUnpublishableRange(r), r).toBe(false);
  });
});

describe("checkMetadata", () => {
  it("passes a complete manifest", () => expect(meta({})).toEqual([]));
  it("catches a name outside the scope", () => expect(meta({ name: "@other/gradient" }).join()).toMatch(/expects "@acme\/gradient"/));
  it("catches an unscoped name where a scope is expected", () => expect(meta({ name: "gradient" }).join()).toMatch(/expects/));
  it("catches a bad version", () => expect(meta({ version: "1.0" }).join()).toMatch(/not valid semver/));
  it("catches a missing license and a different one", () => {
    expect(meta({ license: undefined }).join()).toMatch(/license is missing/);
    expect(meta({ license: "ISC" }).join()).toMatch(/differs from the root/);
  });
  it("catches a string repository", () => expect(meta({ repository: "github:o/r" }).join()).toMatch(/repository must be an object/));
  it("catches a wrong repository.directory", () => expect(meta({ repository: { ...goodPkg().repository, directory: "packages/x" } }).join()).toMatch(/directory is "packages\/x"/));
  it("catches a repository url without git+https", () => expect(meta({ repository: { type: "git", url: "https://github.com/o/r", directory: "packages/core" } }).join()).toMatch(/git\+https/));
  it("catches a repository that differs from the root", () => expect(meta({ repository: { type: "git", url: "git+https://github.com/x/y.git", directory: "packages/core" } }).join()).toMatch(/differs from the root/));
  it("catches missing bugs, homepage and keywords", () => {
    const out = meta({ bugs: undefined, homepage: "http://x", keywords: ["a"] }).join();
    expect(out).toMatch(/bugs\.url/); expect(out).toMatch(/homepage/); expect(out).toMatch(/keywords/);
  });
  it("catches duplicate keywords", () => expect(meta({ keywords: ["a", "a", "b"] }).join()).toMatch(/keywords/));
  it("catches missing engines and mismatching engines", () => {
    expect(meta({ engines: undefined }).join()).toMatch(/engines\.node/);
    expect(meta({ engines: { node: ">=20" } }).join()).toMatch(/differs from the other packages/);
  });
  it("requires public access for scoped packages", () => expect(meta({ publishConfig: { provenance: true } }).join()).toMatch(/access must be "public"/));
  it("requires provenance", () => expect(meta({ publishConfig: { access: "public" } }).join()).toMatch(/provenance/));
  it("requires ESM", () => expect(meta({ type: undefined }).join()).toMatch(/type is/));
});

describe("checkFilesField / checkPackList", () => {
  it("accepts dist", () => expect(checkFilesField(goodPkg())).toEqual([]));
  it("rejects a missing whitelist", () => expect(checkFilesField({})).toHaveLength(1));
  it("rejects src in files", () => expect(checkFilesField({ files: ["dist", "src"] }).join()).toMatch(/should not be published/));
  it("requires dist", () => expect(checkFilesField({ files: ["lib"] }).join()).toMatch(/include "dist"/));
  const f = (...paths) => paths.map((path) => ({ path, size: 1 }));
  it("passes a clean list", () => expect(checkPackList(f("package.json", "README.md", "LICENSE", "dist/index.js", "dist/index.d.ts"))).toEqual([]));
  it("flags tests, sources, maps and env files", () => {
    const out = checkPackList(f("dist/index.js", "tests/a.test.ts", "src/a.ts", "dist/a.js.map", ".env", ".env.local", "dist/x.spec.js")).join("\n");
    for (const p of ["tests/a.test.ts", "src/a.ts", "dist/a.js.map", ".env", ".env.local", "dist/x.spec.js"]) expect(out).toContain(p);
  });
  it("flags keys and credentials", () => expect(checkPackList(f("certs/server.pem", ".npmrc", "id_rsa")).length).toBe(3));
  it("flags build config", () => expect(checkPackList(f("tsconfig.json", "tsdown.config.ts")).length).toBe(2));
  it("honours the allow list", () => expect(checkPackList(f("dist/a.js.map"), { allow: ["dist/a.js.map"] })).toEqual([]));
  it("flags oversize packages", () => expect(checkPackList(f("dist/a.js"), { unpackedSize: 3 * 1024 * 1024, maxKB: 2048 }).join()).toMatch(/exceeds/));
  it("flags an empty list", () => expect(checkPackList([])).toHaveLength(1));
});

describe("secrets", () => {
  it("finds private keys and tokens", () => {
    expect(scanSecrets("-----BEGIN RSA PRIVATE KEY-----\nabc")).toContain("private key");
    expect(scanSecrets("token npm_" + "a".repeat(36))).toContain("npm token");
    expect(scanSecrets("ghp_" + "b".repeat(36))).toContain("GitHub token");
    expect(scanSecrets("AKIA" + "A".repeat(16))).toContain("AWS access key id");
    expect(scanSecrets("//registry.npmjs.org/:_authToken=abc")).toContain(".npmrc auth line");
  });
  it("is quiet on ordinary code", () => expect(scanSecrets("export const score = (x) => x * 100; // npm_config is fine")).toEqual([]));
});

describe("targets", () => {
  const pkg = goodPkg();
  it("skips the workspace-only source condition", () => expect(collectTargets(pkg).map((t) => t.path)).not.toContain("./src/index.ts"));
  it("collects main, types, exports and bin", () => {
    const t = collectTargets({ ...pkg, bin: { acme: "./dist/cli.js" } }).map((x) => x.where);
    expect(t).toEqual(expect.arrayContaining(["main", "types", "exports...types", "exports...default", "bin.acme"]));
  });
  it("passes when every target is packed", () => expect(checkTargets(pkg, ["dist/index.js", "dist/index.d.ts", "package.json"])).toEqual([]));
  it("fails when a target is missing after build", () => expect(checkTargets(pkg, ["dist/index.js"]).join()).toMatch(/dist\/index\.d\.ts is not in the tarball/));
  it("fails on targets without ./", () => expect(checkTargets({ ...pkg, main: "dist/index.js" }, ["dist/index.js", "dist/index.d.ts"]).join()).toMatch(/must start with/));
  it("matches wildcard exports", () => expect(checkTargets({ exports: { "./x/*": "./dist/x/*.js" }, types: "./a.d.ts" }, ["a.d.ts", "dist/x/a.js"])).toEqual([]));
  it("requires exports", () => expect(checkTargets({ main: "./a.js", types: "./a.d.ts" }, ["a.js", "a.d.ts"]).join()).toMatch(/exports is missing/));
});

describe("sideEffects", () => {
  it("requires a declaration", () => expect(checkSideEffects({}, [])).toHaveLength(1));
  it("accepts false", () => expect(checkSideEffects({ sideEffects: false }, [])).toEqual([]));
  it("checks listed files exist", () => {
    expect(checkSideEffects({ sideEffects: ["./dist/define.js"] }, ["dist/define.js"])).toEqual([]);
    expect(checkSideEffects({ sideEffects: ["./dist/define.js"] }, ["dist/a.js"]).join()).toMatch(/not in the tarball/);
  });
  it("rejects true", () => expect(checkSideEffects({ sideEffects: true }, [])).toHaveLength(1));
});

describe("docs", () => {
  const pkg = { name: "@acme/gradient" };
  const readme = "# @acme/gradient\n" + "x".repeat(250);
  const base = { pkg, packed: ["README.md", "LICENSE", "package.json"], readme, licenseText: "MIT\n", rootLicenseText: "MIT" };
  it("passes with README and LICENSE", () => expect(checkDocs(base)).toEqual([]));
  it("fails without README", () => expect(checkDocs({ ...base, packed: ["LICENSE"] }).join()).toMatch(/README\.md is not/));
  it("fails without LICENSE", () => expect(checkDocs({ ...base, packed: ["README.md"] }).join()).toMatch(/LICENSE is not/));
  it("fails when the LICENSE differs from the root", () => expect(checkDocs({ ...base, licenseText: "Other" }).join()).toMatch(/differs from the repository root/));
  it("fails when the README does not mention the package", () => expect(checkDocs({ ...base, readme: "x".repeat(300) }).join()).toMatch(/never mentions/));
  it("fails on a stub README", () => expect(checkDocs({ ...base, readme: "# @acme/gradient" }).join()).toMatch(/shorter than/));
});

describe("bins", () => {
  const cli = { name: "acme", bin: ["acme"] };
  it("passes matching names and shebang", () => expect(checkBins({ pkg: { name: "acme", bin: { acme: "./dist/cli.js" } }, entry: cli, firstLines: { "dist/cli.js": "#!/usr/bin/env node" } })).toEqual([]));
  it("fails on a renamed bin", () => expect(checkBins({ pkg: { name: "acme", bin: { opal: "./dist/cli.js" } }, entry: cli }).join()).toMatch(/bin names/));
  it("fails on a missing shebang", () => expect(checkBins({ pkg: { name: "acme", bin: { acme: "./dist/cli.js" } }, entry: cli, firstLines: { "dist/cli.js": "import x" } }).join()).toMatch(/shebang/));
  it("fails when a bin is expected but absent", () => expect(checkBins({ pkg: { name: "acme" }, entry: cli })).toHaveLength(1));
  it("accepts no bin when none is expected", () => expect(checkBins({ pkg: { name: "@acme/gradient" }, entry: { bin: [] } })).toEqual([]));
});

describe("checkDependencies", () => {
  const cands = candidates(config);
  const order = new Map(cands.map((c) => [c.name, [c.tier, cands.filter((x) => x.tier === c.tier).indexOf(c)]]));
  const workspace = new Map([["@acme/gradient", "0.1.0"], ["acme", "0.1.0"], ["@acme/mcp", "0.1.0"], ["@acme/web", "0.0.0"]]);
  const dep = (pkgName, fields) => checkDependencies({ pkg: { name: pkgName, ...fields }, entry: {}, workspace, order });
  it("passes a satisfied internal range", () => expect(dep("acme", { dependencies: { "@acme/gradient": "^0.1.0" } })).toEqual([]));
  it("fails workspace: ranges", () => expect(dep("acme", { dependencies: { "@acme/gradient": "workspace:*" } }).join()).toMatch(/not publishable/));
  it("fails * and file: ranges", () => {
    expect(dep("acme", { dependencies: { "@acme/gradient": "*" } }).join()).toMatch(/not publishable/);
    expect(dep("acme", { peerDependencies: { x: "file:../x" } }).join()).toMatch(/not publishable/);
  });
  it("fails an internal range the bumped version does not satisfy", () => expect(dep("acme", { dependencies: { "@acme/gradient": "^0.0.0" } }).join()).toMatch(/not satisfied by the workspace version 0\.1\.0/));
  it("ignores devDependencies", () => expect(dep("acme", { devDependencies: { "@acme/gradient": "workspace:*" } })).toEqual([]));
  it("fails a dependency on an app", () => expect(dep("acme", { dependencies: { "@acme/web": "^0.0.0" } }).join()).toMatch(/not a publish candidate/));
  it("fails when a dependency is published later", () => expect(dep("@acme/gradient", { dependencies: { "@acme/mcp": "^0.1.0" } }).join()).toMatch(/published after/));
  it("passes third-party ranges", () => expect(dep("@acme/mcp", { dependencies: { zod: "^4.0.0" }, peerDependencies: { stylelint: ">=16.14.0" } })).toEqual([]));
  it("fails an unparseable range", () => expect(dep("acme", { dependencies: { zod: "banana" } }).join()).toMatch(/not a valid semver range/));
});

describe("changesets", () => {
  it("parses package names from frontmatter", () => expect(parseChangesetNames('---\n"@acme/a": minor\nb: patch\n---\n\ntext')).toEqual(["@acme/a", "b"]));
  it("ignores files without frontmatter", () => expect(parseChangesetNames("no")).toEqual([]));
  it("requires a pending changeset for 0.0.0", () => {
    expect(checkChangeset({ pkg: { name: "a", version: "0.0.0" }, pending: new Set() })).toHaveLength(1);
    expect(checkChangeset({ pkg: { name: "a", version: "0.0.0" }, pending: new Set(["a"]) })).toEqual([]);
    expect(checkChangeset({ pkg: { name: "a", version: "0.1.0" }, pending: new Set() })).toEqual([]);
  });
});
