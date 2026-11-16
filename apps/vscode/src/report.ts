// Plain-text summary for the output channel ("Opal42: Score current file"). Pure.

import { skipWords, type Analysis, type AnalyzedGradient } from "./analyze";

export interface LineCol {
  /** 1-based. */
  line: number;
  /** 1-based, in UTF-16 units (what editors show). */
  column: number;
}

/** 1-based line and column of a UTF-16 offset. A line ends at \n, \r\n or \r (as in VS Code). */
export function lineCol(text: string, offset: number): LineCol {
  const end = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < end; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: end - lineStart + 1 };
}

function describe(text: string, g: AnalyzedGradient): string[] {
  const at = lineCol(text, g.range.start);
  const where = `${at.line}:${at.column}`;
  if (g.status === "skipped") return [`  ${where}  not scored (${skipWords(g.skip?.code ?? "unknown")})`];
  const lines = [`  ${where}  smoothness ${g.score}/100, ${g.issues.length} issue${g.issues.length === 1 ? "" : "s"}`];
  for (const d of g.diagnostics) {
    const p = lineCol(text, d.range.start);
    lines.push(`      ${p.line}:${p.column}  ${d.code}  ${d.message}`);
  }
  return lines;
}

/** The summary of one analysed document. */
export function formatReport(fileName: string, text: string, analysis: Analysis): string {
  const out: string[] = [fileName];
  if (analysis.limit === "size") {
    out.push(`  Not analysed: the document is larger than the size limit (${Math.round(analysis.bytes / 1024)} KB; setting opal42.maxFileSizeKB).`);
    return out.join("\n");
  }
  const scored = analysis.items.filter((g) => g.status === "scored");
  const skipped = analysis.items.length - scored.length;
  if (analysis.items.length === 0) {
    out.push("  No gradients found.");
  } else {
    for (const g of analysis.items) out.push(...describe(text, g));
    const total = scored.reduce((n, g) => n + (g.score ?? 0), 0);
    const mean = scored.length ? Math.round(total / scored.length) : 0;
    out.push(
      `  ${analysis.items.length} gradient${analysis.items.length === 1 ? "" : "s"}: ${scored.length} scored` +
        (scored.length ? ` (mean smoothness ${mean})` : "") +
        `, ${skipped} not scored.`,
    );
  }
  if (analysis.limit === "count" || analysis.limit === "time" || analysis.limit === "input") {
    out.push(`  The result is partial (limit: ${analysis.limit}).`);
  }
  return out.join("\n");
}
