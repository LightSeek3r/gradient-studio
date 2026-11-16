// Command line parsing and validation (node:util parseArgs, strict).

import { parseArgs } from "node:util";

export type Command = "score" | "refine" | "parse";
export type Format = "text" | "json" | "github";

export interface Options {
  command: Command;
  paths: string[];
  format: Format;
  /** `undefined` when --min-score was not given (there is no default threshold). */
  minScore: number | undefined;
  failOnUnscorable: boolean;
  fix: boolean;
  dryRun: boolean;
  write: boolean;
  quiet: boolean;
  verbose: boolean;
  color: boolean;
  maxGradients: number;
  ignore: string[];
}

export type ParsedArgs =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "usage-error"; message: string }
  | { kind: "run"; options: Options };

export const DEFAULT_MAX_GRADIENTS = 2000;
const COMMANDS: readonly string[] = ["score", "refine", "parse"];

export function parseCliArgs(argv: readonly string[]): ParsedArgs {
  let values;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        json: { type: "boolean" },
        format: { type: "string" },
        "min-score": { type: "string" },
        "fail-on-unscorable": { type: "boolean" },
        fix: { type: "boolean" },
        "dry-run": { type: "boolean" },
        write: { type: "boolean" },
        quiet: { type: "boolean", short: "q" },
        verbose: { type: "boolean" },
        "no-color": { type: "boolean" },
        "max-gradients": { type: "string" },
        ignore: { type: "string", multiple: true },
      },
    }));
  } catch (e) {
    return { kind: "usage-error", message: e instanceof Error ? firstLine(e.message) : "invalid arguments" };
  }

  if (values.help) return { kind: "help" };
  if (values.version) return { kind: "version" };

  const command = positionals[0];
  if (command === undefined) return { kind: "usage-error", message: "missing command (score, refine or parse)" };
  if (!COMMANDS.includes(command)) {
    return { kind: "usage-error", message: `unknown command "${command}" (expected score, refine or parse)` };
  }
  const cmd = command as Command;
  const paths = positionals.slice(1);
  if (paths.length === 0) {
    return { kind: "usage-error", message: `${cmd}: no input; pass files, directories or - for standard input` };
  }
  if (paths.filter((p) => p === "-").length > 1) {
    return { kind: "usage-error", message: "standard input (-) can be given only once" };
  }

  let format: Format = "text";
  if (values.format !== undefined) {
    if (values.format !== "text" && values.format !== "json" && values.format !== "github") {
      return { kind: "usage-error", message: `--format must be text, json or github (got "${values.format}")` };
    }
    format = values.format;
  }
  if (values.json) {
    if (values.format !== undefined && values.format !== "json") {
      return { kind: "usage-error", message: "--json conflicts with --format " + values.format };
    }
    format = "json";
  }

  let minScore: number | undefined;
  if (values["min-score"] !== undefined) {
    const n = parseNumber(values["min-score"]);
    if (n === undefined || n < 0 || n > 100) {
      return { kind: "usage-error", message: `--min-score must be a number from 0 to 100 (got "${values["min-score"]}")` };
    }
    minScore = n;
  }

  let maxGradients = DEFAULT_MAX_GRADIENTS;
  if (values["max-gradients"] !== undefined) {
    const n = parseNumber(values["max-gradients"]);
    if (n === undefined || !Number.isInteger(n) || n < 1) {
      return { kind: "usage-error", message: `--max-gradients must be a positive integer (got "${values["max-gradients"]}")` };
    }
    maxGradients = n;
  }

  const fix = Boolean(values.fix);
  const dryRun = Boolean(values["dry-run"]);
  const write = Boolean(values.write);
  if (fix && cmd !== "score") {
    return { kind: "usage-error", message: `--fix belongs to score; use "refine --write" to rewrite files` };
  }
  if (write && cmd !== "refine") {
    return { kind: "usage-error", message: `--write belongs to refine; use "score --fix" to rewrite files` };
  }
  if (dryRun && !fix && !write) {
    return { kind: "usage-error", message: "--dry-run needs --fix (or refine --write)" };
  }
  if (dryRun && write) {
    return { kind: "usage-error", message: "--dry-run and --write conflict; refine without --write is already a dry run" };
  }
  if (cmd === "parse" && (minScore !== undefined || values["fail-on-unscorable"] || fix || dryRun || write)) {
    return { kind: "usage-error", message: "parse takes no scoring or rewriting options" };
  }
  if (cmd === "parse" && format === "github") {
    return { kind: "usage-error", message: "parse supports --format text and json only" };
  }
  if ((fix || write) && !dryRun && paths.includes("-")) {
    if (paths.length > 1) {
      return { kind: "usage-error", message: "rewriting standard input prints the new text on stdout; do not combine - with other paths (or use --dry-run)" };
    }
    if (format !== "text") {
      return { kind: "usage-error", message: "rewriting standard input prints the new text; it cannot be combined with --json or --format (or use --dry-run)" };
    }
  }

  return {
    kind: "run",
    options: {
      command: cmd,
      paths,
      format,
      minScore,
      failOnUnscorable: Boolean(values["fail-on-unscorable"]),
      fix,
      dryRun,
      write,
      quiet: Boolean(values.quiet),
      verbose: Boolean(values.verbose),
      color: !values["no-color"],
      maxGradients,
      ignore: values.ignore ?? [],
    },
  };
}

/** A finite decimal number; rejects "", " ", "0x10", "1e3x", "Infinity". */
function parseNumber(text: string): number | undefined {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text.trim())) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

function firstLine(s: string): string {
  return s.split("\n")[0];
}

export const HELP = `opal42 - smoothness score and refiner for CSS gradients

Usage:
  opal42 score  [options] <files|dirs|->...   Score every linear gradient found
  opal42 refine [options] <files|dirs|->...   Show (or with --write apply) refinements
  opal42 parse  [options] <files|dirs|->...   Debug: print parsed gradients with ranges

  A "-" reads standard input. Directories are searched recursively for
  .css .scss .sass .less .html .htm .vue .svelte .astro .jsx .tsx .js .mjs
  .cjs .ts .mts .cts .md .mdx files (node_modules, .git, dist, build and
  coverage are skipped). Files over 2 MB and binary files are skipped.

Options:
  --json                     Same as --format json
  --format <text|json|github>  Output format (default text)
  --min-score <n>            Exit 1 when a scored gradient is below n (0-100).
                             There is no default threshold.
  --fail-on-unscorable       Exit 1 when a gradient had to be skipped
  --fix                      score: rewrite files, but only gradients that
                             refine improves; never touches skipped ones
  --dry-run                  With --fix / --write: report, change nothing
  --write                    refine: apply the refinements to the files
  --ignore <glob>            Skip matching paths (repeatable; * ** ?)
  --max-gradients <n>        Gradients examined per file (default ${DEFAULT_MAX_GRADIENTS})
  -q, --quiet                Print only gradients below --min-score and errors
  --verbose                  Also list skipped gradients and parser warnings
  --no-color                 Plain output (NO_COLOR is honoured too)
  -h, --help                 Show this help
  -v, --version              Show the version

Exit codes:
  0  ok    1  score below --min-score (or skipped gradient with
  --fail-on-unscorable)    2  usage error    3  I/O or internal error

The score is a smoothness score under scoring model v1, not a quality verdict.
`;
