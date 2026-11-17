#!/usr/bin/env node
// Rename the npm scope (and optionally the unscoped CLI name) everywhere. Zero dependencies.
//
//   node scripts/rename-scope.mjs @opal42 @acme --dry-run
//   node scripts/rename-scope.mjs @opal42 @acme --cli-name acme
//
// What changes: package.json names and dependency keys, imports, workspace flags (-w @x/y),
// configs, CI, docs, READMEs, changesets, CHANGELOGs, release.config.json and (through a
// final `npm install`) the lockfile. What deliberately does not: brand strings that are not
// registry names (the `opal42/` stylelint rule namespace, `<opal42-gradient-score>` tags,
// VS Code settings, CSS variables), the planning record docs/PLAN.md and docs/plan-research/,
// and the Cloudflare worker service name (`name` in apps/worker/wrangler.jsonc).
// Refuses to run on a dirty git tree unless --force. Idempotent.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function normalizeScope(s) {
  const v = String(s ?? "").trim().replace(/^@?/, "@");
  if (!/^@[a-z0-9][a-z0-9._~-]{0,213}$/.test(v)) throw new Error(`"${s}" is not a valid npm scope (lowercase letters, digits, . _ ~ -)`);
  return v;
}
export function normalizeCliName(s) {
  const v = String(s ?? "").trim();
  if (!/^[a-z0-9][a-z0-9._~-]{0,213}$/.test(v) || v.startsWith("@")) throw new Error(`"${s}" is not a valid unscoped npm package name`);
  return v;
}

/** `@old` -> `@new` wherever it is a whole scope (also in regex literals and URL-encoded). */
export function rewriteScope(text, oldScope, newScope) {
  let count = 0;
  const o = esc(oldScope);
  const bump = (repl) => () => { count++; return repl; };
  let out = text.replace(new RegExp(`(?<![\\w.+@-])${o}(?![\\w-]|\\.\\w)`, "g"), bump(newScope));
  out = out.replace(new RegExp(`%40${esc(oldScope.slice(1))}(?=%2[Ff]|/)`, "g"), bump(`%40${newScope.slice(1)}`));
  return { text: out, count };
}

// Files that own the CLI's name end to end: every bare occurrence is the command.
const CLI_OWNED = [/^packages\/cli\//, /^docs\/(cli|pre-commit|github-action)\.md$/, /^actions\/score\//, /^\.pre-commit-hooks\.yaml$/];
// Never touched: decision records, a deployed-service identity, and this tool with its own fixtures.
const NEVER = [/^scripts\/(rename-scope\.mjs|tests\/)/, /^docs\/PLAN\.md$/, /^docs\/plan-research\//, /(^|\/)\.wrangler\//, /(^|\/)node_modules\//, /(^|\/)dist\//, /^package-lock\.json$/];
const BINARY = /\.(png|jpe?g|gif|webp|ico|icns|zip|vsix|woff2?|ttf|otf|pdf|sqlite[\w-]*|wasm|tgz|gz|br|mp4|mov)$/i;

// The CLI name is not applied to these (the scope still is).
const CLI_NEVER = [/^apps\/worker\/wrangler\.jsonc$/];

export const isSkipped = (rel) => BINARY.test(rel) || NEVER.some((r) => r.test(rel));
export const isCliOwned = (rel) => CLI_OWNED.some((r) => r.test(rel));

/** The unscoped CLI name, and the bin names derived from it (`<cli>-mcp`, `<cli>-bench`). */
export function rewriteCliName(text, oldCli, newCli, rel = "") {
  if (oldCli === newCli || CLI_NEVER.some((r) => r.test(rel))) return { text, count: 0 };
  let count = 0;
  const c = esc(oldCli);
  const sub = (re, repl) => { text = text.replace(re, (...m) => { count++; return typeof repl === "function" ? repl(...m) : repl; }); };
  const tail = "(?![\\w/-]|\\.\\w)"; // not part of a longer name, path or dotted setting
  const head = "(?<![\\w@./-])";
  // bins derived from the CLI name
  for (const suffix of ["mcp", "bench"]) sub(new RegExp(`${head}${c}-${suffix}(?![\\w-])`, "g"), `${newCli}-${suffix}`);
  // `/opal42 --help/` and `/opal42-bench:/` in regex literals of tests and sources
  if (/\.[cm]?[jt]sx?$/.test(rel)) {
    const rx = "(?<=(?:^|[\\s(,=:!&|?{\\[])\\/)";
    sub(new RegExp(`${rx}${c}(?=[ :\\\\]|-(?:mcp|bench)(?![\\w-]))`, "g"), newCli);
  }
  if (isCliOwned(rel)) {
    sub(new RegExp(`${head}${c}${tail}`, "g"), newCli);
    sub(new RegExp(`(?<![\\w./-])${c}(?=@[\\d<$l{])`, "g"), newCli);
    return { text, count };
  }
  sub(new RegExp(`(-w|--workspace|-w=|--workspace=)(\\s?)${c}${tail}`, "g"), (_m, f, sp) => `${f}${sp}${newCli}`);
  sub(new RegExp(`((?:npx|bunx|pnpm dlx|yarn dlx)(?: (?:-\\S+))*? ["']?)${c}(?=["']?(?:@|\\s|$|["'\`)\\].,;]))`, "g"), (_m, p) => `${p}${newCli}`);
  sub(new RegExp(`((?:npm|pnpm|yarn|bun) (?:i|install|add|exec|x|view|info|pack)(?: -\\S+)* ["']?)${c}(?=["']?(?:@|\\s|$|["'\`)\\].,;]))`, "g"), (_m, p) => `${p}${newCli}`);
  sub(new RegExp(`(?<![\\w./-])${c}(?=@(?:<|\\$|\\d|latest|\\{))`, "g"), newCli);
  sub(new RegExp(`${head}${c}(?= (?:score|refine|parse|--help|--version|-h|-v)(?![\\w-]))`, "g"), newCli);
  sub(new RegExp(`(?<![\\w./-])${c}(?= CLI\\b)|(?<=\`)${c}(?=\` CLI\\b)`, "g"), newCli);
  sub(new RegExp(`"${c}"(?=\\s*:\\s*"\\./dist/cli\\.js")`, "g"), `"${newCli}"`);
  sub(new RegExp(`("name"\\s*:\\s*)"${c}"(?=\\s*,\\s*"version")`, "g"), (_m, p) => `${p}"${newCli}"`);
  sub(new RegExp(`("cliName"\\s*:\\s*)"${c}"`, "g"), (_m, p) => `${p}"${newCli}"`);
  if (/^\.changeset\/.*\.md$/.test(rel)) sub(new RegExp(`(?<=^["']?)${c}(?=["']?\\s*:\\s*(?:major|minor|patch)\\b)`, "gm"), newCli);
  if (/^(docs\/(PACKAGING|RELEASING)\.md|README\.md|SCOPE\.md|\.changeset\/.*\.md)$/.test(rel)) sub(new RegExp(`(?<=\`)${c}(?=\`)`, "g"), newCli);
  return { text, count };
}

export function rewriteFile(rel, text, { oldScope, newScope, oldCli, newCli }) {
  let total = 0;
  const apply = (t) => {
    if (oldCli && newCli) { const r = rewriteCliName(t, oldCli, newCli, rel); t = r.text; total += r.count; }
    if (oldScope !== newScope) { const r = rewriteScope(t, oldScope, newScope); t = r.text; total += r.count; }
    return t;
  };
  // Example commands that show this very tool keep their arguments.
  if (!/rename-scope\.mjs/.test(text)) return { text: apply(text), count: total };
  return { text: text.split("\n").map((line) => (/rename-scope\.mjs/.test(line) ? line : apply(line))).join("\n"), count: total };
}

const sh = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

export function main(argv = process.argv.slice(2), root = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  const flags = new Set(argv.filter((a) => a.startsWith("--") && !a.startsWith("--cli-name")));
  const ci = argv.findIndex((a) => a === "--cli-name" || a.startsWith("--cli-name="));
  let cliArg;
  const positional = argv.filter((a, i) => !a.startsWith("--") && !(ci >= 0 && argv[ci] === "--cli-name" && i === ci + 1));
  if (ci >= 0) cliArg = argv[ci].includes("=") ? argv[ci].split("=")[1] : argv[ci + 1];
  const known = new Set(["--dry-run", "--force", "--no-install"]);
  const bad = [...flags].filter((f) => !known.has(f));
  if (positional.length !== 2 || bad.length || (ci >= 0 && !cliArg)) {
    console.error("usage: rename-scope.mjs <oldScope> <newScope> [--cli-name <name>] [--dry-run] [--force] [--no-install]");
    return 2;
  }
  let oldScope, newScope, newCli;
  try {
    oldScope = normalizeScope(positional[0]);
    newScope = normalizeScope(positional[1]);
    if (cliArg) newCli = normalizeCliName(cliArg);
  } catch (e) { console.error(`rename-scope: ${e.message}`); return 2; }
  const dry = flags.has("--dry-run");

  const cfgPath = join(root, "release.config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  const oldCli = newCli ? cfg.cliName : undefined;
  if (oldScope !== cfg.scope && newScope !== cfg.scope && !flags.has("--force")) {
    console.error(`rename-scope: release.config.json says the scope is ${cfg.scope}, not ${oldScope}. Pass the current scope, or --force.`);
    return 2;
  }

  const inGit = sh("git", ["rev-parse", "--is-inside-work-tree"], root).stdout?.trim() === "true";
  if (!inGit && !flags.has("--force")) { console.error("rename-scope: not a git repository; refusing without --force (you could not undo this)"); return 2; }
  if (inGit && !flags.has("--force") && !dry) {
    const st = sh("git", ["status", "--porcelain"], root).stdout.trim();
    if (st) { console.error(`rename-scope: the git tree is dirty (${st.split("\n").length} paths). Commit or stash first, or pass --force.\n${st.split("\n").slice(0, 5).join("\n")}`); return 2; }
  }

  const listed = inGit ? sh("git", ["ls-files", "-co", "--exclude-standard", "-z"], root).stdout.split("\0").filter(Boolean) : [];
  const files = [...new Set(listed)].sort();
  const changed = [];
  let skipped = 0, leftover = 0;
  for (const rel of files) {
    let buf;
    try { buf = readFileSync(join(root, rel)); } catch { continue; }
    const isLock = rel === "package-lock.json";
    if (!isLock && isSkipped(rel)) { skipped++; if (/^docs\/(PLAN\.md|plan-research\/)/.test(rel) && buf.toString("utf8").includes(oldScope)) leftover++; continue; }
    if (buf.length > 3_000_000 && !isLock || buf.includes(0)) { skipped++; continue; }
    const text = buf.toString("utf8");
    let r;
    if (isLock) {
      // Only the names; npm install regenerates the rest.
      r = rewriteScope(text, oldScope, newScope);
      if (newCli && oldCli) {
        const c = esc(oldCli);
        r.text = r.text.replace(new RegExp(`"node_modules/${c}"|("name": )"${c}"`, "g"), (m, p) => { r.count++; return p ? `${p}"${newCli}"` : `"node_modules/${newCli}"`; });
      }
    } else r = rewriteFile(rel, text, { oldScope, newScope, oldCli, newCli });
    if (r.count > 0 && r.text !== text) {
      changed.push({ rel, count: r.count });
      if (!dry) writeFileSync(join(root, rel), r.text);
    }
  }

  const total = changed.reduce((n, c) => n + c.count, 0);
  const label = dry ? "would change" : "changed";
  for (const c of changed) console.log(`${label}  ${String(c.count).padStart(4)}  ${c.rel}`);
  console.log(`\n${changed.length} file(s) ${label}, ${total} replacement(s) (${oldScope} -> ${newScope}${newCli ? `, CLI ${oldCli} -> ${newCli}` : ""}); ${skipped} file(s) skipped.`);
  if (changed.length === 0) console.log("Nothing to do: already renamed.");
  if (leftover) console.log(`Note: ${leftover} planning-record file(s) (docs/PLAN.md, docs/plan-research/) still say ${oldScope} on purpose.`);
  if (dry) { console.log("Dry run: nothing written."); return 0; }
  if (changed.length && !flags.has("--no-install")) {
    console.log("\nnpm install (relinks the renamed workspaces and regenerates package-lock.json) ...");
    const r = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], { cwd: root, stdio: "inherit" });
    if (r.status !== 0) { console.error("rename-scope: npm install failed; the files are already rewritten. Fix the error and run `npm install` again."); return 1; }
  }
  if (changed.length) console.log("\nNext: npm run lint && npm run typecheck && npm test && npm run build:packages && npm run release:check");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main());
