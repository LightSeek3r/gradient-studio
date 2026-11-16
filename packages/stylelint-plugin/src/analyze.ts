// Find the gradients in a declaration and map their source offsets to
// positions stylelint understands.
//
// `report({ node, index, endIndex })` is resolved by postcss'
// `node.rangeBy`, which counts `index` characters through the *original input
// text* starting at the node's start offset (not through `node.toString()`).
// The parser works on the value as written in the source, so
//
//     index = offset of the value from the node start + offset in the value
//
// The value is located in the input text and verified there (a comment that
// postcss-scss rewrites from `// x` to `/* x*/` would otherwise shift every
// position after it). If it cannot be located, problems are reported on the
// whole node instead of a wrong place.

import { parseGradient, scoreParsed, type GradientDocument, type ParsedGradient, type ScoreResult } from "@opal42/gradient";
import type { Rule } from "stylelint";
import type { SharedOptions } from "./options";

// postcss types come from stylelint's own postcss (the one that creates the
// nodes), not from a second copy in this package's dependency tree.
export type Root = Parameters<ReturnType<Rule>>[0];
type Walk = Parameters<Root["walk"]>[0];
export type Node = Parameters<Walk>[0];
export type Declaration = Parameters<Parameters<Root["walkDecls"]>[0]>[0];
export type AtRule = Parameters<Parameters<Root["walkAtRules"]>[0]>[0];

/** A node whose value text is scanned: a declaration, or a Less `@var: value` at-rule. */
export type ValueNode = Declaration | AtRule;

/** Which stored copy of the value the scanned text came from. */
export type SlotKind = "value" | "raw" | "scss";

export interface ValueSlot {
  node: ValueNode;
  /** The value as written in the source (comments included). */
  text: string;
  kind: SlotKind;
  /**
   * Offset of `text` from the start of the node in the *original source*, or
   * null when it could not be located. This is the base postcss'
   * `positionInside`/`rangeBy` (and so stylelint's `report({ index })`) count
   * from: they walk the input text, not `node.toString()`.
   */
  base: number | null;
  /** The property or variable name. */
  prop: string;
}

const GRADIENT_HINT = /gradient\(/i;

const isDecl = (n: Node): n is Declaration => n.type === "decl";
const isLessVariable = (n: Node): n is AtRule => n.type === "atrule" && (n as AtRule & { variable?: boolean }).variable === true;

export function isValueNode(n: Node): n is ValueNode {
  return isDecl(n) || isLessVariable(n);
}

function charCount(parts: unknown[]): number {
  let n = 0;
  for (const p of parts) if (typeof p === "string") n += p.length;
  return n;
}

/** The text before a declaration's value (stylelint's declarationValueIndex). */
function declarationValueIndex(decl: Declaration): number {
  const raws = decl.raws as Record<string, unknown>;
  const prop = raws.prop as { prefix?: string; raw?: string; suffix?: string } | undefined;
  const value = raws.value as { prefix?: string } | undefined;
  const hasProp = typeof prop === "object" && prop !== null;
  return charCount([hasProp ? prop.prefix : "", (hasProp && prop.raw) || decl.prop, hasProp ? prop.suffix : "", (raws.between as string | undefined) || ":", value?.prefix]);
}

interface Candidate {
  kind: SlotKind;
  text: string;
}

/** The stored copies of a node's value, the one closest to the source first. */
function candidates(node: ValueNode): Candidate[] {
  const out: Candidate[] = [];
  if (isDecl(node)) {
    const raw = (node.raws as { value?: { raw?: unknown; scss?: unknown } }).value;
    if (raw && typeof raw.scss === "string") out.push({ kind: "scss", text: raw.scss });
    if (raw && typeof raw.raw === "string") out.push({ kind: "raw", text: raw.raw });
    out.push({ kind: "value", text: node.value });
  } else {
    const v = (node as AtRule & { value?: unknown }).value;
    if (typeof v === "string") out.push({ kind: "value", text: v });
  }
  return out;
}

/** The offset postcss counts from: the node's start in the input text. */
function sourceStart(node: ValueNode): { css: string; start: number; end: number } | null {
  const src = node.source;
  const input = src?.input as { css?: string; document?: string } | undefined;
  const css = input ? (typeof input.document === "string" ? input.document : input.css) : undefined;
  const start = src?.start?.offset;
  if (typeof css !== "string" || typeof start !== "number") return null;
  const endOffset = src?.end?.offset;
  return { css, start, end: typeof endOffset === "number" ? endOffset + 1 : css.length };
}

/**
 * The value text of a node, with its position in the source. Null when the
 * value has no gradient function (cheap pre-check, so most declarations cost
 * a regex test).
 */
export function valueSlot(node: ValueNode): ValueSlot | null {
  const prop = isDecl(node) ? node.prop : `@${node.name}`;
  const cands = candidates(node).filter((c) => typeof c.text === "string" && GRADIENT_HINT.test(c.text));
  if (cands.length === 0) return null;
  const where = sourceStart(node);
  if (where) {
    const guess = isDecl(node) ? declarationValueIndex(node) : -1;
    for (const c of cands) {
      let at = guess >= 0 && where.css.startsWith(c.text, where.start + guess) ? where.start + guess : -1;
      if (at < 0) at = where.css.indexOf(c.text, where.start + (isDecl(node) ? node.prop.length : 0));
      if (at >= 0 && at + c.text.length <= where.end) return { node, text: c.text, kind: c.kind, base: at - where.start, prop };
    }
  }
  // Not locatable in the source: scan the stored value, report on the whole node.
  return { node, text: cands[0].text, kind: cands[0].kind, base: null, prop };
}

/** The current text of the copy a slot was read from. */
export function currentValueText(slot: ValueSlot): string | null {
  return candidates(slot.node).find((c) => c.kind === slot.kind)?.text ?? null;
}

// An inline `// note` comment becomes a block comment in the raw copy postcss-scss keeps.
const scssToRaw = (text: string) => text.replace(/(?<!:)\/\/([^\n]*)/g, "/*$1*/");

/**
 * Replace the value with `text`, the way stylelint's own fixers do: a
 * declaration whose value has comments keeps its cleaned `value` and only the
 * raw copy is changed, so the comments survive and the stringifier prints it.
 */
export function setValueText(slot: ValueSlot, text: string): void {
  const node = slot.node;
  if (!isDecl(node)) {
    (node as AtRule & { value: string }).value = text;
    return;
  }
  const raws = node.raws as { value?: { value: string; raw: string; scss?: string } };
  if (slot.kind === "scss" && raws.value) {
    raws.value.scss = text;
    raws.value.raw = scssToRaw(text);
  } else if (slot.kind === "raw" && raws.value) {
    raws.value.raw = text;
  } else {
    node.value = text;
  }
}

export interface ParsedValue {
  slot: ValueSlot;
  gradients: ParsedGradient[];
}

/**
 * Start offsets that lie inside a quoted string of the value. The parser also
 * finds gradients in strings (JS, HTML attributes); in a stylesheet value such
 * text (`content: "linear-gradient(...)"`) is not a gradient.
 */
function stringSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (c === "/" && text[i + 1] === "/" && text[i - 1] !== ":") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end + 1;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      spans.push([i + 1, Math.min(j, text.length)]);
      i = j + 1;
    } else if (c === "\\") {
      i += 2;
    } else {
      i++;
    }
  }
  return spans;
}

/** Parse the gradients in a node's value. Null when it has none. */
export function parseValue(node: ValueNode): ParsedValue | null {
  const slot = valueSlot(node);
  if (!slot) return null;
  let { gradients } = parseGradient(slot.text);
  if (gradients.length > 0 && /["']/.test(slot.text)) {
    const spans = stringSpans(slot.text);
    gradients = gradients.filter((g) => !spans.some(([a, b]) => g.range.start >= a && g.range.start < b));
  }
  if (gradients.length === 0) return null;
  return { slot, gradients };
}

export interface Judged {
  parsed: ParsedGradient;
  /** What the rules should look at. */
  verdict:
    | { kind: "scored"; result: Extract<ScoreResult, { status: "ok" }>; alphaIgnored: boolean }
    | { kind: "unscorable"; code: string; reason: string }
    | { kind: "skipped"; why: "unscorable" | "alpha" | "hard-stops"; code?: string };
}

const hasAlpha = (doc: GradientDocument) => doc.stops.some((s) => s.alpha !== undefined && s.alpha < 1);

/** Score one parsed gradient under the rule options. */
export function judge(parsed: ParsedGradient, opts: Pick<SharedOptions, "ignoreUnscorable" | "skipHardStops" | "skipAlpha">): Judged {
  let target = parsed;
  let alphaIgnored = false;
  if (parsed.document && !opts.skipAlpha && hasAlpha(parsed.document)) {
    // Score the colour channels only (documented): translucent stops are read as opaque.
    target = { ...parsed, document: { ...parsed.document, stops: parsed.document.stops.map((s) => ({ color: s.color, position: s.position, id: s.id })) } };
    alphaIgnored = true;
  }
  const result = scoreParsed(target);
  if (result.status === "ok") {
    if (opts.skipHardStops && result.analysis.hasHardStops) return { parsed, verdict: { kind: "skipped", why: "hard-stops" } };
    return { parsed, verdict: { kind: "scored", result, alphaIgnored } };
  }
  if (result.code === "alpha" && opts.skipAlpha) return { parsed, verdict: { kind: "skipped", why: "alpha", code: result.code } };
  if (opts.ignoreUnscorable) return { parsed, verdict: { kind: "skipped", why: "unscorable", code: result.code } };
  return { parsed, verdict: { kind: "unscorable", code: result.code, reason: result.reason } };
}

export interface Located {
  index: number;
  endIndex: number;
}

/** Offsets of a range of the value, counted from the node start in the source, or null when unmapped. */
export function locate(slot: ValueSlot, range: { start: number; end: number }): Located | null {
  if (slot.base === null) return null;
  return { index: slot.base + range.start, endIndex: slot.base + range.end };
}
