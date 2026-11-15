// ── Document → CSS, and the colour helpers of the public API ───────────────────

import { complementHex } from "../color-formats";
import { hexToRgb, isValidStopColor } from "../gradient-engine";
import { parseCssColor } from "../css/color";
import { bakeStops, isDocumentLike, stopAlpha } from "./document";
import type { GradientDocument, Interpolation, ToCSSOptions } from "./types";

/** A number with at most `digits` decimals and no trailing zeros (never exponent form, never -0). */
function num(v: number, digits: number): string {
  const s = v.toFixed(digits);
  const trimmed = s.includes(".") ? s.replace(/\.?0+$/, "") : s;
  return trimmed === "-0" ? "0" : trimmed;
}

/** A finite number small enough for `toFixed` to print without an exponent. */
const printable = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e9;

function interpolationClause(i: Interpolation | undefined): string {
  if (!i || (i.space !== "oklab" && i.space !== "oklch")) return "";
  const hue = i.space === "oklch" && (i.hue === "longer" || i.hue === "increasing" || i.hue === "decreasing") ? ` ${i.hue} hue` : "";
  return ` in ${i.space}${hue}`;
}

/**
 * The document as a CSS `linear-gradient()` / `repeating-linear-gradient()`
 * value. Opaque stops print as `#rrggbb`, translucent ones as
 * `rgb(r g b / a)`; positions as percentages (omitted when absent); an
 * `in oklab` / `in oklch [… hue]` clause when the document (or
 * `opts.interpolation`) asks for one. sRGB is the CSS default and prints no
 * clause. Stops are printed in document order. Null for an invalid document.
 */
export function toCSS(doc: GradientDocument, opts?: ToCSSOptions): string | null {
  if (!isDocumentLike(doc) || doc.kind !== "linear" || doc.stops.length === 0) return null;
  if (!printable(doc.angle)) return null;
  const parts: string[] = [];
  for (const s of doc.stops) {
    const alpha = stopAlpha(s);
    if (!isValidStopColor(s.color) || alpha === null) return null;
    let text: string;
    if (alpha < 1) {
      const { r, g, b } = hexToRgb(s.color);
      text = `rgb(${r} ${g} ${b} / ${num(alpha, 4)})`;
    } else {
      text = s.color.toLowerCase();
    }
    if (s.position !== undefined) {
      if (!printable(s.position)) return null;
      text += ` ${num(s.position * 100, 4)}%`;
    }
    parts.push(text);
  }
  const fn = doc.repeating ? "repeating-linear-gradient" : "linear-gradient";
  const clause = interpolationClause(opts?.interpolation ?? doc.interpolation);
  return `${fn}(${num(doc.angle, 4)}deg${clause}, ${parts.join(", ")})`;
}

/**
 * Two declarations for progressive enhancement: first a plain sRGB gradient
 * whose stops are pre-sampled along the target interpolation (so old browsers
 * show nearly the same picture), then the native `in oklab` / `in oklch`
 * gradient, which browsers that understand it use instead. The target space is
 * the document's, or OKLAB when it has none. A document that asks for sRGB
 * needs no fallback and yields one declaration. Null for an invalid document.
 */
export function toCSSWithFallback(doc: GradientDocument, property = "background", steps = 16): string | null {
  const prop = typeof property === "string" && /^-{0,2}[a-zA-Z][a-zA-Z0-9-]*$/.test(property) ? property : "background";
  const plain = toCSS(doc, { interpolation: { space: "srgb" } });
  if (plain === null) return null;
  const target: Interpolation =
    doc.interpolation && (doc.interpolation.space === "oklab" || doc.interpolation.space === "oklch" || doc.interpolation.space === "srgb")
      ? doc.interpolation
      : { space: "oklab" };
  if (target.space === "srgb") return `${prop}: ${plain};`;
  const baked = bakeStops(doc, steps, { interpolation: target });
  const fallback = toCSS({ ...doc, stops: baked }, { interpolation: { space: "srgb" } });
  const native = toCSS(doc, { interpolation: target });
  if (fallback === null || native === null) return null;
  return `${prop}: ${fallback};\n${prop}: ${native};`;
}

/**
 * The complement of a CSS colour (any syntax the parser supports), as
 * `#rrggbb`: opposite OKLCH hue at the same lightness and chroma, gamut-mapped;
 * near-greys mirror lightness instead. Alpha is ignored. Null when `color` is
 * not a supported colour.
 */
export function complement(color: string): string | null {
  const parsed = parseCssColor(color);
  return parsed ? complementHex(parsed.color) : null;
}
