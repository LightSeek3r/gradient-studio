// ── Color formats ──────────────────────────────────────────────────────────────
// Parsing and formatting between the notations a user might type or paste
// (hex / rgb / hsl / CSS name) and the canonical `#rrggbb` the engine speaks.
// Also: complementary colors, computed in OKLCH and mapped back into sRGB.
// Zero dependencies beyond the gradient engine — no React, no DOM.

import {
  hexToRgb,
  lchToOklab,
  oklabToLch,
  oklabToLinearRgb,
  oklabToRgb,
  rgbToHex,
  rgbToOklab,
  type LchColor,
  type OklabColor,
  type RGB,
} from "./gradient-engine";

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

// ── CSS named colors ──────────────────────────────────────────────────────────
// Insertion order matters: reverse lookup keeps the first name for each hex, so
// aliases resolve to the more familiar spelling (aqua over cyan, gray over grey).

export const CSS_NAMED_COLORS: Record<string, string> = {
  aliceblue: "#f0f8ff",
  antiquewhite: "#faebd7",
  aqua: "#00ffff",
  aquamarine: "#7fffd4",
  azure: "#f0ffff",
  beige: "#f5f5dc",
  bisque: "#ffe4c4",
  black: "#000000",
  blanchedalmond: "#ffebcd",
  blue: "#0000ff",
  blueviolet: "#8a2be2",
  brown: "#a52a2a",
  burlywood: "#deb887",
  cadetblue: "#5f9ea0",
  chartreuse: "#7fff00",
  chocolate: "#d2691e",
  coral: "#ff7f50",
  cornflowerblue: "#6495ed",
  cornsilk: "#fff8dc",
  crimson: "#dc143c",
  cyan: "#00ffff",
  darkblue: "#00008b",
  darkcyan: "#008b8b",
  darkgoldenrod: "#b8860b",
  darkgray: "#a9a9a9",
  darkgreen: "#006400",
  darkgrey: "#a9a9a9",
  darkkhaki: "#bdb76b",
  darkmagenta: "#8b008b",
  darkolivegreen: "#556b2f",
  darkorange: "#ff8c00",
  darkorchid: "#9932cc",
  darkred: "#8b0000",
  darksalmon: "#e9967a",
  darkseagreen: "#8fbc8f",
  darkslateblue: "#483d8b",
  darkslategray: "#2f4f4f",
  darkslategrey: "#2f4f4f",
  darkturquoise: "#00ced1",
  darkviolet: "#9400d3",
  deeppink: "#ff1493",
  deepskyblue: "#00bfff",
  dimgray: "#696969",
  dimgrey: "#696969",
  dodgerblue: "#1e90ff",
  firebrick: "#b22222",
  floralwhite: "#fffaf0",
  forestgreen: "#228b22",
  fuchsia: "#ff00ff",
  gainsboro: "#dcdcdc",
  ghostwhite: "#f8f8ff",
  gold: "#ffd700",
  goldenrod: "#daa520",
  gray: "#808080",
  green: "#008000",
  greenyellow: "#adff2f",
  grey: "#808080",
  honeydew: "#f0fff0",
  hotpink: "#ff69b4",
  indianred: "#cd5c5c",
  indigo: "#4b0082",
  ivory: "#fffff0",
  khaki: "#f0e68c",
  lavender: "#e6e6fa",
  lavenderblush: "#fff0f5",
  lawngreen: "#7cfc00",
  lemonchiffon: "#fffacd",
  lightblue: "#add8e6",
  lightcoral: "#f08080",
  lightcyan: "#e0ffff",
  lightgoldenrodyellow: "#fafad2",
  lightgray: "#d3d3d3",
  lightgreen: "#90ee90",
  lightgrey: "#d3d3d3",
  lightpink: "#ffb6c1",
  lightsalmon: "#ffa07a",
  lightseagreen: "#20b2aa",
  lightskyblue: "#87cefa",
  lightslategray: "#778899",
  lightslategrey: "#778899",
  lightsteelblue: "#b0c4de",
  lightyellow: "#ffffe0",
  lime: "#00ff00",
  limegreen: "#32cd32",
  linen: "#faf0e6",
  magenta: "#ff00ff",
  maroon: "#800000",
  mediumaquamarine: "#66cdaa",
  mediumblue: "#0000cd",
  mediumorchid: "#ba55d3",
  mediumpurple: "#9370db",
  mediumseagreen: "#3cb371",
  mediumslateblue: "#7b68ee",
  mediumspringgreen: "#00fa9a",
  mediumturquoise: "#48d1cc",
  mediumvioletred: "#c71585",
  midnightblue: "#191970",
  mintcream: "#f5fffa",
  mistyrose: "#ffe4e1",
  moccasin: "#ffe4b5",
  navajowhite: "#ffdead",
  navy: "#000080",
  oldlace: "#fdf5e6",
  olive: "#808000",
  olivedrab: "#6b8e23",
  orange: "#ffa500",
  orangered: "#ff4500",
  orchid: "#da70d6",
  palegoldenrod: "#eee8aa",
  palegreen: "#98fb98",
  paleturquoise: "#afeeee",
  palevioletred: "#db7093",
  papayawhip: "#ffefd5",
  peachpuff: "#ffdab9",
  peru: "#cd853f",
  pink: "#ffc0cb",
  plum: "#dda0dd",
  powderblue: "#b0e0e6",
  purple: "#800080",
  rebeccapurple: "#663399",
  red: "#ff0000",
  rosybrown: "#bc8f8f",
  royalblue: "#4169e1",
  saddlebrown: "#8b4513",
  salmon: "#fa8072",
  sandybrown: "#f4a460",
  seagreen: "#2e8b57",
  seashell: "#fff5ee",
  sienna: "#a0522d",
  silver: "#c0c0c0",
  skyblue: "#87ceeb",
  slateblue: "#6a5acd",
  slategray: "#708090",
  slategrey: "#708090",
  snow: "#fffafa",
  springgreen: "#00ff7f",
  steelblue: "#4682b4",
  tan: "#d2b48c",
  teal: "#008080",
  thistle: "#d8bfd8",
  tomato: "#ff6347",
  turquoise: "#40e0d0",
  violet: "#ee82ee",
  wheat: "#f5deb3",
  white: "#ffffff",
  whitesmoke: "#f5f5f5",
  yellow: "#ffff00",
  yellowgreen: "#9acd32",
};

/** Alphabetical name list — feeds the `<datalist>` autocomplete. */
export const CSS_COLOR_NAMES = Object.keys(CSS_NAMED_COLORS);

const HEX_TO_NAME: Record<string, string> = {};
for (const [name, hex] of Object.entries(CSS_NAMED_COLORS)) {
  if (!(hex in HEX_TO_NAME)) HEX_TO_NAME[hex] = name;
}

let namedLabs: { name: string; lab: OklabColor }[] | null = null;
function getNamedLabs() {
  namedLabs ??= Object.entries(HEX_TO_NAME).map(([hex, name]) => ({
    name,
    lab: rgbToOklab(hexToRgb(hex)),
  }));
  return namedLabs;
}

export interface ColorNameMatch {
  name: string;
  /** True when the hex is exactly the named color, false when it's the nearest. */
  exact: boolean;
}

/**
 * Nearest CSS named color, measured as OKLAB ΔE so "nearest" means
 * perceptually nearest rather than nearest in raw RGB coordinates.
 */
export function nearestColorName(hex: string): ColorNameMatch {
  const canonical = hex.toLowerCase();
  const exact = HEX_TO_NAME[canonical];
  if (exact) return { name: exact, exact: true };

  const lab = rgbToOklab(hexToRgb(canonical));
  let best = getNamedLabs()[0];
  let bestDist = Infinity;
  for (const candidate of getNamedLabs()) {
    const d =
      (lab.L - candidate.lab.L) ** 2 +
      (lab.a - candidate.lab.a) ** 2 +
      (lab.b - candidate.lab.b) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  return { name: best.name, exact: false };
}

// ── HSL ───────────────────────────────────────────────────────────────────────

export interface HSL {
  h: number;
  s: number;
  l: number;
}

/** sRGB → HSL at full precision. */
export function rgbToHslPrecise({ r, g, b }: RGB): HSL {
  const rn = r / 255,
    gn = g / 255,
    bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;

  let h = 0;
  let s = 0;
  if (d > 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }

  return { h, s: s * 100, l: l * 100 };
}

/**
 * sRGB → HSL rounded to whole degrees and percents, for display.
 *
 * Rounding here is lossy — only ~10% of sRGB colors survive a round trip
 * through integer HSL intact, and repeated trips can drift a channel by
 * several levels. Editors should show these values but feed unchanged channels
 * back from `rgbToHslPrecise`, so touching H never nudges S and L.
 */
export function rgbToHsl(rgb: RGB): HSL {
  const { h, s, l } = rgbToHslPrecise(rgb);
  return { h: Math.round(h) % 360, s: Math.round(s), l: Math.round(l) };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const hue = (((h % 360) + 360) % 360) / 60;
  const sat = clamp(s, 0, 100) / 100;
  const lum = clamp(l, 0, 100) / 100;

  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = lum - c / 2;

  let rgb: [number, number, number];
  if (hue < 1) rgb = [c, x, 0];
  else if (hue < 2) rgb = [x, c, 0];
  else if (hue < 3) rgb = [0, c, x];
  else if (hue < 4) rgb = [0, x, c];
  else if (hue < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
  };
}

/** Display-ready HSL (integers). See `rgbToHsl` on the precision trade-off. */
export function hexToHsl(hex: string): HSL {
  return rgbToHsl(hexToRgb(hex));
}

/** Full-precision HSL, for preserving channels the user didn't edit. */
export function hexToHslPrecise(hex: string): HSL {
  return rgbToHslPrecise(hexToRgb(hex));
}

export function hslToHex(hsl: HSL): string {
  return rgbToHex(hslToRgb(hsl));
}

// ── Formatting ────────────────────────────────────────────────────────────────

export function formatHex(hex: string): string {
  return hex.toUpperCase();
}

export function formatRgb(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${r}, ${g}, ${b})`;
}

export function formatHsl(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/** Named color, prefixed with `~` when it's an approximation rather than exact. */
export function formatName(hex: string): string {
  const { name, exact } = nearestColorName(hex);
  return exact ? name : `~${name}`;
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/** Pull the numeric components out of a functional notation or bare triple. */
function numericTokens(raw: string): { value: number; percent: boolean }[] {
  const matches = raw.match(/-?\d*\.?\d+\s*%?/g);
  if (!matches) return [];
  return matches
    .map((token) => ({
      value: parseFloat(token),
      percent: token.includes("%"),
    }))
    .filter((t) => Number.isFinite(t.value));
}

/**
 * Hex in any of the shapes people actually paste: with or without `#`, 3, 4, 6
 * or 8 digits. Alpha digits are accepted and dropped — the engine is opaque.
 */
export function parseHex(raw: string): string | null {
  const body = raw.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]+$/.test(body)) return null;

  let six: string;
  if (body.length === 3 || body.length === 4) {
    six = body
      .slice(0, 3)
      .split("")
      .map((c) => c + c)
      .join("");
  } else if (body.length === 6 || body.length === 8) {
    six = body.slice(0, 6);
  } else {
    return null;
  }
  return `#${six.toLowerCase()}`;
}

/** `rgb(1 2 3 / 50%)`, `rgba(1,2,3,.5)`, `50% 20% 100%`, or a bare `1, 2, 3`. */
export function parseRgb(raw: string): string | null {
  const body = raw.trim().replace(/^rgba?\s*\(/i, "").replace(/\)\s*$/, "");
  const tokens = numericTokens(body);
  if (tokens.length < 3) return null;

  const channels = tokens.slice(0, 3).map((t) => {
    const v = t.percent ? (t.value / 100) * 255 : t.value;
    return Math.round(clamp(v, 0, 255));
  });
  return rgbToHex({ r: channels[0], g: channels[1], b: channels[2] });
}

/** `hsl(210, 50%, 40%)`, `hsl(210deg 50% 40% / 80%)`, or a bare `210 50 40`. */
export function parseHsl(raw: string): string | null {
  const body = raw.trim().replace(/^hsla?\s*\(/i, "").replace(/\)\s*$/, "");
  const tokens = numericTokens(body);
  if (tokens.length < 3) return null;

  // Hue may carry a unit; everything else is a percentage of its own range.
  const hueUnit = /-?\d*\.?\d+\s*(deg|grad|rad|turn)/i.exec(body)?.[1]?.toLowerCase();
  let h = tokens[0].value;
  if (hueUnit === "turn") h *= 360;
  else if (hueUnit === "rad") h *= 180 / Math.PI;
  else if (hueUnit === "grad") h *= 0.9;

  const asPercent = (t: { value: number; percent: boolean }) =>
    t.percent || t.value > 1 ? t.value : t.value * 100;

  return hslToHex({ h, s: asPercent(tokens[1]), l: asPercent(tokens[2]) });
}

/** A CSS color keyword. Tolerates spaces, casing, and a leading `~`. */
export function parseName(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/^~/, "").replace(/[\s_-]/g, "");
  return CSS_NAMED_COLORS[key] ?? null;
}

/**
 * Best-effort parse of arbitrary text — what the paste buttons use, so a
 * clipboard holding any notation lands in any field.
 */
export function parseAnyColor(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  if (/^rgba?\s*\(/i.test(text)) return parseRgb(text);
  if (/^hsla?\s*\(/i.test(text)) return parseHsl(text);
  if (text.startsWith("#")) return parseHex(text);

  const named = parseName(text);
  if (named) return named;

  const hex = parseHex(text);
  if (hex) return hex;

  // Bare triples: percent signs read as HSL, plain numbers as RGB.
  const tokens = numericTokens(text);
  if (tokens.length >= 3) {
    const looksHsl = tokens.slice(1, 3).some((t) => t.percent);
    return looksHsl ? parseHsl(text) : parseRgb(text);
  }
  return null;
}

// ── Gamut mapping ─────────────────────────────────────────────────────────────

function isInGamut(lch: LchColor): boolean {
  const { r, g, b } = oklabToLinearRgb(lchToOklab(lch));
  const eps = 1e-4;
  return (
    r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && b >= -eps && b <= 1 + eps
  );
}

/**
 * Pull an OKLCH color back into sRGB by reducing chroma while holding lightness
 * and hue. Naively clamping RGB channels instead would shift the hue, which
 * matters here: a complement whose hue drifts isn't a complement.
 */
export function gamutFitOklch(lch: LchColor): LchColor {
  if (isInGamut(lch)) return lch;

  let lo = 0;
  let hi = lch.C;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (isInGamut({ ...lch, C: mid })) lo = mid;
    else hi = mid;
  }
  return { ...lch, C: lo };
}

export function oklchToHexFitted(lch: LchColor): string {
  return rgbToHex(oklabToRgb(lchToOklab(gamutFitOklch(lch))));
}

// ── Complementary colors ──────────────────────────────────────────────────────

/**
 * The complement of a color: the opposite OKLCH hue at the same lightness and
 * chroma, gamut-mapped back into sRGB. Rotating in OKLCH rather than inverting
 * RGB keeps the pair equally vivid and equally bright.
 *
 * Near-achromatic inputs have no meaningful hue to rotate, so they mirror
 * lightness instead — the useful "opposite" of a grey.
 */
export function complementHex(hex: string): string {
  const lch = oklabToLch(rgbToOklab(hexToRgb(hex)));
  if (lch.C < 0.02) {
    return oklchToHexFitted({ ...lch, L: clamp(1 - lch.L, 0, 1) });
  }
  return oklchToHexFitted({ ...lch, h: (lch.h + 180) % 360 });
}
