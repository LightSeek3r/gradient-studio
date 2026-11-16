import stylelint from "stylelint";
import type { Rule } from "stylelint";
import { locate, parseValue } from "../analyze";
import { isPatternValue, readOptions } from "../options";
import { DOCS, NAMESPACE, eachValueNode } from "./shared";

const { report, ruleMessages, validateOptions } = stylelint.utils;

export const ruleName = `${NAMESPACE}/valid-gradient`;

export const messages = ruleMessages(ruleName, {
  invalid: (code: string, reason: string) => `Invalid gradient (${code}): ${reason}`,
});

/** The only skip codes this rule reports: the ones the author can fix. Everything else is a limit of the scorer, not a mistake. */
const REPORTED = new Set(["unbalanced", "syntax"]);

const meta = { url: `${DOCS}#opal42valid-gradient`, fixable: false };

const rule: Rule = (primary, secondary) => (root, result) => {
  const valid = validateOptions(
    result,
    ruleName,
    { actual: primary, possible: [true] },
    { actual: secondary, possible: { properties: [isPatternValue] }, optional: true },
  );
  if (!valid) return;
  const o = readOptions(secondary);

  eachValueNode(root, o.properties, (node) => {
    const parsed = parseValue(node);
    if (!parsed) return;
    for (const g of parsed.gradients) {
      if (!g.skipped || !REPORTED.has(g.skipped.code)) continue;
      const loc = locate(parsed.slot, g.range);
      report({
        result,
        ruleName,
        node,
        message: messages.invalid,
        messageArgs: [g.skipped.code, g.skipped.reason],
        ...(loc ?? {}),
      });
    }
  });
};

rule.ruleName = ruleName;
rule.messages = messages;
rule.meta = meta;

export default rule;
