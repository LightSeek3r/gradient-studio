#!/usr/bin/env node
// Pre-publication gate: `npm run release:check`. Zero dependencies, Node >= 22.
//
// For every publish candidate in release.config.json (the single source of truth for
// names and tiers) it verifies the package metadata, that every exports/types/bin
// target ships in the tarball, the dependency ranges, the `npm pack` file list, and
// (tiers 1 and 2) installs the real tarballs into an empty project OUTSIDE the repo
// and runs them. Prints a table and exits non-zero on any failure. It never publishes.
//
// Flags: --no-smoke  skip the consumer smoke test      --no-pack  skip npm pack (pure checks only)
//        --json      machine-readable result           --require-public  fail on "private": true
//        --list N    print the package names of tier N (publish order) and exit
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ---------------------------------------------------------------- config -----

export const expand = (template, config) => template.replaceAll("{scope}", config.scope).replaceAll("{cli}", config.cliName);

/** Flat, ordered list of publish candidates: [{ tier, dir, name, bin }]. */
export function candidates(config) {
  const out = [];
  for (const tier of Object.keys(config.tiers).sort()) {
    for (const e of config.tiers[tier]) {
      out.push({ tier: Number(tier), dir: e.dir, name: expand(e.name, config), bin: (e.bin ?? []).map((b) => expand(b, config)) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- semver -----

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
export function parseSemver(v) {
  const m = SEMVER.exec(String(v));
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null } : null;
}
const cmp = (a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch || (a.pre === b.pre ? 0 : a.pre === null ? 1 : b.pre === null ? -1 : a.pre < b.pre ? -1 : 1);

function comparatorToTest(tok) {
  const m = /^(\^|~|>=|<=|>|<|=)?\s*(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:-([0-9A-Za-z.-]+))?$/.exec(tok);
  if (!m) return null;
  const op = m[1] ?? "=";
  const wild = (s) => s === undefined || s === "x" || s === "*";
  const lo = { major: +m[2], minor: wild(m[3]) ? 0 : +m[3], patch: wild(m[4]) ? 0 : +m[4], pre: m[5] ?? null };
  const partial = wild(m[3]) || wild(m[4]);
  if (op === "^") {
    let hi;
    if (lo.major > 0 || wild(m[3])) hi = { major: lo.major + 1, minor: 0, patch: 0 };
    else if (lo.minor > 0 || wild(m[4])) hi = { major: 0, minor: lo.minor + 1, patch: 0 };
    else hi = { major: 0, minor: 0, patch: lo.patch + 1 };
    return (v) => cmp(v, lo) >= 0 && cmp(v, { ...hi, pre: null }) < 0;
  }
  if (op === "~") {
    const hi = wild(m[3]) ? { major: lo.major + 1, minor: 0, patch: 0 } : { major: lo.major, minor: lo.minor + 1, patch: 0 };
    return (v) => cmp(v, lo) >= 0 && cmp(v, { ...hi, pre: null }) < 0;
  }
  if (op === ">=") return (v) => cmp(v, lo) >= 0;
  if (op === ">") return (v) => cmp(v, lo) > 0;
  if (op === "<=") return (v) => cmp(v, lo) <= 0;
  if (op === "<") return (v) => cmp(v, lo) < 0;
  if (partial) {
    const hi = wild(m[3]) ? { major: lo.major + 1, minor: 0, patch: 0 } : { major: lo.major, minor: lo.minor + 1, patch: 0 };
    return (v) => cmp(v, lo) >= 0 && cmp(v, { ...hi, pre: null }) < 0;
  }
  return (v) => cmp(v, lo) === 0;
}

/** Tiny range evaluator: exact, ^, ~, comparators, x-ranges, space = AND, || = OR. null if unparseable. */
export function rangeTest(range) {
  const sets = String(range).split("||").map((s) => s.trim().replace(/(>=|<=|>|<|\^|~|=)\s+/g, "$1").split(/\s+/).filter(Boolean));
  const tests = [];
  for (const set of sets) {
    if (set.length === 0) return null;
    const parts = set.map(comparatorToTest);
    if (parts.some((p) => p === null)) return null;
    tests.push((v) => parts.every((p) => p(v)));
  }
  return (v) => tests.some((t) => t(v));
}
export function satisfies(version, range) {
  const v = parseSemver(version);
  const t = rangeTest(range);
  return v !== null && t !== null && t(v);
}
/** True for ranges that must never reach a published manifest. */
export const isUnpublishableRange = (r) => typeof r !== "string" || /^(workspace:|file:|link:|git|github:|https?:|npm:)|^\s*$|^(\*|x|latest|next)$/i.test(r.trim()) || r.includes("/");

// ---------------------------------------------------------------- checks -----
// Each returns an array of human-readable failure strings (empty = pass).

const isHttp = (u) => typeof u === "string" && /^https:\/\/\S+$/.test(u);
const stripGit = (u) => String(u ?? "").replace(/^git\+/, "").replace(/\.git$/, "");

export function checkMetadata({ pkg, entry, config, root }) {
  const f = [];
  const scoped = entry.name.startsWith("@");
  if (pkg.name !== entry.name) f.push(`name is "${pkg.name}", release.config.json expects "${entry.name}"`);
  if (scoped && !entry.name.startsWith(`${config.scope}/`)) f.push(`"${entry.name}" is outside the configured scope ${config.scope}`);
  if (!scoped && entry.name.includes("/")) f.push(`"${entry.name}" is not a valid package name`);
  if (!parseSemver(pkg.version)) f.push(`version "${pkg.version}" is not valid semver`);
  if (typeof pkg.description !== "string" || pkg.description.trim().length < 20) f.push("description is missing or too short");
  if (typeof pkg.license !== "string" || !pkg.license) f.push("license is missing");
  else if (root.license && pkg.license !== root.license) f.push(`license "${pkg.license}" differs from the root license "${root.license}"`);
  if (!pkg.author) f.push("author is missing");
  if (pkg.type !== "module") f.push(`type is "${pkg.type}", expected "module" (ESM only)`);
  const repo = pkg.repository;
  if (!repo || typeof repo !== "object") f.push("repository must be an object with type, url and directory");
  else {
    if (repo.type !== "git") f.push('repository.type must be "git"');
    if (!/^git\+https:\/\/.+\.git$/.test(repo.url ?? "")) f.push("repository.url must look like git+https://host/owner/repo.git");
    else if (root.repoUrl && stripGit(repo.url) !== stripGit(root.repoUrl)) f.push("repository.url differs from the root package.json");
    if (repo.directory !== entry.dir) f.push(`repository.directory is "${repo.directory}", expected "${entry.dir}"`);
  }
  if (!isHttp(pkg.bugs?.url)) f.push("bugs.url must be an https URL");
  if (!isHttp(pkg.homepage)) f.push("homepage must be an https URL");
  const kw = pkg.keywords;
  if (!Array.isArray(kw) || kw.length < 3 || kw.some((k) => typeof k !== "string" || !k.trim()) || new Set(kw).size !== kw.length) f.push("keywords must be 3 or more unique, non-empty strings");
  if (!/^>=\s*\d+/.test(pkg.engines?.node ?? "")) f.push('engines.node must be set (for example ">=22")');
  else if (root.nodeMin && pkg.engines.node.replace(/\s/g, "") !== root.nodeMin) f.push(`engines.node "${pkg.engines.node}" differs from the other packages (${root.nodeMin})`);
  if (scoped && pkg.publishConfig?.access !== "public") f.push('publishConfig.access must be "public" for a scoped package');
  if (pkg.publishConfig?.provenance !== true) f.push("publishConfig.provenance must be true");
  return f;
}

const BAD_FILES = [
  [/(^|\/)(tests?|__tests__|e2e|fixtures)\//i, "test or fixture file"],
  [/\.(test|spec)\.[cm]?[jt]sx?$/i, "test file"],
  [/(^|\/)src\//, "TypeScript source (src/) is not meant to ship"],
  [/\.map$/, "source map"],
  [/(^|\/)\.env(\.|$)/i, "environment file"],
  [/\.(pem|key|p12|pfx|crt|cer)$/i, "key or certificate"],
  [/(^|\/)(id_rsa|id_ed25519|\.npmrc|\.netrc|secrets?\.[a-z]+|credentials?(\.[a-z]+)?)$/i, "credential file"],
  [/(^|\/)(\.git|\.github|\.wrangler|node_modules|coverage)(\/|$)/, "repository or tooling directory"],
  [/(^|\/)\.DS_Store$/, "OS junk"],
  [/\.tsbuildinfo$/, "build cache"],
  [/(^|\/)(tsconfig[^/]*\.json|vitest\.config\.[cm]?[jt]s|tsdown\.config\.[cm]?[jt]s|\.size-limit[^/]*)$/, "build or test config"],
];
export function checkPackList(files, { unpackedSize = 0, maxKB = 2048, allow = [] } = {}) {
  const f = [];
  if (files.length === 0) f.push("npm pack produced an empty file list");
  for (const { path } of files) {
    if (allow.includes(path)) continue;
    for (const [re, why] of BAD_FILES) if (re.test(path)) { f.push(`${path}: ${why}`); break; }
  }
  if (unpackedSize > maxKB * 1024) f.push(`unpacked size ${(unpackedSize / 1024).toFixed(0)} kB exceeds ${maxKB} kB`);
  return f;
}

const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\bnpm_[A-Za-z0-9]{36}\b/, "npm token"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, "GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
  [/\bsk-[A-Za-z0-9]{32,}\b/, "API secret key"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/\/\/registry\.npmjs\.org\/:_authToken=/, ".npmrc auth line"],
];
export function scanSecrets(text) {
  return SECRET_PATTERNS.filter(([re]) => re.test(text)).map(([, name]) => name);
}

const norm = (p) => String(p).replace(/^\.\//, "");
/** Targets reachable from main/module/types/bin/exports. Skips the workspace-only `source` condition. */
export function collectTargets(pkg) {
  const out = [];
  const add = (where, v) => out.push({ where, path: v });
  for (const k of ["main", "module", "types", "typings"]) if (pkg[k] !== undefined) add(k, pkg[k]);
  if (typeof pkg.bin === "string") add("bin", pkg.bin);
  else for (const [k, v] of Object.entries(pkg.bin ?? {})) add(`bin.${k}`, v);
  const walk = (where, v) => {
    if (typeof v === "string") add(where, v);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(`${where}[${i}]`, x));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "source") walk(`${where}.${k}`, x);
  };
  if (pkg.exports !== undefined) walk("exports", pkg.exports);
  return out;
}
export function checkTargets(pkg, packed) {
  const f = [];
  const set = new Set(packed.map(norm));
  if (pkg.exports === undefined) f.push("exports is missing");
  if (!pkg.types && !pkg.exports) f.push("types is missing");
  for (const { where, path } of collectTargets(pkg)) {
    if (typeof path !== "string" || !path.startsWith("./")) { f.push(`${where}: "${path}" must start with ./`); continue; }
    const p = norm(path);
    if (p === "package.json") continue;
    if (p.includes("*")) {
      const re = new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".+")}$`);
      if (![...set].some((x) => re.test(x))) f.push(`${where}: pattern ${path} matches no packed file`);
    } else if (!set.has(p)) f.push(`${where}: ${path} is not in the tarball (not built, or excluded by "files")`);
  }
  return f;
}

export function checkFilesField(pkg) {
  const f = [];
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) return ["files whitelist is missing"];
  for (const e of pkg.files) {
    if (typeof e !== "string") f.push(`files entry ${JSON.stringify(e)} is not a string`);
    else if (/^(\.|\*+$|\/)/.test(e) && !e.startsWith("./")) f.push(`files entry "${e}" is too broad`);
    else if (/(^|\/)(src|tests?|__tests__|node_modules)(\/|$)/.test(e)) f.push(`files entry "${e}" should not be published`);
  }
  if (!pkg.files.some((e) => /^(\.\/)?dist\/?$/.test(e) || /^(\.\/)?dist\//.test(e))) f.push('files must include "dist"');
  return f;
}

export function checkSideEffects(pkg, packed) {
  const se = pkg.sideEffects;
  if (se === undefined) return ["sideEffects is not declared (false, or the list of files with side effects)"];
  if (se === false) return [];
  if (!Array.isArray(se) || se.length === 0 || se.some((s) => typeof s !== "string")) return ["sideEffects must be false or a non-empty array of paths"];
  const set = new Set(packed.map(norm));
  return se.filter((s) => !s.includes("*") && !set.has(norm(s))).map((s) => `sideEffects entry ${s} is not in the tarball`);
}

export function checkDocs({ pkg, packed, readme, licenseText, rootLicenseText }) {
  const f = [];
  const set = new Set(packed.map(norm));
  if (!set.has("README.md")) f.push("README.md is not in the tarball");
  else if (readme !== undefined) {
    if (readme.trim().length < 200) f.push("README.md is shorter than 200 characters");
    if (!readme.includes(pkg.name)) f.push(`README.md never mentions "${pkg.name}"`);
  }
  if (![...set].some((p) => /^licen[cs]e(\.md|\.txt)?$/i.test(p))) f.push("LICENSE is not in the tarball");
  else if (licenseText !== undefined && rootLicenseText !== undefined && licenseText.trim() !== rootLicenseText.trim()) f.push("LICENSE differs from the repository root LICENSE");
  return f;
}

export function checkBins({ pkg, entry, firstLines = {} }) {
  const f = [];
  const bins = typeof pkg.bin === "string" ? { [pkg.name]: pkg.bin } : (pkg.bin ?? {});
  const names = Object.keys(bins).sort();
  const want = [...entry.bin].sort();
  if (names.join() !== want.join()) f.push(`bin names are [${names}], release.config.json expects [${want}]`);
  for (const [name, target] of Object.entries(bins)) {
    const line = firstLines[norm(target)];
    if (line !== undefined && !/^#!\/usr\/bin\/env node\s*$/.test(line)) f.push(`bin ${name}: ${target} lacks the "#!/usr/bin/env node" shebang`);
  }
  return f;
}

/**
 * Dependency ranges of what actually gets installed (dependencies, peerDependencies,
 * optionalDependencies). `workspace` = Map of every workspace package name -> version;
 * `order` = Map of candidate name -> [tier, index] to enforce publish order.
 */
export function checkDependencies({ pkg, entry, workspace, order }) {
  const f = [];
  const mine = order.get(pkg.name);
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [dep, range] of Object.entries(pkg[field] ?? {})) {
      if (isUnpublishableRange(range)) { f.push(`${field}.${dep}: "${range}" is not publishable (use a real semver range)`); continue; }
      if (rangeTest(range) === null) { f.push(`${field}.${dep}: "${range}" is not a valid semver range`); continue; }
      if (!workspace.has(dep)) continue;
      const ver = workspace.get(dep);
      if (!satisfies(ver, range)) f.push(`${field}.${dep}: "${range}" is not satisfied by the workspace version ${ver}`);
      const theirs = order.get(dep);
      if (!theirs) f.push(`${field}.${dep}: workspace package is not a publish candidate, so it can never be installed`);
      else if (theirs[0] > mine[0] || (theirs[0] === mine[0] && theirs[1] > mine[1])) f.push(`${field}.${dep}: published after ${pkg.name} (tier ${theirs[0]}); fix the order in release.config.json`);
      if (field === "dependencies" && range === "*") f.push(`${field}.${dep}: "*" accepts any version`);
    }
  }
  return f;
}

/** A 0.0.0 package only becomes publishable through a pending changeset. */
export function checkChangeset({ pkg, pending }) {
  if (pkg.version !== "0.0.0") return [];
  return pending.has(pkg.name) ? [] : [`version is 0.0.0 and no pending .changeset/*.md bumps ${pkg.name}`];
}

export function parseChangesetNames(markdown) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!m) return [];
  return m[1].split(/\r?\n/).map((l) => /^\s*["']?([^"':]+)["']?\s*:\s*(major|minor|patch)\s*$/.exec(l)?.[1]).filter(Boolean);
}

// ------------------------------------------------------------------ io -------

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300_000, ...opts });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "", error: r.error };
}

function packDryRun(dir) {
  const r = run(NPM, ["pack", "--json", "--dry-run", "--ignore-scripts"], { cwd: dir });
  if (r.code !== 0) throw new Error(`npm pack --dry-run failed: ${r.err.trim().split("\n").slice(-3).join(" | ")}`);
  const j = JSON.parse(r.out)[0];
  return { files: j.files.map((x) => ({ path: x.path, size: x.size })), unpackedSize: j.unpackedSize, size: j.size };
}

function textOf(dir, rel) {
  try { return readFileSync(join(dir, rel), "utf8"); } catch { return undefined; }
}

function loadWorkspace(root) {
  const m = new Map();
  for (const group of ["packages", "apps"]) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base)) {
      const p = join(base, d, "package.json");
      if (existsSync(p)) { const j = readJson(p); m.set(j.name, j.version); }
    }
  }
  return m;
}

function pendingChangesets(root) {
  const dir = join(root, ".changeset");
  const names = new Set();
  if (!existsSync(dir)) return names;
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".md") && f !== "README.md") parseChangesetNames(readFileSync(join(dir, f), "utf8")).forEach((n) => names.add(n));
  }
  return names;
}

// --------------------------------------------------------------- smoke -------

const SMOKE_CSS = "a{background:linear-gradient(90deg,#ff0000,#00ff00 50%,#0000ff)}";

/** Install the real tarballs of tiers 1 and 2 into an empty temp project and use them. */
export function smokeTest({ root, config, cands, log = () => {} }) {
  const results = new Map(); // name -> failures[]
  const fail = (name, msg) => { if (!results.has(name)) results.set(name, []); results.get(name).push(msg); };
  const smoked = cands.filter((c) => c.tier <= 2);
  smoked.forEach((c) => results.set(c.name, []));
  const tmp = mkdtempSync(join(tmpdir(), "release-check-"));
  try {
    const packDir = join(tmp, "tarballs");
    const proj = join(tmp, "consumer");
    for (const d of [packDir, proj]) mkdirSync(d, { recursive: true });
    const tarballs = [];
    for (const c of smoked) {
      const r = run(NPM, ["pack", "--json", "--ignore-scripts", "--pack-destination", packDir], { cwd: join(root, c.dir) });
      if (r.code !== 0) { fail(c.name, `npm pack failed: ${r.err.trim().split("\n").pop()}`); continue; }
      tarballs.push(join(packDir, JSON.parse(r.out)[0].filename));
    }
    if ([...results.values()].some((v) => v.length)) return results;
    writeFileSync(join(proj, "package.json"), JSON.stringify({ name: "release-check-consumer", private: true, type: "module", version: "0.0.0" }));
    const stylelintRange = readJson(join(root, "packages/stylelint-plugin/package.json")).devDependencies?.stylelint ?? "^16.14.0";
    log("npm install of the tarballs into a clean project ...");
    const inst = run(NPM, ["install", "--no-audit", "--no-fund", "--ignore-scripts", "--prefer-offline", ...tarballs, `stylelint@${stylelintRange}`], { cwd: proj, timeout: 600_000 });
    if (inst.code !== 0) {
      const msg = `clean install of the tarballs failed: ${inst.err.trim().split("\n").filter((l) => /npm (error|ERR!)/.test(l)).slice(0, 3).join(" | ")}`;
      smoked.forEach((c) => fail(c.name, msg));
      return results;
    }
    const byDir = (d) => smoked.find((c) => c.dir === d);
    const verOf = (c) => readJson(join(root, c.dir, "package.json")).version;
    const node = (args, input) => run(process.execPath, args, { cwd: proj, input, timeout: 60_000 });
    const npx = (args, input) => run(NPM === "npm.cmd" ? "npx.cmd" : "npx", ["--no-install", ...args], { cwd: proj, input, timeout: 60_000 });

    const core = byDir("packages/core");
    if (core) {
      const r = node(["--input-type=module", "-e", `import * as g from ${JSON.stringify(core.name)};
const { gradients } = g.parseGradient(${JSON.stringify(SMOKE_CSS)});
const s = g.scoreParsed(gradients[0]);
if (s.status !== "ok" || !(s.score >= 0 && s.score <= 100)) throw new Error("bad score " + JSON.stringify(s));
const c = await import(${JSON.stringify(core.name + "/color")});
if (typeof c.parseAnyColor !== "function") throw new Error("subpath ./color missing parseAnyColor");
console.log("score=" + s.score);`]);
      if (r.code !== 0 || !/score=\d+/.test(r.out)) fail(core.name, `import and score failed: ${(r.err || r.out).trim().split("\n").slice(-2).join(" | ")}`);
    }
    const cli = byDir("packages/cli");
    if (cli) {
      const bin = cli.bin[0];
      const v = npx([bin, "--version"]);
      if (v.code !== 0 || v.out.trim() !== verOf(cli)) fail(cli.name, `${bin} --version printed "${v.out.trim()}", expected ${verOf(cli)} (${v.err.trim().split("\n").pop()})`);
      const s = npx([bin, "score", "--json", "-"], SMOKE_CSS);
      try {
        const j = JSON.parse(s.out);
        if (j.schemaVersion !== 1 || !(j.files?.[0]?.gradients?.length >= 1)) fail(cli.name, "score --json - did not report a gradient");
      } catch { fail(cli.name, `score --json - printed no JSON (exit ${s.code}): ${s.err.trim().split("\n").pop()}`); }
    }
    const plugin = byDir("packages/stylelint-plugin");
    if (plugin) {
      const r = node(["--input-type=module", "-e", `import stylelint from "stylelint";
const mod = await import(${JSON.stringify(plugin.name)});
const rule = [mod.default].flat().map((p) => p.ruleName).find((n) => n.endsWith("/min-score"));
if (!rule) throw new Error("plugin exports no */min-score rule");
const res = await stylelint.lint({ code: ${JSON.stringify(SMOKE_CSS)}, config: { plugins: [${JSON.stringify(plugin.name)}], rules: { [rule]: 100 } } });
const w = res.results[0].warnings;
if (!w.some((x) => x.rule === rule)) throw new Error("min-score 100 reported nothing: " + JSON.stringify(w));
console.log("stylelint ok " + rule);`]);
      if (r.code !== 0 || !r.out.includes("stylelint ok")) fail(plugin.name, `stylelint run failed: ${(r.err || r.out).trim().split("\n").slice(-2).join(" | ")}`);
    }
    const mcp = byDir("packages/mcp");
    if (mcp) {
      const bin = mcp.bin[0];
      const v = npx([bin, "--version"]);
      if (v.code !== 0 || v.out.trim() !== verOf(mcp)) fail(mcp.name, `${bin} --version printed "${v.out.trim()}", expected ${verOf(mcp)} (${v.err.trim().split("\n").pop()})`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return results;
}

// ---------------------------------------------------------------- main -------

function table(rows) {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r, n) => r.map((c, i) => String(c).padEnd(w[i])).join("  ").trimEnd() + (n === 0 ? `\n${w.map((x) => "-".repeat(x)).join("  ")}` : "")).join("\n");
}

export async function main(argv = process.argv.slice(2), root = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  const flag = (n) => argv.includes(n);
  const config = readJson(join(root, "release.config.json"));
  const cands = candidates(config);
  if (flag("--list")) {
    const tier = Number(argv[argv.indexOf("--list") + 1]);
    for (const c of cands.filter((x) => x.tier === tier)) console.log(c.name);
    return cands.some((x) => x.tier === tier) ? 0 : 2;
  }
  const rootPkg = readJson(join(root, "package.json"));
  const rootInfo = {
    license: rootPkg.license,
    repoUrl: rootPkg.repository?.url,
    nodeMin: readJson(join(root, cands[0].dir, "package.json")).engines?.node?.replace(/\s/g, ""),
  };
  const rootLicenseText = textOf(root, "LICENSE");
  const workspace = loadWorkspace(root);
  const pending = pendingChangesets(root);
  const order = new Map(cands.map((c, i) => [c.name, [c.tier, cands.filter((x) => x.tier === c.tier).indexOf(c)]]));
  const report = [];
  for (const c of cands) {
    const dir = join(root, c.dir);
    const row = { name: c.name, tier: c.tier, private: false, groups: { metadata: [], exports: [], pack: [], deps: [], smoke: null }, size: "" };
    report.push(row);
    if (!existsSync(join(dir, "package.json"))) { row.groups.metadata.push(`${c.dir}/package.json does not exist`); continue; }
    const pkg = readJson(join(dir, "package.json"));
    row.private = pkg.private === true;
    const G = row.groups;
    G.metadata.push(...checkMetadata({ pkg, entry: { ...c }, config, root: rootInfo }), ...checkFilesField(pkg), ...checkChangeset({ pkg, pending }));
    if (flag("--require-public") && pkg.private === true) G.metadata.push('"private": true is still set (set-private.mjs)');
    G.deps.push(...checkDependencies({ pkg, entry: c, workspace, order }));
    if (flag("--no-pack")) continue;
    let pack;
    try { pack = packDryRun(dir); } catch (e) { G.pack.push(e.message); continue; }
    const paths = pack.files.map((x) => x.path);
    row.size = `${(pack.size / 1024).toFixed(0)} kB / ${(pack.unpackedSize / 1024).toFixed(0)} kB, ${paths.length} files`;
    G.pack.push(...checkPackList(pack.files, { unpackedSize: pack.unpackedSize, maxKB: config.maxUnpackedKB }));
    for (const p of paths) {
      const txt = /\.(js|mjs|cjs|json|md|txt|css|html|d\.ts|ya?ml)$/.test(p) ? textOf(dir, p) : undefined;
      if (txt) for (const s of scanSecrets(txt)) G.pack.push(`${p}: looks like a ${s}`);
    }
    const firstLines = {};
    for (const [, t] of Object.entries(typeof pkg.bin === "string" ? { x: pkg.bin } : (pkg.bin ?? {}))) firstLines[norm(t)] = (textOf(dir, t) ?? "").split("\n", 1)[0];
    G.exports.push(...checkTargets(pkg, paths), ...checkSideEffects(pkg, paths), ...checkBins({ pkg, entry: c, firstLines }), ...checkDocs({ pkg, packed: paths, readme: textOf(dir, "README.md"), licenseText: textOf(dir, "LICENSE"), rootLicenseText }));
  }
  if (!flag("--no-smoke") && !flag("--no-pack")) {
    const smoke = smokeTest({ root, config, cands, log: (m) => !flag("--json") && console.log(`  ${m}`) });
    for (const row of report) if (smoke.has(row.name)) row.groups.smoke = smoke.get(row.name);
  }
  const cell = (arr) => (arr === null ? "-" : arr.length === 0 ? "ok" : `FAIL(${arr.length})`);
  const failures = report.flatMap((r) => Object.entries(r.groups).flatMap(([g, arr]) => (arr ?? []).map((m) => ({ name: r.name, group: g, message: m }))));
  if (flag("--json")) {
    console.log(JSON.stringify({ ok: failures.length === 0, packages: report, failures }, null, 2));
  } else {
    console.log(table([["tier", "package", "private", "metadata", "exports", "pack", "deps", "smoke", "tarball (packed / unpacked)"], ...report.map((r) => [r.tier, r.name, r.private ? "yes" : "no", cell(r.groups.metadata), cell(r.groups.exports), cell(r.groups.pack), cell(r.groups.deps), cell(r.groups.smoke), r.size])]));
    if (failures.length) {
      console.log(`\n${failures.length} failure(s):`);
      for (const x of failures) console.log(`  [${x.group}] ${x.name}: ${x.message}`);
    } else {
      console.log(`\nAll ${report.length} publish candidates pass${flag("--no-smoke") ? " (smoke test skipped)" : ""}.`);
    }
    if (report.some((r) => r.private)) console.log('Note: packages with "private": true cannot be published yet; see docs/RELEASING.md step 5.');
  }
  return failures.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code), (e) => { console.error(`release-check: ${e.stack ?? e}`); process.exit(2); });
}
