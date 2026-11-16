import { describe, expect, it } from "vitest";
import { chmod } from "node:fs/promises";
import type { Report } from "../src/types";
import { cli, failingFs, fixtureCopy, golden, put, read, tempDir, TEST_VERSION } from "./helpers";

const json = (s: string): Report => JSON.parse(s) as Report;

describe("golden outputs (fixture files copied to a temp dir)", () => {
  it("score --json over all fixtures", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["score", "--json", "."], { cwd });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    const g = await golden("score-fixtures.json", r.stdout);
    expect(g.actual).toBe(g.expected);
  });

  it("score text over all fixtures (verbose)", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["score", "--verbose", "."], { cwd });
    const g = await golden("score-fixtures.txt", r.stdout);
    expect(g.actual).toBe(g.expected);
  });

  it("score --format github over rough.css with --min-score 80", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["score", "--format", "github", "--min-score", "80", "rough.css"], { cwd });
    expect(r.code).toBe(1);
    const g = await golden("score-rough.github.txt", r.stdout);
    expect(g.actual).toBe(g.expected);
  });

  it("parse --json on one file", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["parse", "--json", "smooth.css"], { cwd });
    const g = await golden("parse-smooth.json", r.stdout);
    expect(g.actual).toBe(g.expected);
  });

  it("parse text on the skipped fixture", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["parse", "skipped.css"], { cwd });
    const g = await golden("parse-skipped.txt", r.stdout);
    expect(g.actual).toBe(g.expected);
  });

  it("refine (dry run) text over rough.css", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["refine", "rough.css"], { cwd });
    expect(r.code).toBe(0);
    const g = await golden("refine-rough.txt", r.stdout);
    expect(g.actual).toBe(g.expected);
  });
});

describe("JSON schema (v1)", () => {
  it("has the documented top-level shape", async () => {
    const cwd = await fixtureCopy();
    const rep = json((await cli(["score", "--json", "rough.css"], { cwd })).stdout);
    expect(Object.keys(rep)).toEqual(["schemaVersion", "tool", "scoringModel", "command", "files", "summary"]);
    expect(rep.schemaVersion).toBe(1);
    expect(rep.scoringModel).toBe("v1");
    expect(rep.tool).toEqual({ name: "opal42", version: TEST_VERSION });
    expect(rep.command).toBe("score");
  });

  it("gradient entries carry range, loc, kind, status, score, dimensions, issues", async () => {
    const cwd = await fixtureCopy();
    const rep = json((await cli(["score", "--json", "rough.css"], { cwd })).stdout);
    const g = rep.files[0].gradients[0];
    expect(g).toMatchObject({ kind: "linear", status: "ok", repeating: false, score: 58 });
    expect(g.range.end).toBeGreaterThan(g.range.start);
    expect(g.loc).toEqual({ line: 3, col: 15, endLine: 3, endCol: 68 });
    expect(Object.keys(g.dimensions!)).toEqual(["lightness", "chroma", "hue", "spacing"]);
    expect(g.issues.length).toBeGreaterThan(0);
    for (const i of g.issues) {
      expect(Object.keys(i)).toEqual(expect.arrayContaining(["code", "severity", "dimension", "pointsLost", "message", "range", "loc"]));
    }
  });

  it("issue ranges point at the offending stops in the source", async () => {
    const cwd = await fixtureCopy();
    const src = await read(cwd, "rough.css");
    const rep = json((await cli(["score", "--json", "rough.css"], { cwd })).stdout);
    const reversal = rep.files[0].gradients[1].issues.find((i) => i.code === "lightness/reversal")!;
    expect(src.slice(reversal.range.start, reversal.range.end)).toBe("#eeeeee");
    expect(reversal.loc).toMatchObject({ line: 7, col: 50, endCol: 57 });
  });

  it("skipped gradients have a null score and a skip code", async () => {
    const cwd = await fixtureCopy();
    const rep = json((await cli(["score", "--json", "skipped.css"], { cwd })).stdout);
    const codes = rep.files[0].gradients.map((g) => g.skipped?.code);
    expect(codes).toEqual(["var", "unsupported-kind", "unsupported-kind", "legacy-syntax", "alpha", "length-position", "color-mix", "too-few-stops"]);
    for (const g of rep.files[0].gradients) {
      expect(g).toMatchObject({ status: "skipped", score: null, dimensions: null, issues: [] });
    }
  });

  it("summary totals", async () => {
    const cwd = await fixtureCopy();
    const rep = json((await cli(["score", "--json", "."], { cwd })).stdout);
    expect(rep.summary).toMatchObject({
      filesScanned: 8,
      gradients: rep.files.reduce((n, f) => n + f.gradients.length, 0),
      minScore: null,
      belowMinScore: 0,
      failOnUnscorable: false,
      exitCode: 0,
    });
    expect(rep.summary.scored + rep.summary.skipped).toBe(rep.summary.gradients);
    expect(Object.values(rep.summary.skippedByCode).reduce((a, b) => a + b, 0)).toBe(rep.summary.skipped);
  });

  it("is pure JSON on stdout, nothing else", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["score", "--json", "."], { cwd });
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(r.stdout.endsWith("\n")).toBe(true);
  });

  it("hard stops are flagged in analysis", async () => {
    const cwd = await fixtureCopy();
    const rep = json((await cli(["score", "--json", "rough.css"], { cwd })).stdout);
    const split = rep.files[0].gradients[4];
    expect(split.analysis).toEqual({ hasHardStops: true });
    expect(rep.files[0].gradients[0].analysis).toEqual({ hasHardStops: false });
  });

  it("paths use / and are relative to the working directory", async () => {
    const cwd = await fixtureCopy();
    const rep = json((await cli(["score", "--json", "nested"], { cwd })).stdout);
    expect(rep.files.map((f) => f.path)).toEqual(["nested/legacy.scss"]);
  });
});

describe("scanning containers", () => {
  it("finds gradients in vue, html, ts and md files", async () => {
    const cwd = await fixtureCopy();
    const rep = json((await cli(["score", "--json", "card.vue", "page.html", "theme.ts", "notes.md"], { cwd })).stdout);
    expect(rep.files.map((f) => f.gradients.length)).toEqual([2, 3, 3, 2]);
  });

  it("does not report a gradient that is only in a comment", async () => {
    const cwd = await fixtureCopy();
    const src = await read(cwd, "theme.ts");
    const rep = json((await cli(["score", "--json", "theme.ts"], { cwd })).stdout);
    for (const g of rep.files[0].gradients) {
      expect(src.slice(g.range.start, g.range.start + 20)).not.toContain("90deg, #000");
    }
  });
});

describe("exit codes", () => {
  it("0 without --min-score, however bad the scores", async () => {
    const cwd = await fixtureCopy();
    expect((await cli(["score", "rough.css"], { cwd })).code).toBe(0);
  });

  it("1 when a scored gradient is below --min-score", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["score", "--min-score", "90", "rough.css"], { cwd });
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/below --min-score 90/);
  });

  it("0 when everything is at or above --min-score (boundary is inclusive)", async () => {
    const cwd = await fixtureCopy();
    expect((await cli(["score", "--min-score", "95", "smooth.css"], { cwd })).code).toBe(0);
    expect((await cli(["score", "--min-score", "96", "smooth.css"], { cwd })).code).toBe(1);
  });

  it("--min-score ignores skipped gradients", async () => {
    const cwd = await fixtureCopy();
    expect((await cli(["score", "--min-score", "100", "skipped.css"], { cwd })).code).toBe(0);
  });

  it("--fail-on-unscorable is off by default", async () => {
    const cwd = await fixtureCopy();
    expect((await cli(["score", "skipped.css"], { cwd })).code).toBe(0);
  });

  it("--fail-on-unscorable exits 1 when a gradient is skipped", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["score", "--fail-on-unscorable", "skipped.css"], { cwd });
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/--fail-on-unscorable/);
  });

  it("--fail-on-unscorable exits 0 when nothing is skipped", async () => {
    const cwd = await fixtureCopy();
    expect((await cli(["score", "--fail-on-unscorable", "smooth.css"], { cwd })).code).toBe(0);
  });

  it("2 on a usage error, with a message on stderr only", async () => {
    const cwd = await tempDir();
    const r = await cli(["score", "--min-score", "lots", "a.css"], { cwd });
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/--min-score must be/);
    expect(r.stderr).toMatch(/opal42 --help/);
  });

  it("2 with no arguments at all", async () => {
    const r = await cli([], { cwd: await tempDir() });
    expect(r.code).toBe(2);
  });

  it("3 for a path that does not exist", async () => {
    const cwd = await tempDir();
    const r = await cli(["score", "missing.css"], { cwd });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/missing\.css: no such file or directory \(ENOENT\)/);
  });

  it("3 wins over 1, and the other files are still scored", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["score", "--min-score", "99", "missing.css", "rough.css"], { cwd });
    expect(r.code).toBe(3);
    expect(r.stdout).toMatch(/rough\.css:3:15/);
  });

  it("3 for an unreadable file, reported in the JSON too", async () => {
    const cwd = await fixtureCopy();
    const fs = failingFs((p) => p.endsWith("rough.css"), "EACCES", ["readFile"]);
    const r = await cli(["score", "--json", "rough.css", "smooth.css"], { cwd, fs });
    expect(r.code).toBe(3);
    const rep = json(r.stdout);
    expect(rep.files[0]).toMatchObject({ path: "rough.css", status: "error", error: { code: "EACCES" } });
    expect(rep.files[1].status).toBe("scanned");
    expect(rep.summary).toMatchObject({ filesWithErrors: 1, exitCode: 3 });
    expect(r.stderr).toMatch(/rough\.css/);
  });

  it("3 for an unreadable directory", async () => {
    const cwd = await tempDir();
    await put(cwd, "locked/a.css", "a { background: linear-gradient(red, blue); }");
    await put(cwd, "b.css", "a { background: linear-gradient(red, blue); }");
    const fs = failingFs((p) => p.endsWith("locked"), "EACCES", ["readdir"]);
    const r = await cli(["score", "."], { cwd, fs });
    expect(r.code).toBe(3);
    expect(r.stdout).toMatch(/b\.css:1/);
  });

  it("works with a real permission failure when not running as root", async () => {
    if (process.getuid?.() === 0) return; // root reads everything
    const cwd = await tempDir();
    const f = await put(cwd, "a.css", "a { background: linear-gradient(red, blue); }");
    await chmod(f, 0o000);
    const r = await cli(["score", "a.css"], { cwd });
    expect(r.code).toBe(3);
  });

  it("never throws, even when the file system does", async () => {
    const cwd = await fixtureCopy();
    const fs = {
      stat: () => Promise.reject(new Error("boom")),
      readdir: () => Promise.reject(new Error("boom")),
      readFile: () => Promise.reject(new Error("boom")),
      writeFile: () => Promise.reject(new Error("boom")),
    };
    const r = await cli(["score", "."], { cwd, fs });
    expect(r.code).toBe(3);
  });

  it("an exception inside the output stream is swallowed", async () => {
    const { run } = await import("../src/run");
    const cwd = await fixtureCopy();
    const code = await run(["score", "smooth.css"], {
      stdout: { write: () => { throw new Error("EPIPE"); } },
      stderr: { write: () => { throw new Error("EPIPE"); } },
      fs: (await import("../src/node-io")).nodeFs,
      readStdin: async () => new Uint8Array(),
      cwd,
      color: false,
      version: "0",
    });
    expect(code).toBe(0);
  });
});

describe("--help and --version", () => {
  it("--help prints usage to stdout with exit 0", async () => {
    const r = await cli(["--help"], { cwd: await tempDir() });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^opal42 - smoothness score/);
    expect(r.stdout).toMatch(/Exit codes:/);
    expect(r.stderr).toBe("");
  });

  it("help text never calls the score a quality verdict", async () => {
    const r = await cli(["--help"], { cwd: await tempDir() });
    expect(r.stdout).toMatch(/not a quality verdict/);
  });

  it("--version prints just the version", async () => {
    const r = await cli(["--version"], { cwd: await tempDir() });
    expect(r).toEqual({ code: 0, stdout: `${TEST_VERSION}\n`, stderr: "" });
  });
});

describe("text output", () => {
  it("says 'smoothness score' and never 'quality'", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["score", "--verbose", "."], { cwd });
    expect(r.stdout).toMatch(/smoothness score \d+\/100/);
    expect(r.stdout.toLowerCase()).not.toContain("quality");
    expect(r.stdout.toLowerCase()).not.toMatch(/\b(good|bad|excellent|poor)\b/);
  });

  it("lists issues with file:line:col of the offending stop", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["score", "rough.css"], { cwd });
    expect(r.stdout).toContain("rough.css:3:47  error  lightness/reversal  -12");
  });

  it("summarises skipped gradients by code unless --verbose", async () => {
    const cwd = await fixtureCopy();
    const plain = await cli(["score", "skipped.css"], { cwd });
    expect(plain.stdout).toMatch(/8 skipped \(alpha 1, color-mix 1, legacy-syntax 1, length-position 1, too-few-stops 1, unsupported-kind 2, var 1\)/);
    expect(plain.stdout).not.toMatch(/skipped \(var\)/);
    const verbose = await cli(["score", "--verbose", "skipped.css"], { cwd });
    expect(verbose.stdout).toMatch(/skipped\.css:2:25 {2}skipped \(var\)/);
  });

  it("notes hard stops", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["score", "rough.css"], { cwd });
    expect(r.stdout).toMatch(/hard stops; the v1 score does not adjust for stripes/);
  });

  it("prints the summary with min/mean/max", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["score", "smooth.css"], { cwd });
    expect(r.stdout).toMatch(/1 file scanned, 3 gradients: 3 scored/);
    expect(r.stdout).toMatch(/smoothness score: min 95, mean 96.67, max 100/);
  });

  it("--no-color and a non-colour terminal give plain text; colour adds escapes", async () => {
    const cwd = await fixtureCopy();
    const off = await cli(["score", "rough.css"], { cwd, color: false });
    const noFlag = await cli(["score", "--no-color", "rough.css"], { cwd, color: true });
    const on = await cli(["score", "rough.css"], { cwd, color: true });
    expect(off.stdout).not.toContain("\u001b[");
    expect(noFlag.stdout).toBe(off.stdout);
    expect(on.stdout).toContain("\u001b[");
    expect(on.stdout.replaceAll("\u001b[1m", "").replaceAll("\u001b[22m", "").replaceAll("\u001b[2m", "").replaceAll("\u001b[32m", "").replaceAll("\u001b[39m", "")).toBe(off.stdout);
  });

  it("JSON output is never coloured", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["score", "--json", "rough.css"], { cwd, color: true });
    expect(r.stdout).not.toContain("\u001b[");
  });

  it("--quiet prints nothing for a clean run", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["score", "--quiet", "rough.css"], { cwd });
    expect(r).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  it("--quiet with --min-score prints only the failing gradients", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["score", "--quiet", "--min-score", "60", "rough.css"], { cwd });
    expect(r.code).toBe(1);
    const heads = r.stdout.split("\n").filter((l) => l.includes("smoothness score"));
    expect(heads).toHaveLength(2); // 58 and 41
    expect(r.stdout).not.toMatch(/files? scanned/);
  });

  it("--quiet does not hide errors", async () => {
    const r = await cli(["score", "--quiet", "nope.css"], { cwd: await tempDir() });
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/nope\.css/);
  });

  it("--max-gradients caps the gradients examined per file, with a notice", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["score", "--json", "--max-gradients", "2", "rough.css"], { cwd });
    const rep = json(r.stdout);
    expect(rep.files[0].gradients).toHaveLength(2);
    expect(rep.files[0].gradientsNotExamined).toBe(3);
    const t = await cli(["score", "--max-gradients", "2", "rough.css"], { cwd });
    expect(t.stderr).toMatch(/3 more gradients not examined \(--max-gradients 2\)/);
  });
});

describe("github annotations", () => {
  it("emits one ::warning per issue with file, line, col, endLine, endColumn and title", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["score", "--format", "github", "rough.css"], { cwd });
    expect(r.stdout).toContain(
      "::warning file=rough.css,line=7,col=50,endLine=7,endColumn=57,title=opal42 lightness/reversal::Lightness fluctuates (1 reversal) — creates visual noise (-12 points)",
    );
  });

  it("info issues become notices", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["score", "--format", "github", "smooth.css"], { cwd });
    expect(r.stdout).toMatch(/^::notice file=smooth\.css/m);
  });

  it("a gradient below --min-score is an ::error", async () => {
    const cwd = await fixtureCopy();
    const r = await cli(["score", "--format", "github", "--min-score", "60", "rough.css"], { cwd });
    expect(r.stdout).toMatch(/^::error file=rough\.css,line=3,col=15,endLine=3,endColumn=68,title=Smoothness score below minimum::smoothness score 58\/100 is below --min-score 60/m);
  });

  it("skipped gradients are notices, or errors under --fail-on-unscorable", async () => {
    const cwd = await fixtureCopy();
    const a = await cli(["score", "--format", "github", "skipped.css"], { cwd });
    expect(a.stdout).toMatch(/^::notice file=skipped\.css,line=2,col=25.*title=opal42 skipped%3A var::/m);
    const b = await cli(["score", "--format", "github", "--fail-on-unscorable", "skipped.css"], { cwd });
    expect(b.stdout).toMatch(/^::error file=skipped\.css,line=2/m);
  });

  it("escapes %, commas, colons and newlines", async () => {
    const cwd = await tempDir();
    await put(cwd, "we,ird:100%.css", "a { background: linear-gradient(#111111, #eeeeee, #222222); }");
    const r = await cli(["score", "--format", "github", "we,ird:100%.css"], { cwd });
    expect(r.stdout).toContain("file=we%2Cird%3A100%25.css,");
  });

  it("I/O problems are ::error annotations", async () => {
    const r = await cli(["score", "--format", "github", "gone.css"], { cwd: await tempDir() });
    expect(r.stdout).toMatch(/^::error file=gone\.css,title=opal42::no such file or directory \(ENOENT\)/m);
  });
});

describe("file selection", () => {
  it("--ignore skips matching files and directories", async () => {
    const cwd = await fixtureCopy();
    const rep = json((await cli(["score", "--json", "--ignore", "nested", "--ignore", "*.vue", "--ignore", "skipped.css", "."], { cwd })).stdout);
    expect(rep.files.map((f) => f.path)).not.toContain("nested/legacy.scss");
    expect(rep.files.map((f) => f.path)).not.toContain("card.vue");
    expect(rep.files.map((f) => f.path)).not.toContain("skipped.css");
    expect(rep.files.map((f) => f.path)).toContain("rough.css");
  });

  it("an explicitly named file that matches --ignore is reported as skipped", async () => {
    const cwd = await fixtureCopy();
    const rep = json((await cli(["score", "--json", "--ignore", "rough.css", "rough.css"], { cwd })).stdout);
    expect(rep.files[0]).toMatchObject({ path: "rough.css", status: "skipped", skipped: { code: "ignored" } });
  });

  it("skips a binary file with a notice and exit 0", async () => {
    const cwd = await tempDir();
    await put(cwd, "logo.css", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 2, 3]));
    await put(cwd, "ok.css", "a { background: linear-gradient(#003366, #99ccff); }");
    const r = await cli(["score", "."], { cwd });
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/skipped logo\.css: binary file/);
    expect(r.stdout).toMatch(/ok\.css:1/);
    expect(r.stdout).toMatch(/1 file not read/);
  });

  it("skips a file larger than 2 MB without reading it", async () => {
    const cwd = await tempDir();
    await put(cwd, "huge.css", "x".repeat(2 * 1024 * 1024 + 1));
    let reads = 0;
    const base = (await import("../src/node-io")).nodeFs;
    const fs = { ...base, readFile: (p: string) => { reads++; return base.readFile(p); } };
    const r = await cli(["score", "--json", "huge.css"], { cwd, fs });
    expect(r.code).toBe(0);
    expect(reads).toBe(0);
    expect(json(r.stdout).files[0]).toMatchObject({ status: "skipped", skipped: { code: "too-large", reason: "larger than 2 MB" } });
  });

  it("scans a file of exactly 2 MB", async () => {
    const cwd = await tempDir();
    const gradient = "a{background:linear-gradient(#003366,#99ccff)}";
    const pad = "/*" + "x".repeat(2 * 1024 * 1024 - gradient.length - 4) + "*/";
    await put(cwd, "edge.css", gradient + pad);
    const rep = json((await cli(["score", "--json", "edge.css"], { cwd })).stdout);
    expect(rep.files[0].status).toBe("scanned");
    expect(rep.files[0].gradients).toHaveLength(1);
  });

  it("skips a file that is not valid UTF-8", async () => {
    const cwd = await tempDir();
    await put(cwd, "latin1.css", new Uint8Array([0x2f, 0x2a, 0xe9, 0x2a, 0x2f]));
    const rep = json((await cli(["score", "--json", "latin1.css"], { cwd })).stdout);
    expect(rep.files[0]).toMatchObject({ status: "skipped", skipped: { code: "not-utf8" } });
  });

  it("an empty file is scanned and has no gradients", async () => {
    const cwd = await tempDir();
    await put(cwd, "empty.css", "");
    const rep = json((await cli(["score", "--json", "empty.css"], { cwd })).stdout);
    expect(rep.files[0]).toMatchObject({ status: "scanned", gradients: [] });
    expect(rep.summary).toMatchObject({ gradients: 0, scoreMean: null, scoreMin: null });
  });

  it("a directory with nothing to scan exits 0", async () => {
    const cwd = await tempDir();
    await put(cwd, "readme.txt", "hi");
    const r = await cli(["score", "."], { cwd });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/0 files scanned, 0 gradients/);
  });
});

describe("line and column", () => {
  it("handles CRLF files like LF files", async () => {
    const lf = await fixtureCopy();
    const crlf = await tempDir();
    await put(crlf, "rough.css", (await read(lf, "rough.css")).replace(/\n/g, "\r\n"));
    const a = json((await cli(["score", "--json", "rough.css"], { cwd: lf })).stdout);
    const b = json((await cli(["score", "--json", "rough.css"], { cwd: crlf })).stdout);
    expect(b.files[0].gradients.map((g) => g.loc)).toEqual(a.files[0].gradients.map((g) => g.loc));
    expect(b.files[0].gradients.flatMap((g) => g.issues.map((i) => i.loc))).toEqual(a.files[0].gradients.flatMap((g) => g.issues.map((i) => i.loc)));
  });

  it("offsets are UTF-16 and columns count code units after astral characters", async () => {
    const cwd = await tempDir();
    const text = "/* \u{1F308} */ a { background: linear-gradient(#111111, #eeeeee, #222222); }\n";
    await put(cwd, "emoji.css", text);
    const rep = json((await cli(["score", "--json", "emoji.css"], { cwd })).stdout);
    const g = rep.files[0].gradients[0];
    expect(g.range.start).toBe(text.indexOf("linear-gradient"));
    expect(text.slice(g.range.start, g.range.end)).toBe("linear-gradient(#111111, #eeeeee, #222222)");
    expect(g.loc.col).toBe(text.indexOf("linear-gradient") + 1);
    expect(g.loc.line).toBe(1);
  });

  it("a UTF-8 BOM is not counted as a column", async () => {
    const cwd = await tempDir();
    await put(cwd, "bom.css", "﻿a { background: linear-gradient(#003366, #99ccff); }");
    const rep = json((await cli(["score", "--json", "bom.css"], { cwd })).stdout);
    expect(rep.files[0].gradients[0].loc.col).toBe(17);
  });
});

describe("standard input", () => {
  it("scores text from stdin when given -", async () => {
    const cwd = await tempDir();
    const r = await cli(["score", "-"], { cwd, stdin: "a { background: linear-gradient(90deg, #ff0000, #00ff00 50%, #0000ff); }" });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/<stdin>:1:17 {2}smoothness score 58\/100/);
  });

  it("reports <stdin> as the path in JSON", async () => {
    const cwd = await tempDir();
    const rep = json((await cli(["score", "--json", "-"], { cwd, stdin: "linear-gradient(red, blue)" })).stdout);
    expect(rep.files[0].path).toBe("<stdin>");
    expect(rep.files[0].gradients).toHaveLength(1);
  });

  it("applies --min-score to stdin", async () => {
    const cwd = await tempDir();
    const r = await cli(["score", "--min-score", "90", "-"], { cwd, stdin: "linear-gradient(90deg, #ff0000, #00ff00 50%, #0000ff)" });
    expect(r.code).toBe(1);
  });

  it("empty stdin is fine", async () => {
    const r = await cli(["score", "-"], { cwd: await tempDir(), stdin: "" });
    expect(r.code).toBe(0);
  });

  it("skips binary stdin and oversized stdin", async () => {
    const cwd = await tempDir();
    const bin = await cli(["score", "--json", "-"], { cwd, stdin: new Uint8Array([1, 0, 2]) });
    expect(json(bin.stdout).files[0].skipped?.code).toBe("binary");
    const big = await cli(["score", "--json", "-"], { cwd, stdin: new Uint8Array(2 * 1024 * 1024 + 5).fill(120) });
    expect(json(big.stdout).files[0].skipped?.code).toBe("too-large");
  });

  it("can be combined with files", async () => {
    const cwd = await fixtureCopy();
    const rep = json((await cli(["score", "--json", "smooth.css", "-"], { cwd, stdin: "linear-gradient(red, blue)" })).stdout);
    expect(rep.files.map((f) => f.path)).toEqual(["smooth.css", "<stdin>"]);
  });
});
