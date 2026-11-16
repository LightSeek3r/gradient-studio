// Plain-language reasons a gradient is listed but not scored. Keyed by the
// parser's skip codes (spec/parser.md) and the scorer's unscorable codes
// (spec/api.md). tests/reasons.test.ts checks every code of both tables is here.
//
// Neutral wording: "not scored" says what the model cannot judge, never that
// the gradient is wrong.

import type { SkipCode, UnscorableCode } from "@opal42/gradient";

export const REASON_TEXT: Readonly<Record<SkipCode | UnscorableCode, string>> = {
  // Parser skip codes
  "legacy-syntax": "Vendor-prefixed or -webkit-gradient() syntax: angles and keywords mean something different, so it is not read.",
  "unsupported-kind": "Radial and conic gradients are shown but not scored: the smoothness score covers linear gradients.",
  var: "Uses var(), whose value is not in the text. Where the variable resolves, the computed gradient on the element is scored instead.",
  calc: "Uses calc() or another math function, so a position or colour is not a fixed value.",
  env: "Uses env(), whose value depends on the device.",
  currentColor: "Uses currentColor, which takes its value from the element.",
  "color-mix": "Uses color-mix(), which the parser does not evaluate.",
  "relative-color": "Uses relative colour syntax, which the parser does not evaluate.",
  "lab-lch": "Uses lab() or lch(): wide-gamut colours the v1 model cannot judge.",
  "color-function": "Uses color(): a wide-gamut or custom colour space the v1 model cannot judge.",
  "system-color": "Uses a system colour, which depends on the user's theme.",
  "unknown-color": "Contains a colour the parser does not recognise.",
  "length-position": "A stop position is a length (px, em …), which depends on the box size.",
  "too-many-stops": "More colour stops than the parser reads (32).",
  "interpolation-space": "Interpolates in a colour space the document model cannot express (only srgb, oklab and oklch).",
  preprocessor: "Contains a preprocessor or template expression, not plain CSS.",
  syntax: "Not a linear gradient the parser fully understands.",
  unbalanced: "The gradient is not closed.",
  "too-long": "The gradient text is longer than the panel reads.",
  "too-deep": "Nested more deeply than the parser reads.",
  // Scorer (unscorable) codes
  "invalid-document": "Could not be turned into a gradient document.",
  "unsupported-model": "Asked for a scoring model that does not exist.",
  repeating: "Repeating gradients are not scored by the v1 model.",
  "too-few-stops": "Fewer than two colour stops: nothing to compare.",
  "invalid-color": "A stop colour could not be read.",
  "invalid-alpha": "A stop opacity could not be read.",
  alpha: "Has translucent stops. The v1 model judges opaque stops only, so overlays and fades are not scored.",
  "invalid-position": "A stop position could not be read.",
  "position-range": "A stop position falls outside 0–100%.",
  engine: "The scorer could not handle this input.",
};

export function reasonText(code: string): string {
  return Object.prototype.hasOwnProperty.call(REASON_TEXT, code) ? REASON_TEXT[code as SkipCode] : "Not scored.";
}

/** Plain text for the parser's non-fatal warnings (spec/parser.md "Warnings"). */
export const WARNING_TEXT: Readonly<Record<string, string>> = {
  "color-hint-ignored": "Has a colour hint (transition midpoint). The score and the copied CSS ignore hints.",
  "corner-angle": "Uses a corner keyword (to top left …): the real angle depends on the box, so a square box is assumed.",
  "position-out-of-range": "Has a stop outside 0–100%.",
  "gamut-mapped": "A colour is outside the sRGB range and was reduced to fit it; the score may differ from the rendering.",
};

export function warningText(code: string): string {
  return Object.prototype.hasOwnProperty.call(WARNING_TEXT, code) ? WARNING_TEXT[code] : "";
}
