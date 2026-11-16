// GitHub Actions workflow commands (annotations).
// https://docs.github.com/actions/reference/workflow-commands-for-github-actions

import { effectiveScore } from "../summary";
import type { FileReport } from "../types";

const escapeData = (s: string): string => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProp = (s: string): string => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

type Level = "error" | "warning" | "notice";

function annotation(
  level: Level,
  title: string,
  message: string,
  file: string,
  loc?: { line: number; col: number; endLine: number; endCol: number },
): string {
  const props = [`file=${escapeProp(file)}`];
  if (loc) {
    props.push(`line=${loc.line}`, `col=${loc.col}`, `endLine=${loc.endLine}`, `endColumn=${loc.endCol}`);
  }
  props.push(`title=${escapeProp(title)}`);
  return `::${level} ${props.join(",")}::${escapeData(message)}`;
}

export interface GithubContext {
  minScore: number | undefined;
  failOnUnscorable: boolean;
  quiet: boolean;
  command: "score" | "refine";
}

/**
 * Issues are annotated as warnings (info as notices): an annotation never
 * fails the step by itself. Only a gradient below --min-score, a skipped
 * gradient under --fail-on-unscorable and I/O problems are errors.
 */
export function githubLines(file: FileReport, ctx: GithubContext): string[] {
  const out: string[] = [];
  if (file.status === "error" && file.error) {
    out.push(annotation("error", "opal42", `${file.error.message} (${file.error.code})`, file.path));
    return out;
  }
  for (const g of file.gradients) {
    if (g.status === "skipped") {
      if (ctx.quiet && !ctx.failOnUnscorable) continue;
      const level: Level = ctx.failOnUnscorable ? "error" : "notice";
      out.push(annotation(level, `opal42 skipped: ${g.skipped?.code}`, g.skipped?.reason ?? "skipped", file.path, g.loc));
      continue;
    }
    const score = effectiveScore(g) ?? 0;
    const below = ctx.minScore !== undefined && score < ctx.minScore;
    if (below) {
      out.push(
        annotation("error", "Smoothness score below minimum", `smoothness score ${score}/100 is below --min-score ${ctx.minScore}`, file.path, g.loc),
      );
    }
    if (ctx.quiet && !below) continue;
    for (const issue of g.issues) {
      const level: Level = issue.severity === "info" ? "notice" : "warning";
      out.push(annotation(level, `opal42 ${issue.code}`, `${issue.message} (-${issue.pointsLost} points)`, file.path, issue.loc));
    }
    if (g.fix) {
      out.push(
        annotation(
          "notice",
          g.fix.applied ? "opal42 refinement applied" : "opal42 refinement available",
          `smoothness score ${g.fix.scoreBefore} -> ${g.fix.scoreAfter} with ${g.fix.replacement}`,
          file.path,
          g.loc,
        ),
      );
    }
  }
  return out;
}

export function githubNotice(file: FileReport): string | null {
  if (file.status === "skipped" && file.skipped) return annotation("notice", "opal42", `skipped: ${file.skipped.reason}`, file.path);
  return null;
}
