// Human-readable output.

import { V1_MODEL } from "@opal42/gradient";
import type { Style } from "../style";
import { effectiveScore } from "../summary";
import type { FileReport, GradientReport, ParseFileReport, ParsedGradientReport, Summary } from "../types";

export interface TextContext {
  style: Style;
  command: "score" | "refine";
  minScore: number | undefined;
  verbose: boolean;
  quiet: boolean;
  /** Whether rewriting was requested and allowed to touch files (not a dry run). */
  writing: boolean;
}

const MAX = V1_MODEL.weights;
const dimensionText = (d: NonNullable<GradientReport["dimensions"]>): string =>
  `lightness ${d.lightness}/${MAX.lightness}, hue ${d.hue}/${MAX.hue}, chroma ${d.chroma}/${MAX.chroma}, spacing ${d.spacing}/${MAX.rhythm}`;

const at = (path: string, loc: { line: number; col: number }): string => `${path}:${loc.line}:${loc.col}`;

/** Lines for one scanned file. `snippets[i]` belongs to `file.gradients[i]`. */
export function fileLines(file: FileReport, snippets: readonly string[], ctx: TextContext): string[] {
  const { style } = ctx;
  const out: string[] = [];
  file.gradients.forEach((g, i) => {
    if (g.status === "skipped") {
      if (ctx.verbose && !ctx.quiet) {
        out.push(style.dim(`${at(file.path, g.loc)}  skipped (${g.skipped?.code})  ${g.skipped?.reason ?? ""}`));
      }
      return;
    }
    const score = effectiveScore(g) ?? 0;
    const below = ctx.minScore !== undefined && score < ctx.minScore;
    if (ctx.quiet && !below) return;
    const shown = g.fix?.applied ? `${g.fix.scoreBefore}/100 -> ${g.fix.scoreAfter}/100` : `${g.score}/100  (${dimensionText(g.dimensions!)})`;
    let head = `${at(file.path, g.loc)}  smoothness score ${shown}  ${snippets[i] ?? ""}`;
    if (below) head = style.red(head + `  [below --min-score ${ctx.minScore}]`);
    else head = style.bold(head);
    out.push(head);
    for (const issue of g.issues) {
      out.push(
        `  ${at(file.path, issue.loc)}  ${issue.severity}  ${issue.code}  -${issue.pointsLost}  ${issue.message}`,
      );
    }
    if (g.analysis?.hasHardStops) out.push(style.dim("  note: hard stops; the v1 score does not adjust for stripes"));
    if (ctx.verbose) {
      for (const w of g.warnings) out.push(style.dim(`  ${w.loc ? at(file.path, w.loc) : file.path}  warning  ${w.code}  ${w.message}`));
    }
    if (g.fix) {
      const verb = g.fix.applied ? "fixed" : ctx.command === "refine" || !ctx.writing ? "refinement available" : "would fix";
      out.push(style.green(`  ${verb}: smoothness score ${g.fix.scoreBefore} -> ${g.fix.scoreAfter}`));
      if (ctx.command === "refine" || !g.fix.applied) {
        out.push(`    - ${oneLine(g.fix.original)}`);
        out.push(`    + ${oneLine(g.fix.replacement)}`);
      }
    }
  });
  return out;
}

function oneLine(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > 240 ? one.slice(0, 239) + "…" : one;
}

/** The notice for a file that was skipped or could not be read. */
export function fileNotice(file: FileReport | ParseFileReport): string | null {
  if (file.status === "skipped" && file.skipped) return `opal42: skipped ${file.path}: ${file.skipped.reason}`;
  if (file.status === "error" && file.error) return `opal42: error: ${file.path}: ${file.error.message} (${file.error.code})`;
  return null;
}

export function summaryLines(s: Summary, ctx: TextContext): string[] {
  const parts: string[] = [];
  const files = `${s.filesScanned} file${s.filesScanned === 1 ? "" : "s"} scanned`;
  parts.push(
    `${files}, ${s.gradients} gradient${s.gradients === 1 ? "" : "s"}: ${s.scored} scored` +
      (s.skipped > 0
        ? `, ${s.skipped} skipped (${Object.entries(s.skippedByCode)
            .map(([code, n]) => `${code} ${n}`)
            .join(", ")})`
        : ""),
  );
  const lines = [parts[0]];
  if (s.scoreMean !== null) {
    lines.push(`smoothness score: min ${s.scoreMin}, mean ${s.scoreMean}, max ${s.scoreMax}`);
  }
  if (s.filesSkipped > 0) lines.push(`${s.filesSkipped} file${s.filesSkipped === 1 ? "" : "s"} not read (see notices above)`);
  if (s.minScore !== null) {
    lines.push(
      s.belowMinScore > 0
        ? ctx.style.red(`${s.belowMinScore} gradient${s.belowMinScore === 1 ? "" : "s"} below --min-score ${s.minScore}`)
        : `all scored gradients are at or above --min-score ${s.minScore}`,
    );
  }
  if (s.failOnUnscorable && s.skipped > 0) lines.push(ctx.style.red(`${s.skipped} skipped gradient${s.skipped === 1 ? "" : "s"} (--fail-on-unscorable)`));
  if (s.fixable > 0 || ctx.command === "refine") {
    const n = (k: number): string => `${k} gradient${k === 1 ? "" : "s"}`;
    if (s.fixed > 0) lines.push(`fixed ${n(s.fixed)}`);
    else if (s.fixable > 0) lines.push(`${n(s.fixable)} can be refined; ${ctx.command === "refine" ? "run with --write to apply" : "nothing written (--dry-run)"}`);
    else lines.push("no gradient can be refined further");
  }
  return lines;
}

// ── parse (debug) ─────────────────────────────────────────────────────────────

const span = (l: { line: number; col: number; endLine: number; endCol: number }): string =>
  l.line === l.endLine ? `${l.line}:${l.col}-${l.endCol}` : `${l.line}:${l.col}-${l.endLine}:${l.endCol}`;

export function parseFileLines(file: ParseFileReport, style: Style): string[] {
  const out: string[] = [];
  for (const g of file.gradients) out.push(...parsedGradientLines(file.path, g, style));
  return out;
}

function parsedGradientLines(path: string, g: ParsedGradientReport, style: Style): string[] {
  const name = `${g.vendorPrefix ?? ""}${g.repeating ? "repeating-" : ""}${g.kind}-gradient`;
  const state = g.skipped ? style.dim(`skipped (${g.skipped.code}): ${g.skipped.reason}`) : `parsed, ${stopCount(g)} stops`;
  const out = [style.bold(`${at(path, g.loc)}  ${name}  [${g.range.start},${g.range.end})  ${state}`)];
  if (g.angleRange) out.push(`  direction  ${span(g.angleRange.loc)}  [${g.angleRange.range.start},${g.angleRange.range.end})  ${JSON.stringify(g.angleRange.text)}`);
  g.stopRanges.forEach((r, i) => {
    out.push(`  stop ${i}  ${span(r.loc)}  [${r.range.start},${r.range.end})  ${JSON.stringify(r.text)}`);
  });
  for (const w of g.warnings) out.push(style.dim(`  warning  ${w.code}  ${w.message}`));
  return out;
}

function stopCount(g: ParsedGradientReport): number {
  const d = g.document as { stops?: unknown[] } | null;
  return d?.stops?.length ?? 0;
}
