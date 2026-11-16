// `run(argv, io)`: the whole CLI as a function. It never throws and returns the
// exit code (0 ok, 1 the input or the data was unusable, 2 usage error).

import { parseCssColor } from "@opal42/gradient";
import { DEFAULT_BRIEF_SET, briefSetHash, parseBriefSet, validateBriefSet, type BriefSet } from "./briefs";
import { BENCH_VERSION, CAVEAT } from "./constants";
import type { BenchIo } from "./io";
import { BUILTIN_CONDITIONS, emitPrompts, type ConditionSpec } from "./prompts";
import { renderHtml, renderMarkdown } from "./report";
import { parseResults, type Diagnostic, type ResultRecord } from "./results";
import { scoreRecords } from "./run";
import { briefInfo, buildSummary, mergeSummaries, validateSummary, type Summary } from "./summary";

export const HELP = `opal42-bench ${"{version}"}: GradientBench v0, an offline harness. It never calls a model.

Usage:
  opal42-bench validate-briefs [briefs.json]
  opal42-bench prompts [--briefs f] [--condition name[=file]]... [--with-skill] [--prefix file] [--template file] [--out file]
  opal42-bench score <results.jsonl|->... [--briefs f] [--tailwind-palette f] [--out summary.json] [--strict]
  opal42-bench report <summary.json>... --out <dir>

Commands:
  validate-briefs  Check a brief set against the schema (default: the shipped set).
  prompts          Print the briefs as JSONL {briefId, category, condition, prompt}.
                   Conditions: baseline (default) and with-skill (points at
                   skills/gradient-quality/SKILL.md); name=file adds your own text.
  score            Extract and score the gradients of a results file
                   ({briefId, model, condition, output} per line) and print summary JSON.
  report           Merge summaries and write summary.json, report.md and leaderboard.html to <dir>.

Exit codes: 0 ok, 1 unusable input or data (--strict: any diagnostic), 2 usage error.

${CAVEAT}
`;

interface Parsed {
  positional: string[];
  flags: Map<string, string[]>;
  bools: Set<string>;
  error?: string;
}

const VALUE_FLAGS = new Set(["briefs", "condition", "prefix", "template", "out", "tailwind-palette"]);
const BOOL_FLAGS = new Set(["with-skill", "strict", "help", "version"]);

function parseArgs(args: readonly string[]): Parsed {
  const p: Parsed = { positional: [], flags: new Map(), bools: new Set() };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-h") p.bools.add("help");
    else if (a === "-v") p.bools.add("version");
    else if (a === "-") p.positional.push(a);
    else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (BOOL_FLAGS.has(name)) {
        if (eq > 0) return { ...p, error: `--${name} does not take a value` };
        p.bools.add(name);
      } else if (VALUE_FLAGS.has(name)) {
        let value: string | undefined;
        if (eq > 0) value = a.slice(eq + 1);
        else {
          value = args[i + 1];
          if (value === undefined || (value.startsWith("--") && value !== "-")) return { ...p, error: `--${name} needs a value` };
          i++;
        }
        p.flags.set(name, [...(p.flags.get(name) ?? []), value]);
      } else return { ...p, error: `unknown option --${name}` };
    } else if (a.startsWith("-")) return { ...p, error: `unknown option ${a}` };
    else p.positional.push(a);
  }
  return p;
}

function base(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

class Ctx {
  readonly io: BenchIo;
  constructor(io: BenchIo) {
    this.io = io;
  }
  out(s: string) {
    this.write(this.io.stdout, s);
  }
  err(s: string) {
    this.write(this.io.stderr, s);
  }
  private write(stream: { write(t: string): unknown }, s: string) {
    try {
      stream.write(s);
    } catch {
      // A closed pipe must not turn into an exception.
    }
  }
}

async function loadBriefs(c: Ctx, path: string | undefined): Promise<BriefSet | null> {
  if (path === undefined) return DEFAULT_BRIEF_SET;
  let text: string;
  try {
    text = await c.io.readFile(path);
  } catch (e) {
    c.err(`opal42-bench: cannot read ${path}: ${msg(e)}\n`);
    return null;
  }
  const r = parseBriefSet(text);
  if (!r.ok) {
    c.err(`opal42-bench: ${path} is not a valid brief set:\n${r.issues.slice(0, 20).map((i) => `  ${i.path}: ${i.message}`).join("\n")}\n`);
    return null;
  }
  return r.set;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function run(argv: readonly string[], io: BenchIo): Promise<number> {
  const c = new Ctx(io);
  try {
    return await runInner(argv, c);
  } catch (e) {
    c.err(`opal42-bench: internal error: ${msg(e)}\n`);
    return 3;
  }
}

async function runInner(argv: readonly string[], c: Ctx): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined) {
    c.err(HELP.replace("{version}", BENCH_VERSION));
    return 2;
  }
  if (command === "--help" || command === "-h" || command === "help") {
    c.out(HELP.replace("{version}", BENCH_VERSION));
    return 0;
  }
  if (command === "--version" || command === "-v") {
    c.out(`${BENCH_VERSION}\n`);
    return 0;
  }
  const args = parseArgs(rest);
  if (args.error) {
    c.err(`opal42-bench: ${args.error}\n`);
    return 2;
  }
  if (args.bools.has("help")) {
    c.out(HELP.replace("{version}", BENCH_VERSION));
    return 0;
  }
  switch (command) {
    case "validate-briefs":
      return validateBriefsCmd(c, args);
    case "prompts":
      return promptsCmd(c, args);
    case "score":
      return scoreCmd(c, args);
    case "report":
      return reportCmd(c, args);
    default:
      c.err(`opal42-bench: unknown command "${command}"\n`);
      return 2;
  }
}

async function validateBriefsCmd(c: Ctx, a: Parsed): Promise<number> {
  if (a.positional.length > 1) {
    c.err("opal42-bench: validate-briefs takes at most one file\n");
    return 2;
  }
  const path = a.positional[0];
  let value: unknown = DEFAULT_BRIEF_SET;
  if (path !== undefined) {
    try {
      value = JSON.parse(await c.io.readFile(path));
    } catch (e) {
      c.err(`opal42-bench: cannot read ${path} as JSON: ${msg(e)}\n`);
      return 1;
    }
  }
  const issues = validateBriefSet(value);
  if (issues.length) {
    c.err(`${path ?? "default brief set"}: ${issues.length} problem(s)\n${issues.slice(0, 50).map((i) => `  ${i.path}: ${i.message}`).join("\n")}\n`);
    return 1;
  }
  const set = value as BriefSet;
  const cats = new Set(set.briefs.map((b) => b.category));
  c.out(`ok: ${set.briefs.length} briefs in ${cats.size} categories, hash ${briefSetHash(set)}\n`);
  return 0;
}

async function promptsCmd(c: Ctx, a: Parsed): Promise<number> {
  if (a.positional.length) {
    c.err("opal42-bench: prompts takes no positional arguments\n");
    return 2;
  }
  const set = await loadBriefs(c, a.flags.get("briefs")?.[0]);
  if (!set) return 1;
  const conds: ConditionSpec[] = [];
  const names = [...(a.flags.get("condition") ?? [])];
  if (a.bools.has("with-skill")) names.push("with-skill");
  if (names.length === 0) names.push("baseline");
  for (const spec of names) {
    const eq = spec.indexOf("=");
    const name = eq > 0 ? spec.slice(0, eq) : spec;
    if (!/^[\w.:/@+ -]{1,100}$/.test(name)) {
      c.err(`opal42-bench: invalid condition name "${name}"\n`);
      return 2;
    }
    if (conds.some((x) => x.name === name)) continue;
    if (eq > 0) {
      try {
        conds.push({ name, text: await c.io.readFile(spec.slice(eq + 1)) });
      } catch (e) {
        c.err(`opal42-bench: cannot read condition text ${spec.slice(eq + 1)}: ${msg(e)}\n`);
        return 1;
      }
    } else if (Object.prototype.hasOwnProperty.call(BUILTIN_CONDITIONS, name)) conds.push({ name, text: BUILTIN_CONDITIONS[name]! });
    else {
      c.err(`opal42-bench: condition "${name}" has no built-in text; use ${name}=<file> to supply it\n`);
      return 2;
    }
  }
  const opts: { prefix?: string; template?: string } = {};
  for (const key of ["prefix", "template"] as const) {
    const f = a.flags.get(key)?.[0];
    if (f === undefined) continue;
    try {
      opts[key] = await c.io.readFile(f);
    } catch (e) {
      c.err(`opal42-bench: cannot read --${key} ${f}: ${msg(e)}\n`);
      return 1;
    }
  }
  const text = emitPrompts(set, conds, opts).map((l) => JSON.stringify(l)).join("\n") + "\n";
  return emit(c, a.flags.get("out")?.[0], text);
}

async function emit(c: Ctx, out: string | undefined, text: string): Promise<number> {
  if (out === undefined) {
    c.out(text);
    return 0;
  }
  try {
    await c.io.writeFile(out, text);
  } catch (e) {
    c.err(`opal42-bench: cannot write ${out}: ${msg(e)}\n`);
    return 1;
  }
  return 0;
}

async function readPalette(c: Ctx, path: string | undefined): Promise<{ palette?: Record<string, string>; diagnostics: Diagnostic[] } | null> {
  if (path === undefined) return { diagnostics: [] };
  let v: unknown;
  try {
    v = JSON.parse(await c.io.readFile(path));
  } catch (e) {
    c.err(`opal42-bench: cannot read palette ${path}: ${msg(e)}\n`);
    return null;
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    c.err(`opal42-bench: ${path} must be a JSON object mapping class colour names to CSS colours\n`);
    return null;
  }
  const palette: Record<string, string> = {};
  const diagnostics: Diagnostic[] = [];
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === "string" && parseCssColor(val)) palette[k] = val;
    else diagnostics.push({ source: base(path), code: "invalid-palette-entry", message: `palette entry "${k}" is not a CSS colour; ignored` });
  }
  return { palette, diagnostics };
}

async function scoreCmd(c: Ctx, a: Parsed): Promise<number> {
  if (a.positional.length === 0) {
    c.err("opal42-bench: score needs at least one results file (use - for stdin)\n");
    return 2;
  }
  const set = await loadBriefs(c, a.flags.get("briefs")?.[0]);
  if (!set) return 1;
  const pal = await readPalette(c, a.flags.get("tailwind-palette")?.[0]);
  if (!pal) return 1;
  const records: ResultRecord[] = [];
  const diagnostics: Diagnostic[] = [...pal.diagnostics];
  const sources: string[] = [];
  for (const path of a.positional) {
    let text: string;
    const name = path === "-" ? "<stdin>" : base(path);
    try {
      text = path === "-" ? await c.io.readStdin() : await c.io.readFile(path);
    } catch (e) {
      c.err(`opal42-bench: cannot read ${path}: ${msg(e)}\n`);
      return 1;
    }
    sources.push(name);
    const parsed = parseResults(text, name);
    records.push(...parsed.records);
    diagnostics.push(...parsed.diagnostics);
  }
  const scored = scoreRecords(records, set, { tailwindPalette: pal.palette }, sources.join(","));
  diagnostics.push(...scored.diagnostics);
  for (const d of diagnostics.slice(0, 20)) c.err(`warning: ${d.source}${d.line ? `:${d.line}` : ""} ${d.code}: ${d.message}\n`);
  if (diagnostics.length > 20) c.err(`warning: ... and ${diagnostics.length - 20} more (see summary diagnostics)\n`);
  if (scored.records.length === 0) {
    c.err("opal42-bench: no valid records to score\n");
    return 1;
  }
  const summary = buildSummary(scored.records, briefInfo(set), { sources: [...new Set(sources)], diagnostics, tailwindPaletteEntries: Object.keys(pal.palette ?? {}).length });
  const code = await emit(c, a.flags.get("out")?.[0], JSON.stringify(summary, null, 2) + "\n");
  if (code !== 0) return code;
  return a.bools.has("strict") && diagnostics.length > 0 ? 1 : 0;
}

async function reportCmd(c: Ctx, a: Parsed): Promise<number> {
  const out = a.flags.get("out")?.[0];
  if (a.positional.length === 0 || out === undefined) {
    c.err("opal42-bench: report needs at least one summary.json and --out <dir>\n");
    return 2;
  }
  const inputs: { name: string; summary: Summary }[] = [];
  for (const path of a.positional) {
    let v: unknown;
    try {
      v = JSON.parse(await c.io.readFile(path));
    } catch (e) {
      c.err(`opal42-bench: cannot read ${path} as JSON: ${msg(e)}\n`);
      return 1;
    }
    const problems = validateSummary(v);
    if (problems.length) {
      c.err(`opal42-bench: ${path} is not a summary.json this version can read:\n${problems.map((p) => `  ${p}`).join("\n")}\n`);
      return 1;
    }
    inputs.push({ name: base(path), summary: v as Summary });
  }
  const merged = mergeSummaries(inputs);
  if ("error" in merged) {
    c.err(`opal42-bench: ${merged.error}\n`);
    return 1;
  }
  const dir = out.replace(/[\\/]+$/, "");
  try {
    await c.io.mkdir(dir);
    await c.io.writeFile(`${dir}/summary.json`, JSON.stringify(merged.summary, null, 2) + "\n");
    await c.io.writeFile(`${dir}/report.md`, renderMarkdown(merged.summary));
    await c.io.writeFile(`${dir}/leaderboard.html`, renderHtml(merged.summary));
  } catch (e) {
    c.err(`opal42-bench: cannot write to ${dir}: ${msg(e)}\n`);
    return 1;
  }
  c.err(`wrote ${dir}/summary.json, ${dir}/report.md, ${dir}/leaderboard.html\n`);
  return 0;
}
