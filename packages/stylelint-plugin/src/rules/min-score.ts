import stylelint from "stylelint";
import type { Rule } from "stylelint";
import { currentValueText, judge, locate, parseValue, setValueText } from "../analyze";
import { planFix } from "../fix";
import { readOptions, sharedPossible } from "../options";
import { DOCS, NAMESPACE, eachValueNode } from "./shared";

const { report, ruleMessages, validateOptions } = stylelint.utils;

export const ruleName = `${NAMESPACE}/min-score`;

export const messages = ruleMessages(ruleName, {
  below: (score: number, min: number, detail: string) =>
    `Gradient smoothness score ${score} is below the minimum ${min}${detail}`,
  unscorable: (code: string, reason: string) => `Gradient was not scored (${code}: ${reason})`,
});

const isScore = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;

const meta = { url: `${DOCS}#opal42min-score`, fixable: true };

const rule: Rule = (primary, secondary) => (root, result) => {
  const valid = validateOptions(
    result,
    ruleName,
    // A predicate is valid for stylelint's validateOptions; its types only list arrays/objects.
    { actual: primary, possible: isScore as unknown as never },
    { actual: secondary, possible: sharedPossible, optional: true },
  );
  if (!valid) return;
  const min = primary as number;
  const o = readOptions(secondary);

  eachValueNode(root, o.properties, (node) => {
    const parsed = parseValue(node);
    if (!parsed) return;
    const { slot, gradients } = parsed;
    // The fix is only offered when the value holds a single gradient.
    const single = gradients.length === 1;

    for (const g of gradients) {
      const { verdict } = judge(g, o);
      const loc = locate(slot, g.range);
      const where = loc ?? {};

      if (verdict.kind === "unscorable") {
        report({ result, ruleName, node, message: messages.unscorable, messageArgs: [verdict.code, verdict.reason], ...where });
        continue;
      }
      if (verdict.kind !== "scored" || verdict.result.score >= min) continue;

      const top = [...verdict.result.issues]
        .sort((a, b) => b.pointsLost - a.pointsLost)
        .slice(0, 3)
        .map((i) => `${i.code} -${i.pointsLost}`);
      const detail = top.length ? `; largest deductions: ${top.join(", ")}` : "";

      const plan = single && !verdict.alphaIgnored ? planFix(slot.text, { kind: "min", min }) : null;
      report({
        result,
        ruleName,
        node,
        message: messages.below,
        messageArgs: [verdict.result.score, min, detail],
        ...where,
        fix: plan
          ? {
              node,
              apply: () => {
                if (currentValueText(slot) === plan.before) setValueText(slot, plan.text);
              },
            }
          : undefined,
      });
    }
  });
};

rule.ruleName = ruleName;
rule.messages = messages;
rule.meta = meta;

export default rule;
