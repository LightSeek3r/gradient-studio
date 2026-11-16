// @opal42/stylelint-plugin (working name). Rules for the smoothness score of
// CSS gradients: opal42/min-score, opal42/no-finding, opal42/valid-gradient.
// All scoring lives in @opal42/gradient; this package only maps its results to
// stylelint problems and text edits.
import stylelint from "stylelint";
import type { Rule } from "stylelint";
import minScoreRule, { ruleName as minScoreName } from "./rules/min-score";
import noFindingRule, { ruleName as noFindingName } from "./rules/no-finding";
import validGradientRule, { ruleName as validGradientName } from "./rules/valid-gradient";

const { createPlugin } = stylelint;

/** What `createPlugin` returns, with the fields typed (stylelint types it as a union). */
export interface RulePlugin {
  ruleName: string;
  rule: Rule;
}
const plugin = (name: string, rule: Rule) => createPlugin(name, rule) as RulePlugin;

export const minScore = plugin(minScoreName, minScoreRule);
export const noFinding = plugin(noFindingName, noFindingRule);
export const validGradient = plugin(validGradientName, validGradientRule);

/** Rule names, for typed configs. */
export const ruleNames = { minScore: minScoreName, noFinding: noFindingName, validGradient: validGradientName } as const;

// Stylelint loads `plugins: ["@opal42/stylelint-plugin"]` from the default export (an array of plugins).
const plugins: RulePlugin[] = [minScore, noFinding, validGradient];
export default plugins;
