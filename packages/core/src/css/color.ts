// ── Strict CSS colour parser ───────────────────────────────────────────────────
// What the gradient parser accepts as a stop colour. Unlike the lenient
// `parseAnyColor` (built for paste fields), this either returns exactly the
// colour CSS would compute, or a structured reason why it did not: it never
// guesses. Supported: hex 3/4/6/8, rgb()/rgba(), hsl()/hsla(), the 148 named
// colours, `transparent`, oklab(), oklch() (gamut-mapped into sRGB).

import { CSS_NAMED_COLORS, gamutFitOklch } from "../color-formats";
import { lchToOklab, oklabToLch, oklabToLinearRgb, oklabToRgb, rgbToHex } from "../gradient-engine";
import type { SkipCode } from "../api/types";
import { tokenize, type Token } from "./tokens";

export type ParsedColor =
  | { ok: true; color: string; alpha: number; gamutMapped?: boolean }
  | { ok: false; code: SkipCode; reason: string };

const fail = (code: SkipCode, reason: string): ParsedColor => ({ ok: false, code, reason });

const SYSTEM_COLORS =
  "|accentcolor|accentcolortext|activetext|buttonborder|buttonface|buttontext|canvas|canvastext|field|fieldtext|graytext|highlight|highlighttext|linktext|mark|marktext|selecteditem|selecteditemtext|visitedtext|" +
  "activeborder|activecaption|appworkspace|background|buttonhighlight|buttonshadow|captiontext|inactiveborder|inactivecaption|inactivecaptiontext|infobackground|infotext|menu|menutext|scrollbar|threeddarkshadow|threedface|threedhighlight|threedlightshadow|threedshadow|window|windowframe|windowtext|";

const MATH_FUNCTIONS = "|calc|min|max|clamp|round|mod|rem|sin|cos|tan|asin|acos|atan|atan2|pow|sqrt|hypot|log|exp|abs|sign|";

/** Skip code for a function that can never be read statically, or null. */
export function dynamicFunctionCode(name: string): SkipCode | null {
  if (name === "var") return "var";
  if (name === "env") return "env";
  if (MATH_FUNCTIONS.includes(`|${name}|`)) return "calc";
  return null;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function hexByte(n: number): string {
  return clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
}

function parseHexToken(body: string): ParsedColor {
  if (!/^[0-9a-fA-F]+$/.test(body)) return fail("unknown-color", `#${body} is not a hex colour`);
  const b = body.toLowerCase();
  if (b.length === 3 || b.length === 4) {
    const color = `#${b[0]}${b[0]}${b[1]}${b[1]}${b[2]}${b[2]}`;
    return { ok: true, color, alpha: b.length === 4 ? parseInt(b[3] + b[3], 16) / 255 : 1 };
  }
  if (b.length === 6 || b.length === 8) {
    return { ok: true, color: `#${b.slice(0, 6)}`, alpha: b.length === 8 ? parseInt(b.slice(6), 16) / 255 : 1 };
  }
  return fail("unknown-color", `#${body} is not a 3, 4, 6 or 8 digit hex colour`);
}

type Num = Extract<Token, { type: "num" }>;

interface Components {
  values: Num[];
  alpha: Num | null;
  legacy: boolean;
}

/** The numeric components of a colour function, or the reason they cannot be read. */
function components(text: string, fn: Extract<Token, { type: "fn" }>): Components | ParsedColor {
  const tokens = tokenize(text, fn.innerStart, fn.innerEnd);
  if (tokens.length > 16) return fail("unknown-color", `${fn.name}() has too many components`);
  const first = tokens[0];
  if (first && first.type === "ident" && first.value === "from") {
    return fail("relative-color", `relative colour syntax (${fn.name}(from …)) is not supported`);
  }
  for (const t of tokens) {
    if (t.type === "fn") {
      const code = dynamicFunctionCode(t.name);
      if (code) return fail(code, `${t.name}() inside ${fn.name}() cannot be resolved statically`);
      return fail("unknown-color", `unexpected ${t.name}() inside ${fn.name}()`);
    }
    if (t.type === "interp") return fail("preprocessor", `preprocessor or template expression inside ${fn.name}()`);
    if (t.type === "ident") {
      return fail(
        "unknown-color",
        t.value === "none" ? `'none' components in ${fn.name}() are not supported` : `unexpected '${t.value}' in ${fn.name}()`,
      );
    }
    if (t.type === "hash" || t.type === "other") return fail("unknown-color", `malformed ${fn.name}()`);
    if (t.type === "num" && !Number.isFinite(t.value)) return fail("unknown-color", `malformed number in ${fn.name}()`);
  }
  const bad = fail("unknown-color", `malformed ${fn.name}()`);
  const legacy = tokens.some((t) => t.type === "comma");
  const values: Num[] = [];
  let alpha: Num | null = null;
  if (legacy) {
    // n , n , n [, a]
    if (tokens.length !== 5 && tokens.length !== 7) return bad;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (i % 2 === 1) {
        if (t.type !== "comma") return bad;
      } else if (t.type !== "num") return bad;
      else if (i < 6) values.push(t);
      else alpha = t;
    }
  } else {
    // n n n [/ a]
    if (tokens.length !== 3 && tokens.length !== 5) return bad;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (i === 3) {
        if (t.type !== "slash") return bad;
      } else if (t.type !== "num") return bad;
      else if (i < 3) values.push(t);
      else alpha = t;
    }
  }
  if (alpha && alpha.unit !== "" && alpha.unit !== "%") return bad;
  return { values, alpha, legacy };
}

function alphaOf(c: Components): number {
  if (!c.alpha) return 1;
  return clamp(c.alpha.unit === "%" ? c.alpha.value / 100 : c.alpha.value, 0, 1);
}

/** Hue in degrees from a number or an angle, or null for any other unit. */
export function angleToDegrees(value: number, unit: string): number | null {
  switch (unit) {
    case "":
    case "deg":
      return value;
    case "grad":
      return value * 0.9;
    case "rad":
      return (value * 180) / Math.PI;
    case "turn":
      return value * 360;
    default:
      return null;
  }
}

function parseRgbFn(text: string, fn: Extract<Token, { type: "fn" }>): ParsedColor {
  const c = components(text, fn);
  if ("ok" in c) return c;
  const bad = fail("unknown-color", `malformed ${fn.name}()`);
  const [r, g, b] = c.values;
  for (const v of c.values) if (v.unit !== "" && v.unit !== "%") return bad;
  // Legacy syntax: all numbers or all percentages.
  if (c.legacy && !(r.unit === g.unit && g.unit === b.unit)) return bad;
  const ch = (v: Num): string => hexByte(v.unit === "%" ? (v.value / 100) * 255 : v.value);
  return { ok: true, color: `#${ch(r)}${ch(g)}${ch(b)}`, alpha: alphaOf(c) };
}

function hslChannel(h: number, s: number, l: number, n: number): number {
  const k = (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
}

function parseHslFn(text: string, fn: Extract<Token, { type: "fn" }>): ParsedColor {
  const c = components(text, fn);
  if ("ok" in c) return c;
  const bad = fail("unknown-color", `malformed ${fn.name}()`);
  const [hT, sT, lT] = c.values;
  const deg = angleToDegrees(hT.value, hT.unit);
  if (deg === null) return bad;
  for (const v of [sT, lT]) {
    if (c.legacy ? v.unit !== "%" : v.unit !== "%" && v.unit !== "") return bad;
  }
  const h = ((deg % 360) + 360) % 360;
  const s = clamp(sT.value, 0, 100) / 100;
  const l = clamp(lT.value, 0, 100) / 100;
  const ch = (n: number): string => hexByte(hslChannel(h, s, l, n) * 255);
  return { ok: true, color: `#${ch(0)}${ch(8)}${ch(4)}`, alpha: alphaOf(c) };
}

function parseOkFn(text: string, fn: Extract<Token, { type: "fn" }>): ParsedColor {
  const c = components(text, fn);
  if ("ok" in c) return c;
  const bad = fail("unknown-color", `malformed ${fn.name}()`);
  if (c.legacy) return bad;
  const [lT, aT, bT] = c.values;
  if (lT.unit !== "" && lT.unit !== "%") return bad;
  const L = clamp(lT.unit === "%" ? lT.value / 100 : lT.value, 0, 1);
  // 100% of a, b and C is 0.4.
  const part = (v: Num): number | null => (v.unit === "%" ? (v.value / 100) * 0.4 : v.unit === "" ? v.value : null);
  let lch: { L: number; C: number; h: number };
  if (fn.name === "oklab") {
    const a = part(aT);
    const b = part(bT);
    if (a === null || b === null) return bad;
    lch = oklabToLch({ L, a, b });
  } else {
    const C = part(aT);
    const h = angleToDegrees(bT.value, bT.unit);
    if (C === null || h === null) return bad;
    lch = { L, C: Math.max(0, C), h: ((h % 360) + 360) % 360 };
  }
  const { r, g, b } = oklabToLinearRgb(lchToOklab(lch));
  const eps = 1e-4;
  const inGamut = r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && b >= -eps && b <= 1 + eps;
  const fitted = inGamut ? lch : gamutFitOklch(lch);
  const color = rgbToHex(oklabToRgb(lchToOklab(fitted)));
  const out: ParsedColor = { ok: true, color, alpha: alphaOf(c) };
  if (!inGamut) out.gamutMapped = true;
  return out;
}

function parseFunction(text: string, fn: Extract<Token, { type: "fn" }>): ParsedColor {
  switch (fn.name) {
    case "rgb":
    case "rgba":
      return parseRgbFn(text, fn);
    case "hsl":
    case "hsla":
      return parseHslFn(text, fn);
    case "oklab":
    case "oklch":
      return parseOkFn(text, fn);
    case "color-mix":
      return fail("color-mix", "color-mix() is not supported");
    case "lab":
    case "lch":
    case "color":
    case "hwb": {
      const first = tokenize(text, fn.innerStart, Math.min(fn.innerEnd, fn.innerStart + 64))[0];
      if (first && first.type === "ident" && first.value === "from") {
        return fail("relative-color", `relative colour syntax (${fn.name}(from …)) is not supported`);
      }
      if (fn.name === "hwb") return fail("unknown-color", "hwb() is not supported");
      return fn.name === "color"
        ? fail("color-function", "color() (display-p3 and other predefined spaces) cannot be judged by the sRGB model")
        : fail("lab-lch", `${fn.name}() (CIE Lab, wide gamut) cannot be judged by the sRGB model`);
    }
    default: {
      const code = dynamicFunctionCode(fn.name);
      if (code) return fail(code, `${fn.name}() cannot be resolved statically`);
      return fail("unknown-color", `${fn.name}() is not a supported colour function`);
    }
  }
}

/** The colour of one component token of `text`. */
export function parseColorToken(text: string, token: Token): ParsedColor {
  switch (token.type) {
    case "hash":
      return parseHexToken(token.value);
    case "fn":
      return parseFunction(text, token);
    case "ident": {
      const name = token.value;
      if (name === "transparent") return { ok: true, color: "#000000", alpha: 0 };
      if (name === "currentcolor") return fail("currentColor", "currentColor depends on the element");
      if (Object.hasOwn(CSS_NAMED_COLORS, name)) return { ok: true, color: CSS_NAMED_COLORS[name], alpha: 1 };
      if (SYSTEM_COLORS.includes(`|${name}|`)) return fail("system-color", `system colour '${name}' depends on the platform`);
      return fail("unknown-color", `'${name}' is not a colour`);
    }
    case "interp":
      return fail("preprocessor", "preprocessor variable or template expression");
    default:
      return fail("unknown-color", "not a colour");
  }
}

/**
 * Parse one CSS colour, strictly. Returns `{ color: '#rrggbb', alpha }` or
 * null when the text is not exactly one supported colour. Never throws.
 */
export function parseCssColor(css: string): { color: string; alpha: number } | null {
  if (typeof css !== "string" || css.length > 256) return null;
  const tokens = tokenize(css, 0, css.length);
  if (tokens.length !== 1) return null;
  const parsed = parseColorToken(css, tokens[0]);
  return parsed.ok ? { color: parsed.color, alpha: parsed.alpha } : null;
}
