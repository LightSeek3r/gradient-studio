// One decoded text → gradient reports (scoring, and optionally the rewrite).

import { parseGradient, scoreParsed, type ParsedGradient } from "@opal42/gradient";
import { fixBlock, fixGradientText } from "./fix";
import { MAX_FILE_BYTES } from "./limits";
import { LineIndex } from "./lines";
import type { GradientReport, IssueReport, Located, ParsedGradientReport, WarningReport } from "./types";

export interface AnalyzeOptions {
  maxGradients: number;
  /** Compute rewrites (score --fix, refine). */
  wantFix: boolean;
}

export interface Edit {
  start: number;
  end: number;
  text: string;
}

export interface Analysis {
  gradients: GradientReport[];
  /** One-line source excerpt per gradient (display only, not part of the JSON). */
  snippets: string[];
  gradientsNotExamined: number;
  /** Non-overlapping edits, ascending, for the gradients that have a `fix`. */
  edits: Edit[];
}

function warningReports(g: ParsedGradient, index: LineIndex): WarningReport[] {
  return g.warnings.map((w) => {
    const r: WarningReport = { code: w.code, message: w.message };
    if (w.range) {
      r.range = { start: w.range.start, end: w.range.end };
      r.loc = index.range(w.range.start, w.range.end);
    }
    return r;
  });
}

function parseAll(text: string): ParsedGradient[] {
  return parseGradient(text, { maxInputLength: MAX_FILE_BYTES }).gradients;
}

const SNIPPET_MAX = 70;
/** One line: whitespace collapsed, cut with an ellipsis. */
export function snippet(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= SNIPPET_MAX) return one;
  let cut = one.slice(0, SNIPPET_MAX - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1); // do not split a surrogate pair
  return cut + "\u2026";
}

export function analyzeText(text: string, opts: AnalyzeOptions): Analysis {
  const index = new LineIndex(text);
  const all = parseAll(text);
  const examined = all.slice(0, opts.maxGradients);
  const gradients: GradientReport[] = [];
  const snippets: string[] = [];
  const edits: Edit[] = [];
  let lastEnd = -1;

  for (const g of examined) {
    const base = {
      range: { start: g.range.start, end: g.range.end },
      loc: index.range(g.range.start, g.range.end),
      kind: g.kind,
      repeating: g.repeating,
      ...(g.vendorPrefix ? { vendorPrefix: g.vendorPrefix } : {}),
    };
    snippets.push(snippet(text.slice(g.range.start, Math.min(g.range.end, g.range.start + 400))));
    const warnings = warningReports(g, index);
    const result = scoreParsed(g);
    if (result.status !== "ok") {
      gradients.push({
        ...base,
        status: "skipped",
        score: null,
        dimensions: null,
        issues: [],
        warnings,
        skipped: { code: result.code, reason: result.reason },
      });
      continue;
    }
    const issues: IssueReport[] = result.issues.map((i) => {
      const range = i.range ?? g.range;
      const out: IssueReport = {
        code: i.code,
        severity: i.severity,
        dimension: i.dimension,
        pointsLost: i.pointsLost,
        message: i.message,
        range: { start: range.start, end: range.end },
        loc: index.range(range.start, range.end),
      };
      if (i.stopIndices) out.stopIndices = [...i.stopIndices];
      return out;
    });
    const report: GradientReport = {
      ...base,
      status: "ok",
      score: result.score,
      dimensions: { ...result.dimensions },
      analysis: { hasHardStops: result.analysis.hasHardStops },
      issues,
      warnings,
    };
    if (opts.wantFix && fixBlock(g) === null && !result.analysis.hasHardStops && g.range.start >= lastEnd) {
      const original = text.slice(g.range.start, g.range.end);
      const fixed = fixGradientText(original);
      if (fixed) {
        report.fix = {
          applied: false,
          scoreBefore: fixed.before,
          scoreAfter: fixed.after,
          original,
          replacement: fixed.text,
        };
        edits.push({ start: g.range.start, end: g.range.end, text: fixed.text });
        lastEnd = g.range.end;
      }
    }
    gradients.push(report);
  }
  return { gradients, snippets, gradientsNotExamined: all.length - examined.length, edits };
}

/** Apply ascending, non-overlapping edits. */
export function applyEdits(text: string, edits: readonly Edit[]): string {
  let out = "";
  let pos = 0;
  for (const e of edits) {
    out += text.slice(pos, e.start) + e.text;
    pos = e.end;
  }
  return out + text.slice(pos);
}

export function analyzeParse(
  text: string,
  maxGradients: number,
): { gradients: ParsedGradientReport[]; gradientsNotExamined: number } {
  const index = new LineIndex(text);
  const all = parseAll(text);
  const examined = all.slice(0, maxGradients);
  const located = (r: { start: number; end: number }): Located => ({
    range: { start: r.start, end: r.end },
    loc: index.range(r.start, r.end),
    text: text.slice(r.start, r.end),
  });
  const gradients = examined.map((g): ParsedGradientReport => {
    const out: ParsedGradientReport = {
      range: { start: g.range.start, end: g.range.end },
      loc: index.range(g.range.start, g.range.end),
      kind: g.kind,
      repeating: g.repeating,
      document: g.document,
      stopRanges: g.stopRanges.map(located),
      warnings: warningReports(g, index),
    };
    if (g.vendorPrefix) out.vendorPrefix = g.vendorPrefix;
    if (g.angleRange) out.angleRange = located(g.angleRange);
    if (g.skipped) out.skipped = { code: g.skipped.code, reason: g.skipped.reason };
    return out;
  });
  return { gradients, gradientsNotExamined: all.length - examined.length };
}
