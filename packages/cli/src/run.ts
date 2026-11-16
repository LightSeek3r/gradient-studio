// `run(argv, io)`: the whole CLI as a function. It never throws and returns the
// exit code. The bin file only wires `io` to the real process.

import { applyEdits, analyzeParse, analyzeText, type Edit } from "./analyze";
import { HELP, parseCliArgs, type Options } from "./args";
import { githubLines, githubNotice } from "./format/github";
import { fileLines, fileNotice, parseFileLines, summaryLines, type TextContext } from "./format/text";
import type { CliIo } from "./io";
import { BINARY_SNIFF_BYTES, MAX_FILE_BYTES } from "./limits";
import { makeStyle } from "./style";
import { exitCodeFor, summarise } from "./summary";
import { SCHEMA_VERSION, SCORING_MODEL, type FileReport, type GradientReport, type ParseFileReport, type ParseReport, type Report } from "./types";
import { discover, errorInfo, type Discovered } from "./walk";

const STDIN = "<stdin>";

class Out {
  private readonly buf: string[] = [];
  line(s = ""): void {
    this.buf.push(s + "\n");
  }
  raw(s: string): void {
    this.buf.push(s);
  }
  text(): string {
    return this.buf.join("");
  }
}

function safeWrite(stream: { write(text: string): unknown }, text: string): void {
  if (text === "") return;
  try {
    stream.write(text);
  } catch {
    // A closed pipe (EPIPE) must not turn into an exception.
  }
}

export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    return await runInner(argv, io);
  } catch (e) {
    safeWrite(io.stderr, `opal42: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    return 3;
  }
}

// ── loading ───────────────────────────────────────────────────────────────────

type Loaded =
  | { ok: true; text: string; bom: boolean }
  | { ok: false; status: "skipped"; skipped: NonNullable<FileReport["skipped"]> }
  | { ok: false; status: "error"; error: { code: string; message: string } };

const tooLarge = (): Loaded => ({
  ok: false,
  status: "skipped",
  skipped: { code: "too-large", reason: `larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB` },
});

function decode(bytes: Uint8Array): Loaded {
  if (bytes.length > MAX_FILE_BYTES) return tooLarge();
  const sniff = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < sniff; i++) {
    if (bytes[i] === 0) return { ok: false, status: "skipped", skipped: { code: "binary", reason: "binary file (contains a NUL byte)" } };
  }
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes);
    return { ok: true, text, bom };
  } catch {
    return { ok: false, status: "skipped", skipped: { code: "not-utf8", reason: "not valid UTF-8" } };
  }
}

async function loadFile(io: CliIo, file: Discovered): Promise<Loaded> {
  try {
    const st = await io.fs.stat(file.fsPath);
    if (st.size > MAX_FILE_BYTES) return tooLarge();
    return decode(await io.fs.readFile(file.fsPath));
  } catch (e) {
    return { ok: false, status: "error", error: errorInfo(e) };
  }
}

async function loadStdin(io: CliIo): Promise<Loaded> {
  try {
    const bytes = await io.readStdin(MAX_FILE_BYTES + 1);
    return decode(bytes);
  } catch (e) {
    return { ok: false, status: "error", error: errorInfo(e) };
  }
}

function encode(text: string, bom: boolean): Uint8Array {
  const body = new TextEncoder().encode(text);
  if (!bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf], 0);
  out.set(body, 3);
  return out;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function runInner(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseCliArgs(argv);
  if (parsed.kind === "help") {
    safeWrite(io.stdout, HELP);
    return 0;
  }
  if (parsed.kind === "version") {
    safeWrite(io.stdout, `${io.version}\n`);
    return 0;
  }
  if (parsed.kind === "usage-error") {
    safeWrite(io.stderr, `opal42: ${parsed.message}\nTry "opal42 --help".\n`);
    return 2;
  }
  const o = parsed.options;
  if (o.command === "parse") return runParse(o, io);
  return runScore(o, io, o.command);
}

interface Source {
  path: string;
  load: () => Promise<Loaded>;
  /** Where to write rewritten text (undefined for standard input). */
  fsPath?: string;
  ignored: boolean;
}

async function collectSources(o: Options, io: CliIo): Promise<{ sources: Source[]; problems: FileReport[] }> {
  const named = o.paths.filter((p) => p !== "-");
  const { files, problems } = await discover(named, io.cwd, io.fs, o.ignore);
  const sources: Source[] = files.map((f) => ({ path: f.path, fsPath: f.fsPath, ignored: f.ignored, load: () => loadFile(io, f) }));
  if (o.paths.includes("-")) sources.push({ path: STDIN, ignored: false, load: () => loadStdin(io) });
  const problemReports: FileReport[] = problems.map((p) => ({
    path: p.path,
    status: "error",
    gradients: [],
    error: { code: p.code, message: p.message },
  }));
  return { sources, problems: problemReports };
}

const ignoredSkip = { code: "ignored", reason: "matches --ignore" } as const;

async function runScore(o: Options, io: CliIo, command: "score" | "refine"): Promise<number> {
  const style = makeStyle(io.color && o.color && o.format === "text");
  const writing = (command === "score" && o.fix && !o.dryRun) || (command === "refine" && o.write);
  const wantFix = command === "refine" || o.fix;
  const stdinFilter = writing && o.paths.includes("-");
  const { sources, problems } = await collectSources(o, io);

  const reports: FileReport[] = [];
  const snippets: string[][] = [];
  const stdinText: string[] = [];

  for (const src of sources) {
    if (src.ignored) {
      reports.push({ path: src.path, status: "skipped", gradients: [], skipped: { ...ignoredSkip } });
      snippets.push([]);
      continue;
    }
    const loaded = await src.load();
    if (!loaded.ok) {
      reports.push(
        loaded.status === "skipped"
          ? { path: src.path, status: "skipped", gradients: [], skipped: loaded.skipped }
          : { path: src.path, status: "error", gradients: [], error: loaded.error },
      );
      snippets.push([]);
      continue;
    }
    const analysis = analyzeText(loaded.text, { maxGradients: o.maxGradients, wantFix });
    const report: FileReport = { path: src.path, status: "scanned", gradients: analysis.gradients };
    if (analysis.gradientsNotExamined > 0) report.gradientsNotExamined = analysis.gradientsNotExamined;
    snippets.push(analysis.snippets);
    reports.push(report);

    if (analysis.edits.length > 0 && writing) {
      const newText = applyEdits(loaded.text, analysis.edits as Edit[]);
      if (src.fsPath === undefined) {
        stdinText.push(newText);
        markApplied(analysis.gradients);
        report.rewritten = true;
      } else {
        try {
          await io.fs.writeFile(src.fsPath, encode(newText, loaded.bom));
          markApplied(analysis.gradients);
          report.rewritten = true;
        } catch (e) {
          report.status = "error";
          report.error = { ...errorInfo(e), message: `could not write file: ${errorInfo(e).message}` };
        }
      }
    } else if (stdinFilter && src.fsPath === undefined) {
      stdinText.push(loaded.text); // nothing to change: pass the input through
    }
  }
  reports.push(...problems);
  snippets.push(...problems.map(() => []));

  const base = summarise({ files: reports, minScore: o.minScore, failOnUnscorable: o.failOnUnscorable });
  const exitCode = exitCodeFor(base);
  const summary = { ...base, exitCode };
  const report: Report = {
    schemaVersion: SCHEMA_VERSION,
    tool: { name: "opal42", version: io.version },
    scoringModel: SCORING_MODEL,
    command: command,
    files: reports,
    summary,
  };

  const out = new Out();
  const err = new Out();
  // Errors are always reported on stderr, whatever the format.
  for (const f of reports) {
    if (f.status === "error") err.line(fileNotice(f)!);
  }

  if (o.format === "json") {
    out.raw(JSON.stringify(report, null, 2) + "\n");
  } else {
    const ctx: TextContext = {
      style,
      command: command,
      minScore: o.minScore,
      verbose: o.verbose,
      quiet: o.quiet,
      writing: Boolean(writing),
    };
    // With the rewritten text on stdout, the report moves to stderr.
    const sink = stdinFilter ? err : out;
    if (o.format === "github") {
      for (const f of reports) {
        const n = githubNotice(f);
        if (n && !o.quiet) sink.line(n);
        for (const l of githubLines(f, { minScore: o.minScore, failOnUnscorable: o.failOnUnscorable, quiet: o.quiet, command: command })) sink.line(l);
      }
    } else {
      reports.forEach((f, i) => {
        if (f.status === "skipped" && !o.quiet) err.line(fileNotice(f)!);
        for (const l of fileLines(f, snippets[i] ?? [], ctx)) sink.line(l);
        if (f.gradientsNotExamined && !o.quiet) err.line(`opal42: ${f.path}: ${f.gradientsNotExamined} more gradients not examined (--max-gradients ${o.maxGradients})`);
      });
    }
    if (!o.quiet) {
      sink.line();
      for (const l of summaryLines(summary, ctx)) sink.line(l);
    }
    for (const t of stdinText) out.raw(t);
  }

  safeWrite(io.stdout, out.text());
  safeWrite(io.stderr, err.text());
  return exitCode;
}

function markApplied(gradients: GradientReport[]): void {
  for (const g of gradients) if (g.fix) g.fix.applied = true;
}

async function runParse(o: Options, io: CliIo): Promise<number> {
  const style = makeStyle(io.color && o.color && o.format === "text");
  const { sources, problems } = await collectSources(o, io);
  const files: ParseFileReport[] = [];
  for (const src of sources) {
    if (src.ignored) {
      files.push({ path: src.path, status: "skipped", gradients: [], skipped: { ...ignoredSkip } });
      continue;
    }
    const loaded = await src.load();
    if (!loaded.ok) {
      files.push(
        loaded.status === "skipped"
          ? { path: src.path, status: "skipped", gradients: [], skipped: loaded.skipped }
          : { path: src.path, status: "error", gradients: [], error: loaded.error },
      );
      continue;
    }
    const a = analyzeParse(loaded.text, o.maxGradients);
    const f: ParseFileReport = { path: src.path, status: "scanned", gradients: a.gradients };
    if (a.gradientsNotExamined > 0) f.gradientsNotExamined = a.gradientsNotExamined;
    files.push(f);
  }
  for (const p of problems) files.push({ path: p.path, status: "error", gradients: [], error: p.error });

  const errors = files.filter((f) => f.status === "error").length;
  const exitCode = errors > 0 ? 3 : 0;
  const all = files.flatMap((f) => f.gradients);
  const report: ParseReport = {
    schemaVersion: SCHEMA_VERSION,
    tool: { name: "opal42", version: io.version },
    command: "parse",
    files,
    summary: {
      filesScanned: files.filter((f) => f.status === "scanned").length,
      filesSkipped: files.filter((f) => f.status === "skipped").length,
      filesWithErrors: errors,
      gradients: all.length,
      skipped: all.filter((g) => g.skipped).length,
      exitCode,
    },
  };

  const out = new Out();
  const err = new Out();
  for (const f of files) {
    if (f.status === "error") err.line(fileNotice(f)!);
    else if (f.status === "skipped" && o.format === "text" && !o.quiet) err.line(fileNotice(f)!);
  }
  if (o.format === "json") {
    out.raw(JSON.stringify(report, null, 2) + "\n");
  } else {
    for (const f of files) for (const l of parseFileLines(f, style)) out.line(l);
    if (!o.quiet) {
      out.line();
      out.line(`${report.summary.gradients} gradient${report.summary.gradients === 1 ? "" : "s"} found in ${report.summary.filesScanned} file${report.summary.filesScanned === 1 ? "" : "s"}, ${report.summary.skipped} skipped by the parser`);
    }
  }
  safeWrite(io.stdout, out.text());
  safeWrite(io.stderr, err.text());
  return exitCode;
}
