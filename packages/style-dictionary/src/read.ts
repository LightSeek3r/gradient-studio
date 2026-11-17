// Reads the value of a gradient token into a core `GradientDocument`.
//
// Accepted shapes (explicit, tested; see docs/style-dictionary.md):
//
//   1. "dtcg-array": an array of `{ color, position }` stops. `color` is a DTCG
//      colour object (`colorSpace` srgb, oklab or oklch) or a CSS colour string
//      (the pre-2025 draft shape); `position` is a number 0-1 (a missing
//      position is accepted and laid out as CSS does). This is the shape
//      `toDtcg` writes, the one Style Dictionary and Terrazzo read, and the one
//      the DTCG 2025.10 report is believed to specify (not verified against
//      the normative text, which was unreachable).
//   2. "css-string": a legacy `$value` that is one CSS linear-gradient(...).
//
// Anything else is a structured skip with a code. Nothing is guessed.

import { parseCssColor, parseGradient, type GradientDocument, type Stop } from "@opal42/gradient";

export const VENDOR_EXTENSION = "io.github.lightseek3r.gradient-studio";
export const EXTENSION_KEY = "opal42";
/** The DTCG gradient type has no angle; this is the angle used when no extension carries one. */
export const DEFAULT_ANGLE = 90;

export type GradientShape = "dtcg-array" | "css-string";

export interface ReadContext {
  /** The token's `$extensions` (or `extensions`) object, if any. */
  extensions?: unknown;
  /** Angle for shapes that carry none. Default 90. */
  angle?: number;
}

export interface StopSource {
  /** How the colour was written, so a rewrite keeps the style. */
  style: "object" | "string";
  /** The colour as `#rrggbb`, whatever it was written as. */
  hex: string;
  /** The stop object as read (kept so a rewrite keeps unknown keys). */
  original: Record<string, unknown>;
}

export interface ReadOk {
  status: "ok";
  shape: GradientShape;
  document: GradientDocument;
  /** dtcg-array only: one entry per document stop. */
  stops?: StopSource[];
  /** Parser warning codes (css-string only). */
  warnings: string[];
}

export interface ReadSkip {
  status: "skipped";
  code: string;
  reason: string;
}

export type ReadResult = ReadOk | ReadSkip;

const skip = (code: string, reason: string): ReadSkip => ({ status: "skipped", code, reason });

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, "0");

function num(v: unknown): number | null {
  if (v === "none") return 0; // CSS: a missing component is 0 when it is not being interpolated
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

type ColorRead = { ok: true; hex: string; alpha: number; style: "object" | "string" } | { ok: false; skip: ReadSkip };

function readColor(c: unknown, i: number): ColorRead {
  const at = `stop ${i + 1}`;
  if (typeof c === "string") {
    const p = parseCssColor(c);
    if (!p) return { ok: false, skip: skip("invalid-color", `${at}: ${JSON.stringify(c)} is not a CSS colour this package can read`) };
    return { ok: true, hex: p.color, alpha: p.alpha, style: "string" };
  }
  if (!isObject(c) || typeof c.colorSpace !== "string" || !Array.isArray(c.components)) {
    return { ok: false, skip: skip("invalid-color", `${at}: colour is neither a CSS string nor a DTCG colour object`) };
  }
  const comps = c.components.map(num);
  const alpha = c.alpha === undefined ? 1 : num(c.alpha);
  if (comps.length !== 3 || comps.some((x) => x === null) || alpha === null) {
    return { ok: false, skip: skip("invalid-color", `${at}: colour components must be three numbers and alpha a number`) };
  }
  const [a, b, d] = comps as [number, number, number];
  switch (c.colorSpace) {
    case "srgb": {
      if ([a, b, d].some((x) => x < 0 || x > 1)) {
        return { ok: false, skip: skip("invalid-color", `${at}: srgb components outside 0-1 are not converted`) };
      }
      return { ok: true, hex: `#${hex2(a * 255)}${hex2(b * 255)}${hex2(d * 255)}`, alpha: Math.min(1, Math.max(0, alpha)), style: "object" };
    }
    case "oklab":
    case "oklch": {
      // Through the strict CSS colour parser (gamut-mapped by chroma reduction when needed).
      const p = parseCssColor(`${c.colorSpace}(${a} ${b} ${d})`);
      if (!p) return { ok: false, skip: skip("invalid-color", `${at}: ${c.colorSpace} colour could not be converted`) };
      return { ok: true, hex: p.color, alpha: Math.min(1, Math.max(0, alpha)), style: "object" };
    }
    default:
      return {
        ok: false,
        skip: skip("unsupported-color-space", `${at}: colour space ${JSON.stringify(c.colorSpace)} is not converted (supported: srgb, oklab, oklch); the "hex" fallback is deliberately not used`),
      };
  }
}

function extensionsOf(ext: unknown): { angle?: number; interpolation?: GradientDocument["interpolation"] } {
  if (!isObject(ext)) return {};
  const vendor = isObject(ext[VENDOR_EXTENSION]) ? (ext[VENDOR_EXTENSION] as Record<string, unknown>) : {};
  const own = isObject(ext[EXTENSION_KEY]) ? (ext[EXTENSION_KEY] as Record<string, unknown>) : {};
  const angleRaw = own.angle ?? vendor.angle;
  const out: { angle?: number; interpolation?: GradientDocument["interpolation"] } = {};
  if (typeof angleRaw === "number" && Number.isFinite(angleRaw)) out.angle = angleRaw;
  const it = vendor.interpolation;
  if (isObject(it) && (it.space === "srgb" || it.space === "oklab" || it.space === "oklch")) {
    const hue = it.hue;
    out.interpolation = {
      space: it.space,
      ...(hue === "shorter" || hue === "longer" || hue === "increasing" || hue === "decreasing" ? { hue } : {}),
    };
  }
  return out;
}

/** True when the token's extensions lock it against `opal42/gradient-refine`. */
export function isLocked(extensions: unknown): boolean {
  return isObject(extensions) && isObject(extensions[EXTENSION_KEY]) && (extensions[EXTENSION_KEY] as Record<string, unknown>).lock === true;
}

export function readGradient(value: unknown, ctx: ReadContext = {}): ReadResult {
  if (typeof value === "string") return readCssString(value);
  if (!Array.isArray(value)) {
    return skip("invalid-shape", `a gradient value must be an array of { color, position } stops or a CSS gradient string, got ${value === null ? "null" : typeof value}`);
  }
  const ext = extensionsOf(ctx.extensions);
  const stops: Stop[] = [];
  const sources: StopSource[] = [];
  for (let i = 0; i < value.length; i++) {
    const s: unknown = value[i];
    if (!isObject(s) || !("color" in s)) return skip("invalid-stop", `stop ${i + 1} is not an object with a "color"`);
    const c = readColor(s.color, i);
    if (!c.ok) return c.skip;
    const stop: Stop = { color: c.hex };
    if (c.alpha < 1) stop.alpha = c.alpha;
    if (s.position !== undefined) {
      if (typeof s.position !== "number" || !Number.isFinite(s.position)) {
        return skip("invalid-position", `stop ${i + 1}: position must be a number 0-1 (got ${JSON.stringify(s.position)})`);
      }
      stop.position = s.position;
    }
    stops.push(stop);
    sources.push({ style: c.style, hex: c.hex, original: s });
  }
  const document: GradientDocument = {
    kind: "linear",
    angle: ext.angle ?? ctx.angle ?? DEFAULT_ANGLE,
    stops,
    ...(ext.interpolation ? { interpolation: ext.interpolation } : {}),
  };
  return { status: "ok", shape: "dtcg-array", document, stops: sources, warnings: [] };
}

function readCssString(text: string): ReadResult {
  const parsed = parseGradient(text);
  const found = parsed.gradients;
  if (found.length === 0) return skip("no-gradient", "the string contains no CSS gradient function");
  const only = found[0];
  if (found.length > 1 || !only) {
    return skip("multiple-gradients", `the string holds ${found.length} gradients; a gradient token holds exactly one`);
  }
  const trimmed = text.trim();
  const start = text.indexOf(trimmed);
  if (only.range.start !== start || only.range.end !== start + trimmed.length) {
    return skip("not-a-single-gradient", "the string has text around the gradient function; a gradient token value is the gradient alone");
  }
  if (only.skipped || !only.document) {
    const sk = only.skipped;
    return skip(sk?.code ?? "syntax", sk?.reason ?? "the gradient could not be read");
  }
  return { status: "ok", shape: "css-string", document: only.document, warnings: only.warnings.map((w) => w.code) };
}
