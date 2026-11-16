// Markdown for the hover over a gradient. Pure: returns a string.
//
// Plain-language text per rule comes from the web app's explain module
// (apps/web/src/explain/explain.ts: no imports, no DOM), bundled into the
// extension by esbuild, so the editor and the app use the same words.

import type { AnalyzedGradient, FixAction } from "./analyze";
import { bestFix, skipWords } from "./analyze";
import { swatchMarkdown } from "./preview";
import { ruleText, SEVERITY_LABEL } from "../../web/src/explain/explain";

/** Characters that could change the meaning of markdown. */
export function escapeMarkdown(s: string): string {
  return String(s).replace(/[\\`*_{}[\]<>()#+!|~&]/g, "\\$&");
}

const BUDGETS = { lightness: 30, hue: 30, chroma: 20, spacing: 20 } as const;
const DIMENSION_LABELS: Readonly<Record<keyof typeof BUDGETS, string>> = {
  lightness: "Lightness",
  hue: "Hue",
  chroma: "Chroma",
  spacing: "Spacing",
};

/** "Lightness 18/30 - Hue 10/30 - Chroma 10/20 - Spacing 20/20" */
export function dimensionSummary(dimensions: NonNullable<AnalyzedGradient["dimensions"]>): string {
  return (Object.keys(BUDGETS) as (keyof typeof BUDGETS)[])
    .map((k) => `${DIMENSION_LABELS[k]} ${dimensions[k]}/${BUDGETS[k]}`)
    .join(" · ");
}

export interface HoverOptions {
  /** Fixes already computed for this gradient (the hover shows the best one). */
  fixes?: readonly FixAction[];
  /** The URL-encoded JSON of the arguments of the `opal42.openInStudio` command, if the link should be shown. */
  studioArgs?: string;
}

/** The hover body for one analysed gradient. */
export function hoverMarkdown(item: AnalyzedGradient, opts: HoverOptions = {}): string {
  const parts: string[] = [];
  if (item.status === "skipped" || item.score === undefined || !item.dimensions) {
    const code = item.skip?.code ?? "unknown";
    parts.push(`**Opal42: not scored** (${escapeMarkdown(skipWords(code))})`);
    parts.push(escapeMarkdown(item.skip?.reason ?? ""));
    return parts.filter(Boolean).join("\n\n");
  }

  parts.push(`**Smoothness score ${item.score}/100**`);
  parts.push(
    `${escapeMarkdown(dimensionSummary(item.dimensions))}\n\n` +
      "_A smoothness score by our definition (scoring model v1), not a verdict on the design._",
  );

  const current = item.parsed.document ? swatchMarkdown(item.parsed.document, "Current gradient") : null;
  if (current) parts.push(current);

  if (item.issues.length === 0) {
    parts.push("No findings.");
  } else {
    const lines = item.issues.map((issue) => {
      const text = ruleText(issue.code);
      const size = SEVERITY_LABEL[issue.severity];
      return (
        `- **${escapeMarkdown(text.name)}** (-${issue.pointsLost} points, ${size}): ${escapeMarkdown(text.measures)}\n` +
        `  ${escapeMarkdown(issue.message)}`
      );
    });
    parts.push(`**Findings (${item.issues.length})**\n\n${lines.join("\n")}`);
  }

  const best = opts.fixes ? bestFix(opts.fixes) : undefined;
  if (best) {
    const after = swatchMarkdown(best.document, `After: ${best.label}`);
    parts.push(
      `**Proposed: ${escapeMarkdown(best.label)}** (${best.scoreBefore} to ${best.scoreAfter}, +${best.gain})` +
        (after ? `\n\n${after}` : "") +
        "\n\nUse the quick fix (Ctrl+. / Cmd+.) to apply it; the editor can show the change as a diff first.",
    );
  }

  if (item.parsed.warnings.length > 0) {
    parts.push(
      `Notes: ${item.parsed.warnings.map((w) => escapeMarkdown(w.message)).join(" ")}`,
    );
  }

  if (opts.studioArgs !== undefined) {
    parts.push(`[Open in Gradient Studio](command:opal42.openInStudio?${opts.studioArgs})`);
  }
  return parts.join("\n\n");
}
