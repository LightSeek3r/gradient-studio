// ── Pure analysis: CSS text in, a plain result out ─────────────────────────────
// No DOM, no timers, no globals: this module is what the elements render, and it
// can run on a server. All scoring is @opal42/gradient's; nothing here judges a
// gradient. Everything that later reaches a `style` property is rebuilt from the
// parsed document (`toCSS`) and then matched against a strict allow-list, never
// copied from the input.

import {
  parseGradient,
  proposeFixes,
  type Fix,
  refine,
  scoreParsed,
  toCSS,
  toCSSWithFallback,
  type GradientDocument,
  type ParsedGradient,
} from "@opal42/gradient";

/** Longest input read, in UTF-16 code units (20 KB). Longer text is cut and flagged. */
export const MAX_INPUT_LENGTH = 20 * 1024;

export type ElementStatus = "ok" | "skipped" | "empty" | "invalid";

export interface ElementFinding {
  /** Stable v1 finding code, e.g. `lightness/reversal`. */
  code: string;
  severity: "error" | "warning" | "info";
  dimension: "lightness" | "chroma" | "hue" | "spacing";
  /** The rule's nominal penalty, in points. */
  pointsLost: number;
  /** Core's English message; the element shows its own text table instead. */
  message: string;
}

export interface ElementFix {
  code: string;
  label: string;
  /** Points gained: `after - before`, always > 0. */
  gain: number;
  before: number;
  after: number;
  /** The fixed gradient, rebuilt by core and allow-list checked. */
  css: string;
  /** Allow-list checked background values for the swatch of the fix. */
  swatch: string[];
}

export interface ElementResult {
  status: ElementStatus;
  /** Integer 0-100 when `status` is `ok`, otherwise null. */
  score: number | null;
  findings: ElementFinding[];
  /** Gradient functions found in the (possibly truncated) text. */
  gradients: number;
  /** Which of them is shown (0-based), or -1 when none is. */
  index: number;
  /** The input was longer than `MAX_INPUT_LENGTH` and was cut. */
  truncated: boolean;
  /** The shown gradient normalised by core's `toCSS`; null when it could not be parsed. */
  css: string | null;
  /** Validated `#rrggbb` stop colours of the shown gradient. */
  stops: string[];
  /** Allow-list checked `background-image` values, fallback first. Empty when there is nothing to paint. */
  swatch: string[];
  skipped: { code: string; reason: string } | null;
  invalid: { code: string; message: string; index?: number } | null;
  fix: ElementFix | null;
}

export interface AnalyzeOptions {
  /** 0-based gradient to show; default the first scorable one (else the first). */
  index?: number | null;
  /** Also compute the best `proposeFixes` suggestion. */
  withFix?: boolean;
}

// toCSS emits only: a fixed function name, a number of degrees, an optional
// `in <space> [<hue> hue]` clause, and stops of `#rrggbb` or `rgb(r g b / a)`
// with an optional percentage. Anything else is dropped.
const NUM = "-?[0-9]{1,12}(?:\\.[0-9]{1,12})?(?:e-?[0-9]{1,2})?";
const STOP = `(?:#[0-9a-f]{6}|rgb\\([0-9]{1,3} [0-9]{1,3} [0-9]{1,3} / ${NUM}\\))(?: ${NUM}%)?`;
const SAFE_GRADIENT = new RegExp(
  `^(?:repeating-)?linear-gradient\\(${NUM}deg(?: in (?:oklab|oklch)(?: (?:shorter|longer|increasing|decreasing) hue)?)?(?:, ${STOP})+\\)$`,
);

/** True for a gradient string that matches the allow-list. Exported for tests. */
export function isSafeGradient(css: unknown): css is string {
  return typeof css === "string" && css.length < 4000 && SAFE_GRADIENT.test(css);
}

/**
 * `background-image` values for a swatch: the gradient exactly as the CSS asks
 * for it. A gradient that interpolates in OKLAB/OKLCH gets a pre-sampled sRGB
 * fallback first, then the native value (browsers that cannot parse the native
 * one keep the fallback). Plain sRGB gradients are one value. All allow-list checked.
 */
export function swatchBackgrounds(doc: GradientDocument): string[] {
  const native = toCSS(doc);
  if (native === null || !isSafeGradient(native)) return [];
  const space = doc.interpolation?.space ?? "srgb";
  if (space === "srgb") return [native];
  const decls = toCSSWithFallback(doc, "background-image");
  if (decls === null) return [];
  const out: string[] = [];
  for (const line of decls.split("\n")) {
    const m = /^background-image: (.*);$/.exec(line);
    if (!m || !isSafeGradient(m[1])) return [];
    out.push(m[1]);
  }
  return out;
}

const HEX = /^#[0-9a-f]{6}$/;

function blank(partial: Partial<ElementResult>): ElementResult {
  return {
    status: "empty",
    score: null,
    findings: [],
    gradients: 0,
    index: -1,
    truncated: false,
    css: null,
    stops: [],
    swatch: [],
    skipped: null,
    invalid: null,
    fix: null,
    ...partial,
  };
}

/** Reads `text` up to the cap. */
function clip(text: unknown): { text: string; truncated: boolean } {
  const s = typeof text === "string" ? text : text == null ? "" : String(text);
  return s.length > MAX_INPUT_LENGTH ? { text: s.slice(0, MAX_INPUT_LENGTH), truncated: true } : { text: s, truncated: false };
}

function pick(gradients: ParsedGradient[], index: number | null | undefined): number {
  if (index !== null && index !== undefined) return Number.isInteger(index) ? index : -2;
  const scorable = gradients.findIndex((g) => g.document && scoreParsed(g).status === "ok");
  return scorable >= 0 ? scorable : 0;
}

function shortReason(reason: string): string {
  const flat = Array.from(reason, (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("");
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
}

/**
 * Scores the gradient `opts.index` of `text` (default: the first scorable one).
 * Never throws: failures are `status: "invalid"` with a code.
 */
export function analyzeCss(text: unknown, opts: AnalyzeOptions = {}): ElementResult {
  const { text: input, truncated } = clip(text);
  try {
    if (input.trim() === "") return blank({ status: "empty", truncated });
    const { gradients } = parseGradient(input, { maxInputLength: MAX_INPUT_LENGTH, maxLength: MAX_INPUT_LENGTH });
    if (gradients.length === 0) {
      return blank({ status: "invalid", truncated, invalid: { code: "no-gradient", message: "no gradient found" } });
    }
    const index = pick(gradients, opts.index);
    const chosen = gradients[index];
    if (!chosen) {
      return blank({
        status: "invalid",
        truncated,
        gradients: gradients.length,
        invalid: { code: "index-out-of-range", message: `no gradient at index ${String(opts.index)}`, index: Number(opts.index) },
      });
    }
    const doc = chosen.document;
    const css = doc ? toCSS(doc) : null;
    const safe = css !== null && isSafeGradient(css);
    const base = {
      truncated,
      gradients: gradients.length,
      index,
      css: safe ? css : null,
      stops: doc && safe ? doc.stops.map((s) => s.color).filter((c) => HEX.test(c)) : [],
      swatch: doc && safe ? swatchBackgrounds(doc) : [],
    };
    const result = scoreParsed(chosen);
    if (result.status !== "ok") {
      return blank({
        ...base,
        status: "skipped",
        skipped: { code: String(result.code), reason: shortReason(result.reason) },
      });
    }
    const findings: ElementFinding[] = result.issues.map((i) => ({
      code: i.code,
      severity: i.severity,
      dimension: i.dimension,
      pointsLost: i.pointsLost,
      message: i.message,
    }));
    let fix: ElementFix | null = null;
    if (opts.withFix && doc) fix = bestFix(doc);
    return blank({ ...base, status: "ok", score: result.score, findings, fix });
  } catch {
    return blank({ status: "invalid", truncated, invalid: { code: "internal", message: "analysis failed" } });
  }
}

function bestFix(doc: GradientDocument): ElementFix | null {
  let best: Fix | null = null;
  for (const f of proposeFixes(doc)) if (best === null || f.gain > best.gain) best = f;
  if (!best || best.before.status !== "ok" || best.after.status !== "ok") return null;
  const css = toCSS(best.document);
  if (!isSafeGradient(css)) return null;
  return {
    code: best.code,
    label: shortReason(best.label),
    gain: best.gain,
    before: best.before.score,
    after: best.after.score,
    css,
    swatch: swatchBackgrounds(best.document),
  };
}

/**
 * The one-click refinement of the gradient `index` of `text` as CSS, or null
 * when there is no scorable gradient. When the refiner declines (it never
 * lowers a score) the gradient's own normalised CSS comes back unchanged.
 */
export function refineCss(text: unknown, index?: number | null): string | null {
  try {
    const { text: input } = clip(text);
    const { gradients } = parseGradient(input, { maxInputLength: MAX_INPUT_LENGTH, maxLength: MAX_INPUT_LENGTH });
    const i = pick(gradients, index);
    const doc = gradients[i]?.document;
    if (!doc || scoreParsed(gradients[i]).status !== "ok") return null;
    const out = refine(doc);
    const css = toCSS(out.document);
    return isSafeGradient(css) ? css : null;
  } catch {
    return null;
  }
}
