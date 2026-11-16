import { isValueNode, type Root, type ValueNode } from "../analyze";
import { propertyMatches, type PropertyPattern } from "../options";

export const NAMESPACE = "opal42";
export const DOCS = "https://github.com/LightSeek3r/gradient-studio/blob/master/docs/stylelint.md";

const propOf = (node: ValueNode): string => (node.type === "decl" ? node.prop : `@${node.name}`);

/**
 * Visit every declaration (and Less `@var: value` at-rule) whose property passes
 * the filter. Walks nested rules and at-rules (`@media`, `@supports`, nesting).
 */
export function eachValueNode(root: Root, properties: PropertyPattern[] | null, visit: (node: ValueNode) => void): void {
  root.walk((node) => {
    if (!isValueNode(node)) return;
    if (!propertyMatches(propOf(node), properties)) return;
    visit(node);
  });
}
