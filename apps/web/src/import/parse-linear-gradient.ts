// ── CSS linear-gradient() import parser ───────────────────────────────────────
// Turns pasted CSS into stops + an angle the editor can hold, or a clear
// error. Rule of the house: never a silent wrong colour. Anything we cannot
// represent exactly is either rejected with a reason or accepted with a
// warning that says what changed.
//
// Pure and DOM-free. Never throws.

import { hexToRgb, parseAnyColor, parseName, rgbToHex } from "@opal42/gradient";
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

const UNSUPPORTED_HINT = "Use the CLI or a future version for this input.";

/** Cheap pre-check: is this text worth offering as a gradient import? */
export function looksLikeGradient(text: string): boolean {
  return /gradient\s*\(/i.test(text);
}

// ── Tokenising helpers ────────────────────────────────────────────────────────

/** Split on `sep` at parenthesis depth 0. Returns null on unbalanced parens. */
function splitTopLevel(input: string, sep: "," | " "): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth < 0) return null;
    }
    const isSep = sep === " " ? /\s/.test(ch) : ch === sep;
    if (isSep && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (depth !== 0) return null;
  parts.push(current);
  return sep === " " ? parts.filter((p) => p !== "") : parts.map((p) => p.trim());
}

function fail(error: string, warnings: string[] = []): ParseResult {
  return { ok: false, error, warnings };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Angles ────────────────────────────────────────────────────────────────────

const ANGLE_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|turn|rad|grad)?$/i;

/** `<angle>` -> degrees, or null when the token is not an angle. */
function parseAngle(token: string): number | null {
  const m = ANGLE_RE.exec(token);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = m[2]?.toLowerCase();
  if (!unit) return value === 0 ? 0 : null; // only a bare 0 may omit the unit
  if (unit === "deg") return value;
  if (unit === "turn") return value * 360;
  if (unit === "rad") return (value * 180) / Math.PI;
  return value * 0.9; // grad
}

const SIDE_ANGLES: Record<string, number> = { top: 0, right: 90, bottom: 180, left: 270 };

/** `to <side> [<side>]` tokens (after `to`) -> degrees + optional warning. */
function parseSideOrCorner(sides: string[]): { angle: number; warning?: string } | { error: string } {
  const lower = sides.map((s) => s.toLowerCase());
  if (lower.length === 0 || lower.length > 2 || !lower.every((s) => s in SIDE_ANGLES)) {
    return { error: `"to ${sides.join(" ")}" is not a valid direction (use e.g. "to right" or "to top left").` };
  }
  if (lower.length === 1) return { angle: SIDE_ANGLES[lower[0]] };
  const vertical = lower.find((s) => s === "top" || s === "bottom");
  const horizontal = lower.find((s) => s === "left" || s === "right");
  if (!vertical || !horizontal) {
    return { error: `"to ${sides.join(" ")}" is not a valid corner (combine one of top/bottom with one of left/right).` };
  }
  const angle = vertical === "top" ? (horizontal === "right" ? 45 : 315) : horizontal === "right" ? 135 : 225;
  return {
    angle,
    warning: `"to ${vertical} ${horizontal}" depends on the element's aspect ratio; imported as ${angle}° (exact for a square box).`,
  };
}

// ── Interpolation clause ──────────────────────────────────────────────────────

const RECTANGULAR_SPACES = [
  "srgb",
  "srgb-linear",
  "display-p3",
  "a98-rgb",
  "prophoto-rgb",
  "rec2020",
  "lab",
  "oklab",
  "xyz",
  "xyz-d50",
  "xyz-d65",
];
const POLAR_SPACES = ["hsl", "hwb", "lch", "oklch"];
const HUE_METHODS = ["shorter", "longer", "increasing", "decreasing"];

/** Consume `in <space> [<hue-method> hue]` from `tokens` starting at `i`. */
function parseInterpolation(
  tokens: string[],
  i: number,
): { next: number; space: string } | { error: string } {
  const space = tokens[i + 1]?.toLowerCase();
  if (!space) return { error: `"in" must be followed by a colour space, e.g. "in oklab".` };
  if (RECTANGULAR_SPACES.includes(space)) return { next: i + 2, space };
  if (POLAR_SPACES.includes(space)) {
    const method = tokens[i + 2]?.toLowerCase();
    if (method && HUE_METHODS.includes(method)) {
      if (tokens[i + 3]?.toLowerCase() !== "hue") {
        return { error: `"${method}" must be followed by "hue", e.g. "in oklch longer hue".` };
      }
      return { next: i + 4, space: `${space} ${method} hue` };
    }
    return { next: i + 2, space };
  }
  return { error: `"${tokens[i + 1]}" is not a CSS colour space.` };
}

// ── Colours ───────────────────────────────────────────────────────────────────

const UNSUPPORTED_FUNCTIONS = [
  "var",
  "calc",
  "env",
  "attr",
  "min",
  "max",
  "clamp",
  "color-mix",
  "light-dark",
  "color",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "hwb",
  "device-cmyk",
];

/** Alpha in 0..1 of a hex / rgb[a]() / hsl[a]() token, 1 when absent. */
function alphaOf(token: string): number {
  if (token.startsWith("#")) {
    const body = token.slice(1);
    if (body.length === 4) return parseInt(body[3] + body[3], 16) / 255;
    if (body.length === 8) return parseInt(body.slice(6), 16) / 255;
    return 1;
  }
  const inner = /\((.*)\)$/s.exec(token)?.[1] ?? "";
  // Modern syntax: `rgb(r g b / a)`; legacy: `rgba(r, g, b, a)`.
  const slash = inner.split("/");
  let raw: string | undefined;
  if (slash.length === 2) raw = slash[1].trim();
  else {
    const parts = inner.split(",");
    if (parts.length === 4) raw = parts[3].trim();
  }
  if (raw === undefined) return 1;
  const pct = raw.endsWith("%");
  const n = Number(pct ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(n)) return NaN;
  return Math.min(1, Math.max(0, pct ? n / 100 : n));
}

type ColorToken = { kind: "color"; hex: string; alpha: number } | { kind: "transparent" } | { kind: "error"; error: string };

function parseColorToken(token: string, stopNo: number): ColorToken {
  const lower = token.toLowerCase();
  const fn = /^([a-z-]+)\s*\(/.exec(lower)?.[1];

  if (lower === "transparent") return { kind: "transparent" };
  if (lower === "currentcolor") {
    return { kind: "error", error: `Stop ${stopNo}: currentColor depends on the page's text colour and can't be imported. ${UNSUPPORTED_HINT}` };
  }
  if (fn && UNSUPPORTED_FUNCTIONS.includes(fn)) {
    return { kind: "error", error: `Stop ${stopNo}: ${fn}() colours are not supported yet. ${UNSUPPORTED_HINT}` };
  }
  if (fn && !["rgb", "rgba", "hsl", "hsla"].includes(fn)) {
    return { kind: "error", error: `Stop ${stopNo}: "${token}" is not a colour this editor understands.` };
  }
  if (fn) {
    if (/\b(from|none)\b/i.test(lower)) {
      return { kind: "error", error: `Stop ${stopNo}: relative colours and "none" channels are not supported. ${UNSUPPORTED_HINT}` };
    }
    if (!/^[a-z]+\s*\([\d\s.,%/+\-a-z]*\)$/i.test(token)) {
      return { kind: "error", error: `Stop ${stopNo}: "${token}" is not a valid colour.` };
    }
  } else if (lower.startsWith("#")) {
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(token)) {
      return { kind: "error", error: `Stop ${stopNo}: "${token}" is not a valid hex colour.` };
    }
  } else if (!/^[a-z]+$/i.test(token)) {
    return { kind: "error", error: `Stop ${stopNo}: "${token}" is not a colour.` };
  }

  // Bare identifiers go to the keyword table only: parseAnyColor would also
  // read words like "bad" or "fed" as hex digits.
  const hex = fn || lower.startsWith("#") ? parseAnyColor(token) : parseName(lower);
  if (!hex) return { kind: "error", error: `Stop ${stopNo}: "${token}" is not a recognised colour.` };
  const alpha = alphaOf(token);
  if (Number.isNaN(alpha)) return { kind: "error", error: `Stop ${stopNo}: "${token}" has an invalid alpha value.` };
  return { kind: "color", hex, alpha };
}

// ── Positions ─────────────────────────────────────────────────────────────────

/** `<percentage>` (or a bare 0) -> number, else an error string. */
function parsePosition(token: string, stopNo: number): number | string {
  const lower = token.toLowerCase();
  if (/^(calc|min|max|clamp|var|env)\s*\(/.test(lower)) {
    return `Stop ${stopNo}: ${lower.slice(0, lower.indexOf("("))}() positions are not supported. ${UNSUPPORTED_HINT}`;
  }
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|[a-z]+)?$/i.exec(token);
  if (!m) return `Stop ${stopNo}: "${token}" is not a position.`;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return `Stop ${stopNo}: "${token}" is not a position.`;
  if (m[2] === "%") return n;
  if (!m[2] && n === 0) return 0;
  return `Stop ${stopNo}: only percentage positions are supported (got "${token}"), because lengths depend on the element's size.`;
}

// ── Main entry ────────────────────────────────────────────────────────────────

interface RawStop {
  color: ColorToken & { kind: "color" | "transparent" };
  position: number | null;
}

/**
 * Parse a CSS `linear-gradient()` (optionally as a `background:` /
 * `background-image:` declaration, with or without the trailing `;`).
 */
export function parseLinearGradient(input: string): ParseResult {
  try {
    return parse(input);
  } catch {
    return fail("This doesn't look like a CSS linear-gradient().");
  }
}

function parse(input: string): ParseResult {
  const warnings: string[] = [];
  if (typeof input !== "string") return fail("Nothing to import.");
  if (input.length > 10_000) return fail("That text is too long to be a single gradient.");

  let text = input.replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  text = text.replace(/(?:\s*;)+\s*$/, "").trim();
  text = text.replace(/\s*!important$/i, "").trim();
  const prop = /^([a-z-]+)\s*:\s*/i.exec(text);
  if (prop) {
    const name = prop[1].toLowerCase();
    if (name !== "background" && name !== "background-image") {
      return fail(`Expected a background or background-image value, not "${prop[1]}".`);
    }
    text = text.slice(prop[0].length).trim();
  }
  if (!text) return fail("Nothing to import.");
  if (/[{};]/.test(text)) return fail("Paste a single background value, not a whole CSS rule.");

  const layers = splitTopLevel(text, ",");
  if (!layers) return fail("The parentheses don't balance.");
  if (layers.length > 1) {
    warnings.push(`Found ${layers.length} background layers; imported only the first.`);
  }
  const layer = layers[0];
  const lowerLayer = layer.toLowerCase();

  if (/^-(webkit|moz|o|ms)-/.test(lowerLayer)) {
    return fail(
      "Vendor-prefixed gradients (-webkit-, -moz-, …) use an older angle convention. Paste the standard linear-gradient(…) form instead.",
      warnings,
    );
  }
  if (/^repeating-/.test(lowerLayer)) {
    return fail("repeating-*-gradient() is not supported: the score covers a single run of stops. " + UNSUPPORTED_HINT, warnings);
  }
  if (/^(radial|conic)-gradient\s*\(/.test(lowerLayer)) {
    const kind = lowerLayer.startsWith("radial") ? "Radial" : "Conic";
    return fail(`${kind} gradients are not supported yet; only linear-gradient() can be imported.`, warnings);
  }
  const fnMatch = /^linear-gradient\s*\(/i.exec(layer);
  if (!fnMatch || !layer.endsWith(")")) {
    return fail("Expected linear-gradient(…).", warnings);
  }
  const body = layer.slice(fnMatch[0].length, -1);
  const args = splitTopLevel(body, ",");
  if (!args) return fail("The parentheses don't balance.", warnings);
  if (args.some((a) => a === "")) return fail("There is an empty argument (two commas in a row?).", warnings);

  // ── First argument: direction and/or interpolation method ──
  let angle = 180; // CSS default: to bottom
  let firstStopArg = 0;
  const firstTokens = splitTopLevel(args[0], " ") ?? [];
  const firstLower = firstTokens[0]?.toLowerCase();
  if (firstLower === "to" || firstLower === "in" || (firstTokens[0] !== undefined && parseAngle(firstTokens[0]) !== null)) {
    firstStopArg = 1;
    let sawDirection = false;
    let sawInterpolation = false;
    let i = 0;
    while (i < firstTokens.length) {
      const tok = firstTokens[i].toLowerCase();
      if (tok === "in" && !sawInterpolation) {
        const r = parseInterpolation(firstTokens, i);
        if ("error" in r) return fail(r.error, warnings);
        sawInterpolation = true;
        if (r.space !== "srgb") {
          warnings.push(
            `"in ${r.space}" interpolation was kept out: the editor exports standard sRGB interpolation and the score assumes it, so mid-tones may look different.`,
          );
        }
        i = r.next;
      } else if (tok === "to" && !sawDirection) {
        let j = i + 1;
        while (j < firstTokens.length && firstTokens[j].toLowerCase() !== "in") j++;
        const r = parseSideOrCorner(firstTokens.slice(i + 1, j));
        if ("error" in r) return fail(r.error, warnings);
        angle = r.angle;
        if (r.warning) warnings.push(r.warning);
        sawDirection = true;
        i = j;
      } else if (!sawDirection && parseAngle(firstTokens[i]) !== null) {
        angle = parseAngle(firstTokens[i]) as number;
        sawDirection = true;
        i++;
      } else {
        return fail(`"${args[0]}" is not a valid gradient direction.`, warnings);
      }
    }
  }

  const normalised = ((angle % 360) + 360) % 360;
  let finalAngle = Math.round(normalised) % 360;
  if (Math.abs(finalAngle - normalised) >= 0.005 && Math.abs(finalAngle + 360 - normalised) >= 0.005) {
    warnings.push(`The angle ${round2(normalised)}° was rounded to ${finalAngle}°.`);
  }
  if (Object.is(finalAngle, -0)) finalAngle = 0;

  // ── Colour stops ──
  const raws: RawStop[] = [];
  let hints = 0;
  const stopArgs = args.slice(firstStopArg);
  for (const [argIndex, arg] of stopArgs.entries()) {
    const tokens = splitTopLevel(arg, " ");
    if (!tokens || tokens.length === 0) return fail("Could not read a colour stop.", warnings);
    const stopNo = raws.length + 1;

    // A lone position is a colour hint (midpoint of the transition).
    const asHint = tokens.length === 1 ? parsePosition(tokens[0], stopNo) : null;
    if (typeof asHint === "number" || (tokens.length === 1 && /%$/.test(tokens[0]))) {
      if (argIndex === 0 || argIndex === stopArgs.length - 1) {
        return fail(`"${arg}" is a colour hint, which must sit between two colour stops.`, warnings);
      }
      hints++;
      continue;
    }

    if (tokens.length > 3) return fail(`"${arg}" has too many parts for a colour stop.`, warnings);
    const color = parseColorToken(tokens[0], stopNo);
    if (color.kind === "error") {
      // Maybe the position came first ("50% red") - say so specifically.
      if (typeof parsePosition(tokens[0], stopNo) === "number") {
        return fail(`"${arg}": the colour must come before its position.`, warnings);
      }
      return fail(color.error, warnings);
    }
    const positions: number[] = [];
    for (const tok of tokens.slice(1)) {
      const p = parsePosition(tok, stopNo);
      if (typeof p === "string") return fail(p, warnings);
      positions.push(p);
    }
    if (positions.length === 0) raws.push({ color, position: null });
    for (const p of positions) raws.push({ color, position: p });
  }
  if (hints > 0) {
    warnings.push(
      `Skipped ${hints} colour hint${hints > 1 ? "s" : ""} (transition midpoints); the transitions are now linear.`,
    );
  }
  if (raws.length < 2) return fail("A gradient needs at least two colour stops.", warnings);
  if (raws.length > MAX_STOPS) {
    return fail(`This gradient has ${raws.length} stops; the editor supports up to ${MAX_STOPS}.`, warnings);
  }

  // ── Alpha and transparent ──
  const alphaStops = raws
    .map((r, i) => (r.color.kind === "color" && r.color.alpha < 1 ? i + 1 : 0))
    .filter((n) => n > 0);
  if (alphaStops.length > 0) {
    warnings.push(
      `Transparency was dropped from stop${alphaStops.length > 1 ? "s" : ""} ${[...new Set(alphaStops)].join(", ")}: the editor's stops are opaque.`,
    );
  }
  if (raws.every((r) => r.color.kind === "transparent")) {
    return fail("Every stop is transparent, so there is no colour to import.", warnings);
  }
  const colors: string[] = raws.map((r) => (r.color.kind === "color" ? r.color.hex : ""));
  for (let i = 0; i < raws.length; i++) {
    if (raws[i].color.kind !== "transparent") continue;
    // Browsers interpolate transparent in premultiplied alpha, i.e. as a fade
    // of the neighbouring colour; the closest opaque stand-in is that colour.
    let j = 1;
    let replacement = "";
    while (!replacement) {
      const prev = raws[i - j];
      const next = raws[i + j];
      if (prev && prev.color.kind === "color") replacement = prev.color.hex;
      else if (next && next.color.kind === "color") replacement = next.color.hex;
      j++;
    }
    colors[i] = replacement;
    warnings.push(`Stop ${i + 1} was transparent; it now uses its neighbour's colour ${replacement} (stops are opaque).`);
  }

  // ── Resolve positions as CSS does (CSS Images 3, "color stop fixup") ──
  const pos: (number | null)[] = raws.map((r) => r.position);
  if (pos[0] === null) pos[0] = 0;
  if (pos[pos.length - 1] === null) pos[pos.length - 1] = 100;
  let maxSoFar = -Infinity;
  const clamped: number[] = [];
  for (let i = 0; i < pos.length; i++) {
    const p = pos[i];
    if (p === null) continue;
    if (p < maxSoFar) {
      pos[i] = maxSoFar;
      clamped.push(i + 1);
    } else {
      maxSoFar = p;
    }
  }
  if (clamped.length > 0) {
    warnings.push(
      `Stop${clamped.length > 1 ? "s" : ""} ${clamped.join(", ")} came before an earlier stop and ${clamped.length > 1 ? "were" : "was"} moved up to it, as browsers do.`,
    );
  }
  for (let i = 0; i < pos.length; i++) {
    if (pos[i] !== null) continue;
    let end = i;
    while (pos[end] === null) end++;
    const from = pos[i - 1] as number;
    const to = pos[end] as number;
    const steps = end - i + 1;
    for (let k = i; k < end; k++) pos[k] = from + ((to - from) * (k - i + 1)) / steps;
    i = end;
  }
  let stops: ImportedStop[] = pos.map((p, i) => ({ color: colors[i], position: p as number }));

  // ── Trim to the visible 0..100 range exactly (sRGB interpolation, as the CSS paints) ──
  if (stops.some((s) => s.position < 0 || s.position > 100)) {
    stops = trimToRange(stops);
    warnings.push("Stops outside 0–100% were trimmed to the visible range; the colours at the edges are kept.");
    if (stops.length > MAX_STOPS) {
      return fail(`After trimming to 0–100% this gradient has ${stops.length} stops; the editor supports up to ${MAX_STOPS}.`, warnings);
    }
  }

  return {
    ok: true,
    gradient: { stops: stops.map((s) => ({ color: s.color, position: round2(s.position) })), angle: finalAngle },
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
