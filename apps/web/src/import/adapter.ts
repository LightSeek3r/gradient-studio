// ── CSS import adapter: core `parseGradient` -> what the editor can hold ──────
// The parser itself lives in @opal42/gradient (spec/parser.md). This file is
// the thin, app-specific layer on top of it:
//
//   * pick the first gradient in the pasted text (a declaration, a whole rule,
//     a multi-layer shorthand) and say when other layers were left out;
//   * turn core's skip codes into messages a person can act on, in the
//     active language (core's `reason` strings are English: they are matched
//     to catalogue keys, and an unknown reason is shown as core wrote it);
//   * apply what the editor's document cannot express, always with a warning
//     that says what changed: opaque stops only, 0-100% stop range, integer
//     CSS-degree angle, sRGB interpolation, at most MAX_STOPS stops.
//
// Rule of the house (unchanged): never a silent wrong colour. Pure and
// DOM-free. Never throws.

import {
  hexToRgb,
  parseGradient,
  resolveStops,
  rgbToHex,
  type GradientDocument,
  type ParsedGradient,
  type SkipCode,
} from "@opal42/gradient";
import type { Translate } from "../i18n/translator";
import { MAX_STOPS } from "../state/document";

export interface ImportedStop {
  color: string; // #rrggbb
  position: number; // 0-100, at most 2 decimals
}

export interface ImportedGradient {
  stops: ImportedStop[];
  /** CSS degrees, integer in [0, 360). */
  angle: number;
}

/** Messages are produced through `t`, so errors and warnings read in the active language. */
export type ParseResult =
  | { ok: true; gradient: ImportedGradient; warnings: string[] }
  | { ok: false; error: string; warnings: string[] };

/** Longest paste treated as a gradient at all (a guard, not a parser limit). */
const MAX_INPUT = 10_000;

// Core's own stop cap (32) would hide the editor's. Let core return every stop
// and apply MAX_STOPS here, so the error can name the real count.
const CORE_OPTIONS = { maxStops: Number.MAX_SAFE_INTEGER, maxInputLength: MAX_INPUT } as const;

/** Cheap pre-check: is this text worth offering as a gradient import? */
export function looksLikeGradient(text: string): boolean {
  return /gradient\s*\(/i.test(text);
}

function fail(error: string, warnings: string[] = []): ParseResult {
  return { ok: false, error, warnings };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
/** Kills float noise from `p / 100 * 100` before positions are compared. */
const clean = (n: number): number => Math.round(n * 1e6) / 1e6;

// ── Skip codes -> messages ────────────────────────────────────────────────────

/** "Stop 2 uses calc()" etc: core's reason, first letter capitalised (only for reasons we cannot place). */
const sentence = (reason: string): string =>
  /^[a-z-]+\(/.test(reason) ? reason : reason.charAt(0).toUpperCase() + reason.slice(1);

/**
 * The reason core gives for a `syntax` skip, in the active language. Core's
 * reasons are fixed English phrases (some with a value); an unknown one is
 * returned unchanged.
 */
export function syntaxReason(reason: string, t: Translate): string {
  const rules: [RegExp, (m: RegExpExecArray) => string][] = [
    [/^the gradient direction is not an angle$/, () => t("import.reason.notAngle")],
    [/^'to' must be followed by a side$/, () => t("import.reason.toSide")],
    [/^'to (.+)' is not a corner$/, (m) => t("import.reason.notCorner", { sides: m[1] })],
    [/^'in' must be followed by a colour space$/, () => t("import.reason.inSpace")],
    [/^'(.+)' is not a colour space$/, (m) => t("import.reason.notSpace", { name: m[1] })],
    [/^malformed hue interpolation method$/, () => t("import.reason.hueMethod")],
    [/^malformed gradient direction$/, () => t("import.reason.direction")],
    [/^malformed number$/, () => t("import.reason.number")],
    [/^stop position (.+) has no unit$/, (m) => t("import.reason.noUnit", { value: m[1] })],
    [/^'(.+)' is not a position unit$/, (m) => t("import.reason.badUnit", { unit: m[1] })],
    [/^a gradient cannot contain another gradient$/, () => t("import.reason.nested")],
    [/^empty argument$/, () => t("import.reason.emptyArg")],
    [/^a colour hint must sit between two colour stops$/, () => t("import.reason.hintPlace")],
    [/^a colour stop is a colour and at most two positions$/, () => t("import.reason.stopShape")],
    [/^no colour stops$/, () => t("import.reason.noStops")],
  ];
  for (const [re, render] of rules) {
    const m = re.exec(reason);
    if (m) return render(m);
  }
  return reason;
}

/** Why a colour was not recognised, from core's `unknown-color` reason. */
function unknownColorMessage(reason: string, t: Translate): string {
  let m: RegExpExecArray | null;
  if ((m = /^(.+) is not a colour$/.exec(reason))) return t("import.err.notColour", { what: m[1] });
  if ((m = /^(#\w*) is not (?:a hex colour|a 3, 4, 6 or 8 digit hex colour)$/.exec(reason))) {
    return t("import.err.badHex", { what: m[1] });
  }
  if ((m = /^malformed ([a-z-]+)\(\)$/.exec(reason))) return t("import.err.malformedFn", { fn: m[1] });
  if ((m = /^([a-z-]+)\(\) is not (?:a supported colour function|supported)$/.exec(reason))) {
    return t("import.err.unsupportedFn", { fn: m[1] });
  }
  return t("import.err.unknownColor", { reason: sentence(reason) });
}

function skipMessage(g: ParsedGradient, code: SkipCode, reason: string, t: Translate): string {
  const pasteResolved = t("import.hint.pasteResolved");
  const plainColours = t("import.hint.plainColours");
  switch (code) {
    case "legacy-syntax":
      return t("import.err.legacy");
    case "unsupported-kind":
      return t(g.kind === "radial" ? "import.err.radial" : "import.err.conic");
    case "var":
      return `${t("import.err.var")} ${pasteResolved}`;
    case "calc":
      return `${t("import.err.calc")} ${pasteResolved}`;
    case "env":
      return `${t("import.err.env")} ${pasteResolved}`;
    case "currentColor":
      return `${t("import.err.currentColor")} ${pasteResolved}`;
    case "system-color":
      return `${t("import.err.systemColor", { name: /('[^']+')/.exec(reason)?.[1] ?? "?" })} ${pasteResolved}`;
    case "color-mix":
      return `${t("import.err.colorMix")} ${plainColours}`;
    case "relative-color":
      return `${t("import.err.relativeColor")} ${plainColours}`;
    case "lab-lch":
    case "color-function":
      return `${t("import.err.wideColour", { fn: /^[a-z-]+/.exec(reason)?.[0] ?? "color" })} ${plainColours}`;
    case "unknown-color":
      return unknownColorMessage(reason, t);
    case "length-position":
      return t("import.err.lengthPosition", { unit: / in ([a-z]+)/i.exec(reason)?.[1] ?? "length" });
    case "interpolation-space": {
      const space = /^interpolation in (.+) is not supported$/.exec(reason)?.[1];
      return space ? t("import.err.interpolation", { space }) : `${sentence(reason)}.`;
    }
    case "preprocessor":
      return `${t("import.err.preprocessor")} ${pasteResolved}`;
    case "unbalanced":
      return t("import.err.unbalanced");
    case "too-deep":
      return t("import.err.tooDeep");
    case "too-long":
      return t("import.err.tooLong");
    case "too-many-stops":
      return t("import.err.tooManyStops", { max: MAX_STOPS });
    case "syntax":
      return t("import.err.syntax", { reason: syntaxReason(reason, t) });
  }
}

// ── Interpolation clause the document cannot hold ─────────────────────────────

const INTERPOLATION_CLAUSE = /\bin\s+([a-z][a-z0-9-]*)(?:\s+(shorter|longer|increasing|decreasing)\s+hue)?/i;

function interpolationWarning(space: string, t: Translate): string {
  return t("import.warn.interpolation", { space });
}

/**
 * Core skips `in hsl`, `in display-p3`, … because the document cannot express
 * them. The editor has always imported such gradients as sRGB with a warning,
 * so re-read the layer with the clause rewritten to `in srgb`.
 */
function withoutUnsupportedSpace(css: string, g: ParsedGradient): { gradient: ParsedGradient; space: string } | null {
  const layer = css.slice(g.range.start, g.range.end);
  const m = INTERPOLATION_CLAUSE.exec(layer);
  if (!m) return null;
  const space = m[2] ? `${m[1].toLowerCase()} ${m[2].toLowerCase()} hue` : m[1].toLowerCase();
  const fixed = layer.slice(0, m.index) + "in srgb" + layer.slice(m.index + m[0].length);
  const again = parseGradient(fixed, CORE_OPTIONS).gradients[0];
  return again ? { gradient: again, space } : null;
}

// ── Main entry ────────────────────────────────────────────────────────────────

/**
 * Parse pasted CSS: the first gradient found in it, which may be a bare
 * `linear-gradient()`, a `background:` declaration, a whole rule or a
 * multi-layer shorthand.
 */
export function parseLinearGradient(input: string, t: Translate): ParseResult {
  try {
    return parse(input, t);
  } catch {
    return fail(t("import.err.noGradient"));
  }
}

function parse(input: string, t: Translate): ParseResult {
  if (typeof input !== "string") return fail(t("import.err.nothing"));
  if (input.length > MAX_INPUT) return fail(t("import.err.tooLong"));
  if (input.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/[\s;]+/g, "") === "") return fail(t("import.err.nothing"));

  const { gradients } = parseGradient(input, CORE_OPTIONS);
  if (gradients.length === 0) return fail(t("import.err.expected"));

  const warnings: string[] = [];
  if (gradients.length > 1) {
    warnings.push(t("import.warn.layers", { count: gradients.length }));
  }

  let g = gradients[0];
  let keptOutSpace: string | null = null;

  if (g.skipped?.code === "interpolation-space") {
    const rescued = withoutUnsupportedSpace(input, g);
    if (rescued) {
      g = rescued.gradient;
      keptOutSpace = rescued.space;
    }
  }
  if (g.skipped?.code === "legacy-syntax") return fail(skipMessage(g, "legacy-syntax", g.skipped.reason, t), warnings);
  if (g.repeating) return fail(t("import.err.repeating"), warnings);
  if (g.skipped) return fail(skipMessage(g, g.skipped.code, g.skipped.reason, t), warnings);
  const doc = g.document;
  if (!doc) return fail(t("import.err.expected"), warnings);

  return fromDocument(doc, g, keptOutSpace, warnings, t);
}

function fromDocument(
  doc: GradientDocument,
  g: ParsedGradient,
  keptOutSpace: string | null,
  warnings: string[],
  t: Translate,
): ParseResult {
  // ── Interpolation ──
  const interp = doc.interpolation;
  if (keptOutSpace) warnings.push(interpolationWarning(keptOutSpace, t));
  else if (interp && interp.space !== "srgb") {
    warnings.push(interpolationWarning(interp.space === "oklch" && interp.hue ? `oklch ${interp.hue} hue` : interp.space, t));
  }

  // ── Angle: CSS degrees, integer, [0, 360) ──
  for (const w of g.warnings) {
    if (w.code !== "corner-angle") continue;
    const corner: Record<number, string> = { 45: "top right", 135: "bottom right", 225: "bottom left", 315: "top left" };
    warnings.push(t("import.warn.corner", { corner: corner[doc.angle] ?? "corner", angle: doc.angle }));
  }
  const normalised = ((doc.angle % 360) + 360) % 360;
  let angle = Math.round(normalised) % 360;
  if (Math.abs(angle - normalised) >= 0.005 && Math.abs(angle + 360 - normalised) >= 0.005) {
    warnings.push(t("import.warn.angleRounded", { from: round2(normalised), to: angle }));
  }
  if (Object.is(angle, -0)) angle = 0;

  // ── Stop count ──
  const stops = doc.stops;
  const hints = g.warnings.filter((w) => w.code === "color-hint-ignored").length;
  if (hints > 0) {
    warnings.push(t("import.warn.hints", { count: hints }));
  }
  if (stops.length < 2) return fail(t("import.err.twoStops"), warnings);
  if (stops.length > MAX_STOPS) {
    return fail(t("import.err.stopCount", { count: stops.length, max: MAX_STOPS }), warnings);
  }
  for (const w of g.warnings) {
    if (w.code !== "gamut-mapped") continue;
    const m = /^(.+) is outside sRGB and was gamut-mapped to (#[0-9a-fA-F]+)$/.exec(w.message);
    warnings.push(m ? t("import.warn.gamut", { color: m[1], hex: m[2] }) : `${sentence(w.message)}.`);
  }

  // ── Alpha: the editor's stops are opaque ──
  const clear = (i: number): boolean => stops[i].alpha === 0;
  const dropped = stops.flatMap((s, i) => (s.alpha !== undefined && s.alpha > 0 && s.alpha < 1 ? [i + 1] : []));
  if (dropped.length > 0) {
    warnings.push(t("import.warn.alpha", { count: dropped.length, list: dropped.join(", ") }));
  }
  if (stops.every((_, i) => clear(i))) return fail(t("import.err.allTransparent"), warnings);
  const colors = stops.map((s) => s.color);
  for (let i = 0; i < stops.length; i++) {
    if (!clear(i)) continue;
    // Browsers interpolate transparent in premultiplied alpha, i.e. as a fade
    // of the neighbouring colour; the closest opaque stand-in is that colour.
    let j = 1;
    let replacement = "";
    while (!replacement) {
      if (i - j >= 0 && !clear(i - j)) replacement = stops[i - j].color;
      else if (i + j < stops.length && !clear(i + j)) replacement = stops[i + j].color;
      j++;
    }
    colors[i] = replacement;
    warnings.push(t("import.warn.transparentStop", { n: i + 1, hex: replacement }));
  }

  // ── Positions: browsers raise a stop that precedes an earlier one ──
  const explicit = stops.map((s) => s.position);
  if (explicit[0] === undefined) explicit[0] = 0;
  if (explicit[explicit.length - 1] === undefined) explicit[explicit.length - 1] = 1;
  let max = -Infinity;
  const clamped: number[] = [];
  explicit.forEach((p, i) => {
    if (p === undefined) return;
    if (p < max) clamped.push(i + 1);
    else max = p;
  });
  if (clamped.length > 0) {
    warnings.push(t("import.warn.reordered", { count: clamped.length, list: clamped.join(", ") }));
  }
  // Core resolves the rest exactly as CSS does (missing ends, even runs).
  let resolved: ImportedStop[] = resolveStops(doc).map((s, i) => ({ color: colors[i], position: clean(s.position * 100) }));

  // ── Trim to the visible 0..100 range exactly (sRGB interpolation, as the CSS paints) ──
  if (resolved.some((s) => s.position < 0 || s.position > 100)) {
    resolved = trimToRange(resolved);
    warnings.push(t("import.warn.trimmed"));
    if (resolved.length > MAX_STOPS) {
      return fail(t("import.err.trimmedStopCount", { count: resolved.length, max: MAX_STOPS }), warnings);
    }
  }

  return {
    ok: true,
    gradient: { stops: resolved.map((s) => ({ color: s.color, position: round2(s.position) })), angle },
    warnings,
  };
}

function mixSrgb(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex({ r: ca.r + (cb.r - ca.r) * t, g: ca.g + (cb.g - ca.g) * t, b: ca.b + (cb.b - ca.b) * t });
}

/** The colour CSS paints at `x` for sorted stops (sRGB, clamped at the ends). */
function colorAt(stops: ImportedStop[], x: number): string {
  if (x <= stops[0].position) return stops[0].color;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (x <= b.position) {
      const span = b.position - a.position;
      return span === 0 ? b.color : mixSrgb(a.color, b.color, (x - a.position) / span);
    }
  }
  return stops[stops.length - 1].color;
}

/** Same visible gradient over 0..100, with new end stops at the edges. */
function trimToRange(stops: ImportedStop[]): ImportedStop[] {
  const inside = stops.filter((s) => s.position >= 0 && s.position <= 100);
  const out: ImportedStop[] = [];
  if (stops[0].position < 0 && !(inside[0]?.position === 0)) out.push({ color: colorAt(stops, 0), position: 0 });
  out.push(...inside);
  if (stops[stops.length - 1].position > 100 && !(inside[inside.length - 1]?.position === 100)) {
    out.push({ color: colorAt(stops, 100), position: 100 });
  }
  // Everything was off one edge: the visible box is a single flat colour.
  if (out.length < 2) return [{ color: colorAt(stops, 0), position: 0 }, { color: colorAt(stops, 100), position: 100 }];
  return out;
}
