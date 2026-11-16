// Prompt emission: briefs as JSONL ready to feed any model. The harness never
// calls a model; whoever runs the prompts writes the results file.

import type { Brief, BriefSet } from "./briefs";

export const DEFAULT_TEMPLATE = `You are a UI designer and front-end developer.

Brief ({{id}}, {{category}}):
{{brief}}
{{constraints}}
Return the CSS (or Tailwind classes) for this component or background. Include every gradient you use, written out in full, and add one sentence on why you chose it.`;

/** Appended for the `with-skill` condition. It points at the skill file in this repository. */
export const WITH_SKILL_TEXT = `Before you write or finalise any CSS gradient, read skills/gradient-quality/SKILL.md in this repository and follow it: score each gradient you intend to emit with the opal42 tools it describes, and fix findings the way the skill says. If you cannot run those tools, say so and carry on without them.`;

export interface ConditionSpec {
  name: string;
  /** Text appended after the prompt ('' for the baseline). */
  text: string;
}

export const BUILTIN_CONDITIONS: Record<string, string> = { baseline: "", "with-skill": WITH_SKILL_TEXT };

export interface PromptLine {
  briefId: string;
  category: string;
  condition: string;
  prompt: string;
}

function constraintsBlock(b: Brief): string {
  const lines: string[] = [];
  if (b.constraints?.length) lines.push("Constraints:", ...b.constraints.map((c) => `- ${c}`));
  if (b.brandColors?.length) lines.push(`Brand colours: ${b.brandColors.join(", ")}`);
  return lines.length ? "\n" + lines.join("\n") + "\n" : "";
}

function fill(template: string, b: Brief): string {
  return template
    .replace(/\{\{id\}\}/g, b.id)
    .replace(/\{\{category\}\}/g, b.category)
    .replace(/\{\{brief\}\}/g, b.brief)
    .replace(/\{\{constraints\}\}/g, constraintsBlock(b))
    .replace(/\n{3,}/g, "\n\n");
}

export function renderPrompt(b: Brief, opts: { template?: string; prefix?: string; conditionText?: string } = {}): string {
  const body = fill(opts.template ?? DEFAULT_TEMPLATE, b).trimEnd();
  const prefix = opts.prefix ? fill(opts.prefix, b).trimEnd() + "\n\n" : "";
  const suffix = opts.conditionText ? "\n\n" + opts.conditionText.trim() : "";
  return prefix + body + suffix;
}

export function emitPrompts(set: BriefSet, conditions: readonly ConditionSpec[], opts: { template?: string; prefix?: string } = {}): PromptLine[] {
  const out: PromptLine[] = [];
  for (const b of set.briefs) {
    for (const c of conditions) {
      out.push({ briefId: b.id, category: b.category, condition: c.name, prompt: renderPrompt(b, { ...opts, conditionText: c.text }) });
    }
  }
  return out;
}
