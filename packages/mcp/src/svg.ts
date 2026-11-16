// SVG preview of a linear gradient.
//
// Injection safety by construction: the markup is a fixed template. The only
// values that reach it are
//   - colours, each re-checked against /^#[0-9a-f]{6}$/ (they come from the
//     colour parser's normalised output, never from the caller's text),
//   - numbers, each formatted by `num` and re-checked against a plain decimal
//     pattern (no exponent, no NaN, no text).
// No caller string is ever copied into the document: there is no <title>, no
// id, no text node and no free-form attribute. `emit*` throw when a value
// breaks the allow-list; the handler turns that into an isError result.

import { MAX_PREVIEW_SIZE, MIN_PREVIEW_SIZE } from "./limits";

export interface SvgStop {
  /** `#rrggbb`, lower-case. */
  color: string;
  /** Offset 0-1, non-decreasing. */
  offset: number;
  /** 0-1; omitted or 1 means opaque. */
  alpha?: number;
}

export interface SvgSpec {
  width: number;
  height: number;
  /** CSS degrees. */
  angle: number;
  stops: SvgStop[];
}

const HEX6 = /^#[0-9a-f]{6}$/;
const DECIMAL = /^-?\d{1,12}(\.\d{1,4})?$/;

/** A number as a plain decimal with at most 4 decimals; throws for anything else. */
export function num(value: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) >= 1e12) {
    throw new Error("svg: number out of range");
  }
  let s = value.toFixed(4);
  if (s.includes(".")) s = s.replace(/\.?0+$/, "");
  if (s === "-0" || s === "") s = "0";
  if (!DECIMAL.test(s)) throw new Error("svg: number failed the allow-list");
  return s;
}

/** A colour that is exactly `#rrggbb` in lower case; throws for anything else. */
export function hex(color: string): string {
  if (typeof color !== "string" || !HEX6.test(color)) throw new Error("svg: colour failed the allow-list");
  return color;
}

/** Gradient line end points for a CSS angle in a w x h box (CSS Images 3, "gradient line"). */
export function gradientLine(width: number, height: number, angle: number): { x1: number; y1: number; x2: number; y2: number } {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const length = Math.abs(width * dx) + Math.abs(height * dy);
  const cx = width / 2;
  const cy = height / 2;
  return {
    x1: cx - (dx * length) / 2,
    y1: cy - (dy * length) / 2,
    x2: cx + (dx * length) / 2,
    y2: cy + (dy * length) / 2,
  };
}

/** The SVG document. Throws if a value breaks the allow-list or the size bounds. */
export function renderSvg(spec: SvgSpec): string {
  const { width, height, angle, stops } = spec;
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error("svg: size must be integers");
  if (width < MIN_PREVIEW_SIZE || width > MAX_PREVIEW_SIZE || height < MIN_PREVIEW_SIZE || height > MAX_PREVIEW_SIZE) {
    throw new Error("svg: size out of range");
  }
  if (stops.length < 1 || stops.length > 256) throw new Error("svg: stop count out of range");
  const line = gradientLine(width, height, angle);
  const w = num(width);
  const h = num(height);
  let body = "";
  for (const s of stops) {
    if (!(s.offset >= 0 && s.offset <= 1)) throw new Error("svg: offset out of range");
    body += `<stop offset="${num(s.offset)}" stop-color="${hex(s.color)}"`;
    if (s.alpha !== undefined && s.alpha < 1) {
      if (!(s.alpha >= 0)) throw new Error("svg: alpha out of range");
      body += ` stop-opacity="${num(s.alpha)}"`;
    }
    body += "/>";
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Gradient preview">` +
    `<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${num(line.x1)}" y1="${num(line.y1)}" x2="${num(line.x2)}" y2="${num(line.y2)}">` +
    `${body}</linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#g)"/></svg>`
  );
}

/** Base64 of an ASCII string without Buffer (works in Workers too). */
export function base64Ascii(text: string): string {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 126) throw new Error("svg: non-ASCII output");
  }
  return btoa(text);
}
