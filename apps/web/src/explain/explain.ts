// ── Plain-language text per finding code ──────────────────────────────────────
// The single source of the words the UI uses for a rule of scoring model v1
// (spec/scoring-v1.md): its short name in the points ledger and one sentence
// on what it measures, plus the message of each severity tier. The words
// live in the catalogues (src/i18n); this module maps a stable `code` to
// their keys, so the interface language never depends on core's English
// `message` strings. `ruleText` defaults to English because apps/vscode reuses it
// for its hover text. tests/explain.test.ts and tests/i18n.test.ts fail when a
// code or tier of the model has no entry.
//
// Wording follows PLAN D5: these describe what the smoothness score measures,
// by our definition. They are not verdicts on a gradient's quality.

import { V1_FINDING_CODES, type Finding } from "@opal42/gradient";
import { hasMessageKey, tEn, type Translate } from "../i18n/translator";

export interface RuleText {
  /** Short lower-case name used in the ledger: "100 − 12 lightness reversal". */
  name: string;
  /** One plain sentence: what the rule measures. */
  measures: string;
}

/** Every finding code of scoring model v1, in rule order. */
export const RULE_CODES: readonly string[] = Object.keys(V1_FINDING_CODES);

/** The text for a code; an unknown code gets a neutral fallback built from the code itself. */
export function ruleText(code: string, t: Translate = tEn): RuleText {
  const name = `rule.${code}.name`;
  const measures = `rule.${code}.measures`;
  if (typeof code === "string" && hasMessageKey(name) && hasMessageKey(measures)) {
    return { name: t(name), measures: t(measures) };
  }
  const tail = typeof code === "string" ? code.split("/").pop()?.replace(/-/g, " ") : "";
  const fallback = { name: t("rule.fallback.name"), measures: t("rule.fallback.measures") };
  return tail ? { ...fallback, name: tail } : fallback;
}

/**
 * The message of a finding in the active language. It is chosen by the stable
 * (code, severity) pair, one per tier of the model; an unknown pair (a newer
 * core than this app) falls back to core's own English `message`.
 */
export function findingMessage(f: Pick<Finding, "code" | "severity" | "message">, t: Translate): string {
  const key = `finding.${f.code}.${f.severity}`;
  if (!hasMessageKey(key)) return f.message;
  // The only tier whose text carries a number: "Lightness fluctuates (2 reversals) …".
  const count = Number(/\((\d+) reversal/.exec(f.message)?.[1] ?? 1);
  return t(key, { count });
}

/** Display budgets of the four dimensions, in ledger order. */
export const DIMENSIONS = [
  { key: "lightness", label: "dim.lightness" },
  { key: "hue", label: "dim.hue" },
  { key: "chroma", label: "dim.chroma" },
  { key: "rhythm", label: "dim.rhythm" },
] as const;

export type DimensionKey = (typeof DIMENSIONS)[number]["key"];

/** English sizes of a deduction, for consumers outside the app (the VS Code hover). */
export const SEVERITY_LABEL: Readonly<Record<"error" | "warning" | "info", string>> = {
  error: tEn("severity.error"),
  warning: tEn("severity.warning"),
  info: tEn("severity.info"),
};

/** Spoken size of a deduction (severity follows the penalty: 12+, 6-10, 5 or fewer). */
export function severityLabel(severity: "error" | "warning" | "info", t: Translate): string {
  return t(`severity.${severity}`);
}
