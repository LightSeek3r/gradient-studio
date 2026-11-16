import stylelint from "stylelint";
import type { Rule } from "stylelint";
import { V1_FINDING_CODES } from "@opal42/gradient";
import { currentValueText, judge, locate, parseValue, setValueText } from "../analyze";
import { planFix } from "../fix";
import { readOptions, sharedPossible } from "../options";
import { DOCS, NAMESPACE, eachValueNode } from "./shared";

const { report, ruleMessages, validateOptions } = stylelint.utils;

export const ruleName = `${NAMESPACE}/no-finding`;

export const messages = ruleMessages(ruleName, {
  found: (code: string, points: number, message: string) => `Unexpected smoothness finding ${code} (-${points} points): ${message}`,
});

const knownCode = (v: unknown): boolean => typeof v === "string" && Object.hasOwn(V1_FINDING_CODES, v);

const meta = { url: `${DOCS}#opal42no-finding`, fixable: true };

// `no-finding` has no unscorable report, so `ignoreUnscorable` does not apply.
const possible = { skipHardStops: sharedPossible.skipHardStops, skipAlpha: sharedPossible.skipAlpha, properties: sharedPossible.properties };

const rule: Rule = (primary, secondary) => (root, result) => {
  const valid = validateOptions(
    result,
    ruleName,
    { actual: primary, possible: [knownCode] },
    { actual: secondary, possible, optional: true },
  );
  if (!valid) return;
  const codes = new Set([primary].flat().filter((c): c is string => typeof c === "string"));
  if (codes.size === 0) return;
  const o = readOptions(secondary);

  eachValueNode(root, o.properties, (node) => {
    const parsed = parseValue(node);
    if (!parsed) return;
    const { slot, gradients } = parsed;
    const single = gradients.length === 1;

    for (const g of gradients) {
      const { verdict } = judge(g, o);
      if (verdict.kind !== "scored") continue;
      const hits = verdict.result.issues.filter((i) => codes.has(i.code));
      if (hits.length === 0) continue;

      const plan = single && !verdict.alphaIgnored ? planFix(slot.text, { kind: "codes", codes }) : null;
      const fixable = (code: string) => plan !== null && plan.resolvedCodes.includes(code);
      const apply = () => {
        if (plan && currentValueText(slot) === plan.before) setValueText(slot, plan.text);
      };
      // Source order. Positions come from the original input text, which fixes
      // never change, so applying a fix in the middle does not move later ones.
      const ordered = [...hits].sort((x, y) => (x.range?.start ?? g.range.start) - (y.range?.start ?? g.range.start));
      for (const issue of ordered) {
        const loc = locate(slot, issue.range ?? g.range);
        report({
          result,
          ruleName,
          node,
          message: messages.found,
          messageArgs: [issue.code, issue.pointsLost, issue.message],
          ...(loc ?? {}),
          fix: fixable(issue.code) ? { node, apply } : undefined,
        });
      }
    }
  });
};

rule.ruleName = ruleName;
rule.messages = messages;
rule.meta = meta;
rule.primaryOptionArray = true;

export default rule;
