#!/usr/bin/env node
// Validates an Agent Skill directory against the Agent Skills format, with no
// dependencies. The rules mirror the reference validator (`skills-ref`,
// https://agentskills.io): required `name` and `description`, only the allowed
// frontmatter fields, name rules and a directory name that matches it, length
// limits. It also checks that relative links inside SKILL.md resolve.
//
//   node validate-skill.mjs <skill-dir>      exit 0 when valid, 1 otherwise
//
// Importable: `validateSkill(dir)` returns { errors, metadata }.

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_COMPATIBILITY = 500;
const ALLOWED = new Set(["name", "description", "license", "allowed-tools", "metadata", "compatibility"]);

/** Parses the YAML subset skills use: `key: value` scalars and one `metadata:` map of scalars. */
export function parseFrontmatter(content) {
  if (!content.startsWith("---")) throw new Error("SKILL.md must start with YAML frontmatter (---)");
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!m) throw new Error("SKILL.md frontmatter is not closed with ---");
  const meta = {};
  let map = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const indented = /^\s+/.test(raw);
    const kv = /^\s*([A-Za-z0-9_-]+):\s*(.*)$/.exec(raw);
    if (!kv) throw new Error(`cannot parse frontmatter line: ${JSON.stringify(raw)}`);
    const [, key, rest] = kv;
    const value = unquote(rest.trim());
    if (indented) {
      if (!map) throw new Error(`unexpected indented line: ${JSON.stringify(raw)}`);
      map[key] = value;
    } else if (rest.trim() === "") {
      map = {};
      meta[key] = map;
    } else {
      map = null;
      meta[key] = value;
    }
  }
  return { metadata: meta, body: content.slice(m[0].length) };
}

function unquote(v) {
  if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) return v.slice(1, -1);
  return v;
}

export function validateSkill(dir) {
  const errors = [];
  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) return { errors: [`not a directory: ${dir}`], metadata: null };
  const file = join(root, "SKILL.md");
  if (!existsSync(file)) return { errors: ["missing required file: SKILL.md"], metadata: null };

  let parsed;
  try {
    parsed = parseFrontmatter(readFileSync(file, "utf8"));
  } catch (e) {
    return { errors: [e.message], metadata: null };
  }
  const { metadata, body } = parsed;

  const extra = Object.keys(metadata).filter((k) => !ALLOWED.has(k));
  if (extra.length > 0) errors.push(`unexpected frontmatter field(s): ${extra.sort().join(", ")}`);

  const name = metadata.name;
  if (typeof name !== "string" || name.trim() === "") errors.push("field 'name' must be a non-empty string");
  else {
    const n = name.trim().normalize("NFKC");
    if (n.length > MAX_NAME) errors.push(`name exceeds ${MAX_NAME} characters`);
    if (n !== n.toLowerCase()) errors.push("name must be lowercase");
    if (n.startsWith("-") || n.endsWith("-")) errors.push("name cannot start or end with a hyphen");
    if (n.includes("--")) errors.push("name cannot contain consecutive hyphens");
    if (!/^[\p{L}\p{N}-]+$/u.test(n)) errors.push("name may only contain letters, digits and hyphens");
    if (basename(root).normalize("NFKC") !== n) errors.push(`directory name '${basename(root)}' must match skill name '${n}'`);
  }

  const description = metadata.description;
  if (typeof description !== "string" || description.trim() === "") errors.push("field 'description' must be a non-empty string");
  else if (description.length > MAX_DESCRIPTION) errors.push(`description exceeds ${MAX_DESCRIPTION} characters (${description.length})`);

  if ("compatibility" in metadata) {
    if (typeof metadata.compatibility !== "string") errors.push("field 'compatibility' must be a string");
    else if (metadata.compatibility.length > MAX_COMPATIBILITY) errors.push(`compatibility exceeds ${MAX_COMPATIBILITY} characters`);
  }
  if ("metadata" in metadata && (typeof metadata.metadata !== "object" || metadata.metadata === null)) {
    errors.push("field 'metadata' must be a map of strings");
  }
  if (body.trim() === "") errors.push("SKILL.md has no instructions after the frontmatter");

  // Relative markdown links must point at files that exist.
  for (const link of body.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)) {
    const target = link[1].split("#")[0];
    if (target && !existsSync(join(root, target))) errors.push(`broken link in SKILL.md: ${link[1]}`);
  }
  return { errors, metadata };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..");
  const { errors } = validateSkill(dir);
  if (errors.length > 0) {
    for (const e of errors) process.stderr.write(`error: ${e}\n`);
    process.exit(1);
  }
  process.stdout.write(`valid skill: ${resolve(dir)}\n`);
}
