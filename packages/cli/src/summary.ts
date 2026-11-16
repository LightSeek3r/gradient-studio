// Totals over the file reports, and the exit code.

import type { FileReport, GradientReport, Summary } from "./types";

export interface SummaryInput {
  files: readonly { gradients: readonly GradientReport[]; status: FileReport["status"] }[];
  minScore: number | undefined;
  failOnUnscorable: boolean;
}

/** The score a gradient counts with: the fixed score once a fix was written. */
export function effectiveScore(g: { score: number | null; fix?: { applied: boolean; scoreAfter: number } }): number | null {
  return g.fix?.applied ? g.fix.scoreAfter : g.score;
}

export function summarise(input: SummaryInput): Omit<Summary, "exitCode"> {
  let filesScanned = 0;
  let filesSkipped = 0;
  let filesWithErrors = 0;
  let gradients = 0;
  let scored = 0;
  let skipped = 0;
  let below = 0;
  let fixable = 0;
  let fixed = 0;
  let sum = 0;
  let min: number | null = null;
  let max: number | null = null;
  const skippedByCode: Record<string, number> = {};
  for (const f of input.files) {
    if (f.status === "scanned") filesScanned++;
    else if (f.status === "skipped") filesSkipped++;
    else filesWithErrors++;
    for (const g of f.gradients) {
      gradients++;
      if (g.status === "skipped") {
        skipped++;
        const code = g.skipped?.code ?? "unknown";
        skippedByCode[code] = (skippedByCode[code] ?? 0) + 1;
        continue;
      }
      scored++;
      const s = effectiveScore(g);
      if (s === null) continue;
      sum += s;
      min = min === null ? s : Math.min(min, s);
      max = max === null ? s : Math.max(max, s);
      if (input.minScore !== undefined && s < input.minScore) below++;
      if (g.fix) {
        fixable++;
        if (g.fix.applied) fixed++;
      }
    }
  }
  return {
    filesScanned,
    filesSkipped,
    filesWithErrors,
    gradients,
    scored,
    skipped,
    skippedByCode: Object.fromEntries(Object.entries(skippedByCode).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    belowMinScore: below,
    minScore: input.minScore ?? null,
    failOnUnscorable: input.failOnUnscorable,
    scoreMin: min,
    scoreMax: max,
    scoreMean: scored > 0 ? Math.round((sum / scored) * 100) / 100 : null,
    fixable,
    fixed,
  };
}

export function exitCodeFor(s: Omit<Summary, "exitCode">): 0 | 1 | 3 {
  if (s.filesWithErrors > 0) return 3;
  if (s.belowMinScore > 0) return 1;
  if (s.failOnUnscorable && s.skipped > 0) return 1;
  return 0;
}
