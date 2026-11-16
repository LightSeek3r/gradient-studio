import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_GRADIENTS, parseCliArgs, type Options } from "../src/args";

function ok(argv: string[]): Options {
  const r = parseCliArgs(argv);
  if (r.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(r)}`);
  return r.options;
}
function usage(argv: string[]): string {
  const r = parseCliArgs(argv);
  if (r.kind !== "usage-error") throw new Error(`expected usage-error, got ${r.kind}`);
  return r.message;
}

describe("parseCliArgs", () => {
  it("--help and -h", () => {
    expect(parseCliArgs(["--help"]).kind).toBe("help");
    expect(parseCliArgs(["-h"]).kind).toBe("help");
    expect(parseCliArgs(["score", "a.css", "--help"]).kind).toBe("help");
  });

  it("--version and -v", () => {
    expect(parseCliArgs(["--version"]).kind).toBe("version");
    expect(parseCliArgs(["-v"]).kind).toBe("version");
  });

  it("no arguments is a usage error", () => {
    expect(usage([])).toMatch(/missing command/);
  });

  it("an unknown command is a usage error", () => {
    expect(usage(["lint", "a.css"])).toMatch(/unknown command "lint"/);
  });

  it("an unknown option is a usage error", () => {
    expect(usage(["score", "--nope", "a.css"])).toMatch(/nope/);
  });

  it("a command without input is a usage error", () => {
    expect(usage(["score"])).toMatch(/no input/);
  });

  it("defaults", () => {
    const o = ok(["score", "a.css"]);
    expect(o).toEqual({
      command: "score",
      paths: ["a.css"],
      format: "text",
      minScore: undefined,
      failOnUnscorable: false,
      fix: false,
      dryRun: false,
      write: false,
      quiet: false,
      verbose: false,
      color: true,
      maxGradients: DEFAULT_MAX_GRADIENTS,
      ignore: [],
    });
  });

  it("has no default --min-score", () => {
    expect(ok(["score", "a.css"]).minScore).toBeUndefined();
  });

  it("options may come before or after the paths", () => {
    expect(ok(["--json", "score", "a.css", "b.css"]).paths).toEqual(["a.css", "b.css"]);
    expect(ok(["score", "a.css", "--json"]).format).toBe("json");
  });

  it("--json is --format json", () => {
    expect(ok(["score", "--json", "a.css"]).format).toBe("json");
    expect(ok(["score", "--format", "json", "a.css"]).format).toBe("json");
    expect(ok(["score", "--format=github", "a.css"]).format).toBe("github");
  });

  it("rejects an unknown format and conflicting --json", () => {
    expect(usage(["score", "--format", "sarif", "a.css"])).toMatch(/--format must be/);
    expect(usage(["score", "--json", "--format", "text", "a.css"])).toMatch(/conflicts/);
  });

  it("--min-score accepts numbers from 0 to 100", () => {
    expect(ok(["score", "--min-score", "70", "a.css"]).minScore).toBe(70);
    expect(ok(["score", "--min-score=0", "a.css"]).minScore).toBe(0);
    expect(ok(["score", "--min-score", "100", "a.css"]).minScore).toBe(100);
    expect(ok(["score", "--min-score", "72.5", "a.css"]).minScore).toBe(72.5);
  });

  it.each(["", "abc", "-1", "101", "NaN", "Infinity", "0x10", "7 0", "1e400"])("--min-score rejects %j", (v) => {
    expect(usage(["score", `--min-score=${v}`, "a.css"])).toMatch(/--min-score/);
  });

  it("--max-gradients needs a positive integer", () => {
    expect(ok(["score", "--max-gradients", "5", "a.css"]).maxGradients).toBe(5);
    for (const v of ["0", "-3", "1.5", "x"]) {
      expect(usage(["score", `--max-gradients=${v}`, "a.css"])).toMatch(/--max-gradients/);
    }
  });

  it("--ignore is repeatable", () => {
    expect(ok(["score", "--ignore", "a", "--ignore=b/**", "x.css"]).ignore).toEqual(["a", "b/**"]);
  });

  it("--no-color, --quiet, --verbose, --fail-on-unscorable", () => {
    const o = ok(["score", "--no-color", "-q", "--verbose", "--fail-on-unscorable", "a.css"]);
    expect(o).toMatchObject({ color: false, quiet: true, verbose: true, failOnUnscorable: true });
  });

  it("--fix belongs to score and --write to refine", () => {
    expect(ok(["score", "--fix", "a.css"]).fix).toBe(true);
    expect(usage(["refine", "--fix", "a.css"])).toMatch(/--fix belongs to score/);
    expect(ok(["refine", "--write", "a.css"]).write).toBe(true);
    expect(usage(["score", "--write", "a.css"])).toMatch(/--write belongs to refine/);
  });

  it("--dry-run needs something to be dry about", () => {
    expect(usage(["score", "--dry-run", "a.css"])).toMatch(/--dry-run needs/);
    expect(ok(["score", "--fix", "--dry-run", "a.css"]).dryRun).toBe(true);
    expect(usage(["refine", "--write", "--dry-run", "a.css"])).toMatch(/conflict/);
  });

  it("parse takes no scoring options", () => {
    expect(usage(["parse", "--min-score", "50", "a.css"])).toMatch(/parse takes no/);
    expect(usage(["parse", "--format", "github", "a.css"])).toMatch(/text and json/);
    expect(ok(["parse", "--json", "a.css"]).command).toBe("parse");
  });

  it("standard input is given once and as the only path when rewriting", () => {
    expect(ok(["score", "-"]).paths).toEqual(["-"]);
    expect(usage(["score", "-", "-"])).toMatch(/only once/);
    expect(usage(["score", "--fix", "-", "a.css"])).toMatch(/do not combine/);
    expect(usage(["score", "--fix", "--json", "-"])).toMatch(/cannot be combined/);
    expect(ok(["score", "--fix", "--dry-run", "--json", "-"]).dryRun).toBe(true);
  });
});
