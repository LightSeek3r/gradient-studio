// ── CSS import adapter: core `parseGradient` -> what the editor can hold ──────
// The parser itself lives in @opal42/gradient (spec/parser.md). This file is
// the thin, app-specific layer on top of it:
//
//   * pick the first gradient in the pasted text (a declaration, a whole rule,
//     a multi-layer shorthand) and say when other layers were left out;
//   * turn core's skip codes into messages a person can act on;
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

const PASTE_RESOLVED = "Paste the gradient with its computed values instead.";
const PLAIN_COLOURS = "Use hex, rgb(), hsl(), oklab(), oklch() or a colour name instead.";

/** "Stop 2 uses calc()" etc: core's reason, first letter capitalised. */
const sentence = (reason: string): string =>
  /^[a-z-]+\(/.test(reason) ? reason : reason.charAt(0).toUpperCase() + reason.slice(1);

function skipMessage(g: ParsedGradient, code: SkipCode, reason: string): string {
  switch (code) {
    case "legacy-syntax":
      return "Vendor-prefixed gradients (-webkit-, -moz-, …) use an older angle convention. Paste the standard linear-gradient(…) form instead.";
    case "unsupported-kind":
      return `${g.kind === "radial" ? "Radial" : "Conic"} gradients are not supported yet; only linear-gradient() can be imported.`;
    case "var":
      return `var() can't be imported: its value isn't in the pasted text. ${PASTE_RESOLVED}`;
    case "calc":
      return `calc(), min(), max() and clamp() can't be imported: the result depends on the element. ${PASTE_RESOLVED}`;
    case "env":
      return `env() can't be imported: its value comes from the device. ${PASTE_RESOLVED}`;
    case "currentColor":
      return `currentColor depends on the page's text colour and can't be imported. ${PASTE_RESOLVED}`;
    case "system-color":
      return `${sentence(reason)}, so it can't be imported. ${PASTE_RESOLVED}`;
    case "color-mix":
      return `color-mix() colours are not supported yet. ${PLAIN_COLOURS}`;
    case "relative-color":
      return `Relative colours (rgb(from …)) are not supported yet. ${PLAIN_COLOURS}`;
    case "lab-lch":
    case "color-function":
      return `${/^[a-z-]+/.exec(reason)?.[0] ?? "That"}() colours can't be judged in sRGB and are not supported yet. ${PLAIN_COLOURS}`;
    case "unknown-color":
      return `${sentence(reason.replace(/ is not a colour$/, " is not a recognised colour"))}.`;
    case "length-position":
      return `Only percentage stop positions are supported: ${/ in ([a-z]+)/i.exec(reason)?.[1] ?? "length"} positions depend on the element's size.`;
    case "interpolation-space":
      return `${sentence(reason)}.`;
    case "preprocessor":
      return `Sass/Less variables and template expressions can't be imported. ${PASTE_RESOLVED}`;
    case "unbalanced":
      return "The parentheses don't balance: the gradient is never closed.";
    case "too-deep":
      return "That gradient is nested too deeply to import.";
    case "too-long":
      return "That text is too long to be a single gradient.";
    case "too-many-stops":
      return `This gradient has too many stops; the editor supports up to ${MAX_STOPS}.`;
    case "syntax":
      return `This isn't a valid linear-gradient(): ${reason}.`;
  }
}

// ── Interpolation clause the document cannot hold ─────────────────────────────

const INTERPOLATION_CLAUSE = /\bin\s+([a-z][a-z0-9-]*)(?:\s+(shorter|longer|increasing|decreasing)\s+hue)?/i;

function interpolationWarning(space: string): string {
  return `"in ${space}" interpolation was kept out: the editor exports standard sRGB interpolation and the score assumes it, so mid-tones may look different.`;
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
export function parseLinearGradient(input: string): ParseResult {
  try {
    return parse(input);
  } catch {
    return fail("This doesn't look like a CSS linear-gradient().");
  }
}

function parse(input: string): ParseResult {
  if (typeof input !== "string") return fail("Nothing to import.");
  if (input.length > MAX_INPUT) return fail("That text is too long to be a single gradient.");
  if (input.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/[\s;]+/g, "") === "") return fail("Nothing to import.");

  const { gradients } = parseGradient(input, CORE_OPTIONS);
  if (gradients.length === 0) return fail("Expected linear-gradient(…).");

  const warnings: string[] = [];
  if (gradients.length > 1) {
    warnings.push(`Found ${gradients.length} background layers; imported only the first.`);
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
  if (g.skipped?.code === "legacy-syntax") return fail(skipMessage(g, "legacy-syntax", g.skipped.reason), warnings);
  if (g.repeating) {
    return fail(
      "repeating-*-gradient() is not supported: the score covers a single run of stops. Use a plain gradient instead.",
      warnings,
    );
  }
  if (g.skipped) return fail(skipMessage(g, g.skipped.code, g.skipped.reason), warnings);
  const doc = g.document;
  if (!doc) return fail("Expected linear-gradient(…).", warnings);

  return fromDocument(doc, g, keptOutSpace, warnings);
}

function fromDocument(doc: GradientDocument, g: ParsedGradient, keptOutSpace: string | null, warnings: string[]): ParseResult {
  // ── Interpolation ──
  const interp = doc.interpolation;
  if (keptOutSpace) warnings.push(interpolationWarning(keptOutSpace));
  else if (interp && interp.space !== "srgb") {
    warnings.push(interpolationWarning(interp.space === "oklch" && interp.hue ? `oklch ${interp.hue} hue` : interp.space));
  }

  // ── Angle: CSS degrees, integer, [0, 360) ──
  for (const w of g.warnings) {
    if (w.code !== "corner-angle") continue;
    const corner: Record<number, string> = { 45: "top right", 135: "bottom right", 225: "bottom left", 315: "top left" };
    warnings.push(
      `"to ${corner[doc.angle] ?? "corner"}" depends on the element's aspect ratio; imported as ${doc.angle}° (exact for a square box).`,
    );
  }
  const normalised = ((doc.angle % 360) + 360) % 360;
  let angle = Math.round(normalised) % 360;
  if (Math.abs(angle - normalised) >= 0.005 && Math.abs(angle + 360 - normalised) >= 0.005) {
    warnings.push(`The angle ${round2(normalised)}° was rounded to ${angle}°.`);
  }
  if (Object.is(angle, -0)) angle = 0;

  // ── Stop count ──
  const stops = doc.stops;
  const hints = g.warnings.filter((w) => w.code === "color-hint-ignored").length;
  if (hints > 0) {
    warnings.push(`Skipped ${hints} colour hint${hints > 1 ? "s" : ""} (transition midpoints); the transitions are now linear.`);
  }
  if (stops.length < 2) return fail("A gradient needs at least two colour stops.", warnings);
  if (stops.length > MAX_STOPS) {
    return fail(`This gradient has ${stops.length} stops; the editor supports up to ${MAX_STOPS}.`, warnings);
  }
  for (const w of g.warnings) if (w.code === "gamut-mapped") warnings.push(sentence(w.message) + ".");

  // ── Alpha: the editor's stops are opaque ──
  const clear = (i: number): boolean => stops[i].alpha === 0;
  const dropped = stops.flatMap((s, i) => (s.alpha !== undefined && s.alpha > 0 && s.alpha < 1 ? [i + 1] : []));
  if (dropped.length > 0) {
    warnings.push(`Transparency was dropped from stop${dropped.length > 1 ? "s" : ""} ${dropped.join(", ")}: the editor's stops are opaque.`);
  }
  if (stops.every((_, i) => clear(i))) return fail("Every stop is transparent, so there is no colour to import.", warnings);
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
    warnings.push(`Stop ${i + 1} was transparent; it now uses its neighbour's colour ${replacement} (stops are opaque).`);
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
    warnings.push(
      `Stop${clamped.length > 1 ? "s" : ""} ${clamped.join(", ")} came before an earlier stop and ${clamped.length > 1 ? "were" : "was"} moved up to it, as browsers do.`,
    );
  }
  // Core resolves the rest exactly as CSS does (missing ends, even runs).
  let resolved: ImportedStop[] = resolveStops(doc).map((s, i) => ({ color: colors[i], position: clean(s.position * 100) }));

  // ── Trim to the visible 0..100 range exactly (sRGB interpolation, as the CSS paints) ──
  if (resolved.some((s) => s.position < 0 || s.position > 100)) {
    resolved = trimToRange(resolved);
    warnings.push("Stops outside 0–100% were trimmed to the visible range; the colours at the edges are kept.");
    if (resolved.length > MAX_STOPS) {
      return fail(`After trimming to 0–100% this gradient has ${resolved.length} stops; the editor supports up to ${MAX_STOPS}.`, warnings);
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
