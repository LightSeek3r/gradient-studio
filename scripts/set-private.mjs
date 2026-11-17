#!/usr/bin/env node
// Flip "private" on publish candidates (docs/RELEASING.md step 5). Zero dependencies.
//   node scripts/set-private.mjs @opal42/gradient opal42 --false          # dry run (default)
//   node scripts/set-private.mjs tier:1 --false --write                   # really edit package.json
//   node scripts/set-private.mjs tier:1 --true --write                    # make them private again
// Targets are package names from release.config.json or `tier:N`. Anything else is refused,
// so an app can never be made publishable by accident. It edits only the one line.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { candidates } from "./release-check.mjs";

const PRIVATE_LINE = /^[ \t]*"private":[ \t]*true,?[ \t]*\r?\n/m;

/** Returns { text, changed }. value=false removes the line, value=true inserts it after "version". */
export function setPrivate(text, value) {
  const has = PRIVATE_LINE.test(text);
  if (value === false) return has ? { text: text.replace(PRIVATE_LINE, ""), changed: true } : { text, changed: false };
  if (has) return { text, changed: false };
  const m = /^([ \t]*)"version":[^\n]*\n/m.exec(text);
  if (!m) throw new Error('no "version" line to insert "private" after');
  const eol = m[0].endsWith("\r\n") ? "\r\n" : "\n";
  return { text: text.slice(0, m.index + m[0].length) + `${m[1]}"private": true,${eol}` + text.slice(m.index + m[0].length), changed: true };
}

/** Resolve CLI targets to candidates; throws on anything that is not a publish candidate. */
export function resolveTargets(args, cands) {
  const out = [];
  for (const a of args) {
    const tier = /^tier:(\d+)$/.exec(a);
    const hits = tier ? cands.filter((c) => c.tier === Number(tier[1])) : cands.filter((c) => c.name === a);
    if (hits.length === 0) throw new Error(`"${a}" is not a publish candidate in release.config.json (apps are never published)`);
    for (const h of hits) if (!out.includes(h)) out.push(h);
  }
  return out;
}

export function main(argv = process.argv.slice(2), root = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  const flags = argv.filter((a) => a.startsWith("--"));
  const targets = argv.filter((a) => !a.startsWith("--"));
  const toFalse = flags.includes("--false"), toTrue = flags.includes("--true");
  if (toFalse === toTrue || targets.length === 0 || flags.some((f) => !["--false", "--true", "--write"].includes(f))) {
    console.error("usage: set-private.mjs <package|tier:N>... (--false | --true) [--write]\n  default is a dry run; add --write to edit package.json files");
    return 2;
  }
  const write = flags.includes("--write");
  let cands;
  try { cands = resolveTargets(targets, candidates(JSON.parse(readFileSync(join(root, "release.config.json"), "utf8")))); } catch (e) { console.error(`set-private: ${e.message}`); return 2; }
  let changed = 0;
  for (const c of cands) {
    const file = join(root, c.dir, "package.json");
    if (!existsSync(file)) { console.error(`set-private: ${c.dir}/package.json is missing`); return 1; }
    const r = setPrivate(readFileSync(file, "utf8"), toTrue);
    JSON.parse(r.text);
    console.log(`${r.changed ? (write ? "edited " : "would edit") : "unchanged"}  ${c.name}  (${c.dir}/package.json): private -> ${toTrue}`);
    if (r.changed) { changed++; if (write) writeFileSync(file, r.text); }
  }
  console.log(write ? `${changed} file(s) written. Review with git diff, then commit.` : `Dry run: nothing written (${changed} file(s) would change). Add --write to apply.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main());
