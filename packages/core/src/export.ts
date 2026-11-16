// ── Subpath `@opal42/gradient/export`: a document as code for other tools ─────
//
// Pure, deterministic, dependency-free, and never throws: a document that
// cannot be exported (invalid, not linear, repeating where the target has no
// such thing) comes back as `{ status: "unsupported", code, reason }`, never
// as garbage text. Every generated token is either a validated colour, a
// finite number printed by `num`, or an identifier passed through `ident`, so
// hostile ids and names cannot inject markup or code.
//
// Box assumption: the document stores a CSS angle, not a box. CSS places the
// gradient line so that the 0% and 100% isolines touch the box corners, which
// depends on the aspect ratio. Targets that take start/end points (SwiftUI,
// Flutter, Compose, Android vector, Godot, Figma, SVG) therefore compute them
// for a box of aspect ratio `aspect` (width / height, default 1 = square).
// The formulas are exact for that box; whether a given toolkit measures
// "perpendicular" in pixels was not verified on device (see docs/exports.md).

import { hexToRgb, isValidStopColor } from "./gradient-engine";
import { toCSS, toCSSWithFallback } from "./api/css";
import { bakeStops, isDocumentLike, resolveStops, sampleGradient, stopAlpha } from "./api/document";
import type { GradientDocument, Interpolation, Stop } from "./api/types";

// ── Result types ──────────────────────────────────────────────────────────────

export type ExportUnsupportedCode =
  | "invalid-document"
  | "unsupported-kind"
  | "repeating"
  | "invalid-input"
  | "unsupported-paint";

/** A document (or paint) this exporter cannot represent; `reason` says why in English. */
export interface ExportUnsupported {
  status: "unsupported";
  code: ExportUnsupportedCode;
  reason: string;
}

/** Display name of the language of a snippet. */
export type ExportLanguage =
  | "CSS"
  | "Tailwind CSS"
  | "SCSS"
  | "SVG"
  | "Swift"
  | "Kotlin"
  | "Dart"
  | "GDScript"
  | "Android XML"
  | "JSON";

export interface ExportText {
  status: "ok";
  text: string;
  language: ExportLanguage;
  /** Short English remarks the UI shows next to the snippet (baking, box assumption, ...). */
  notes: string[];
}

export interface TailwindExport extends ExportText {
  /** `bg-[linear-gradient(...)]`: exactly `toCSS` with spaces as underscores. */
  arbitrary: string;
  /** `bg-linear-135/srgb from-[#..] to-[#..]`; null when the document needs more than three stops. */
  native: string | null;
  /** An `@theme` block defining `--background-image-<name>` (utility `bg-<name>`). */
  theme: string;
  /** An `@utility bg-<name> { ... }` block. */
  utility: string;
}

export interface GodotExport extends ExportText {
  /** The same gradient as a `.tres` Gradient resource. */
  tres: string;
}

export interface AndroidExport extends ExportText {
  /** `shape`: `<shape><gradient>` (three colours at most); `vector`: a VectorDrawable with a gradient fill. */
  variant: "shape" | "vector";
}

/** A 2x3 affine matrix as Figma's `Transform`: `[[a, c, e], [b, d, f]]` (x' = ax + cy + e, y' = bx + dy + f). */
export type FigmaTransform = [[number, number, number], [number, number, number]];

export interface FigmaGradientPaint {
  type: "GRADIENT_LINEAR";
  gradientStops: { position: number; color: { r: number; g: number; b: number; a: number } }[];
  gradientTransform: FigmaTransform;
  opacity: number;
  visible: boolean;
  blendMode: "NORMAL";
}

export interface FigmaExport extends ExportText {
  paint: FigmaGradientPaint;
}

export type ExportOutcome<T extends ExportText = ExportText> = T | ExportUnsupported;

export type FromFigmaResult = { status: "ok"; document: GradientDocument } | ExportUnsupported;

// ── Options ───────────────────────────────────────────────────────────────────

export interface NativeExportOptions {
  /** Width / height of the box the start and end points are computed for. Default 1. */
  aspect?: number;
  /**
   * Pre-sample the gradient into about this many stops (`bakeStops`), so a
   * target that only interpolates in sRGB approximates the document's
   * interpolation space and CSS's premultiplied alpha. `0` turns baking off.
   * Default: 16 (or twice the stop count) when the document interpolates in
   * OKLAB/OKLCH or its stops have different alphas, otherwise none. An explicit
   * number on a document without an interpolation space samples in OKLAB.
   */
  bake?: number;
}

export interface ExportAllOptions extends NativeExportOptions {
  name?: string;
  prefix?: string;
  id?: string;
  width?: number;
  height?: number;
}

export type ExportKey =
  | "css"
  | "css-oklab"
  | "tailwind"
  | "scss"
  | "css-variables"
  | "svg"
  | "swiftui"
  | "compose"
  | "flutter"
  | "godot"
  | "android"
  | "dtcg"
  | "figma";

export interface ExportFormat {
  key: ExportKey;
  /** Tab label. */
  label: string;
  language: ExportLanguage;
  /** True for the native-toolkit targets, which are untested on device. */
  native: boolean;
}

/** Every format of `exportAll`, in display order. The list is stable: new formats are appended. */
export const EXPORT_FORMATS: readonly ExportFormat[] = [
  { key: "css", label: "CSS", language: "CSS", native: false },
  { key: "css-oklab", label: "CSS (OKLAB)", language: "CSS", native: false },
  { key: "tailwind", label: "Tailwind", language: "Tailwind CSS", native: false },
  { key: "scss", label: "SCSS", language: "SCSS", native: false },
  { key: "css-variables", label: "CSS variables", language: "CSS", native: false },
  { key: "svg", label: "SVG", language: "SVG", native: false },
  { key: "swiftui", label: "SwiftUI", language: "Swift", native: true },
  { key: "compose", label: "Compose", language: "Kotlin", native: true },
  { key: "flutter", label: "Flutter", language: "Dart", native: true },
  { key: "godot", label: "Godot", language: "GDScript", native: true },
  { key: "android", label: "Android XML", language: "Android XML", native: true },
  { key: "dtcg", label: "DTCG JSON", language: "JSON", native: false },
  { key: "figma", label: "Figma", language: "JSON", native: true },
];

// ── Small helpers ─────────────────────────────────────────────────────────────

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const printable = (v: unknown): v is number => finite(v) && Math.abs(v) < 1e9;

/** A number with at most `digits` decimals, no trailing zeros, no exponent, never `-0`. */
function num(v: number, digits: number): string {
  const s = v.toFixed(digits);
  const trimmed = s.includes(".") ? s.replace(/\.?0+$/, "") : s;
  return trimmed === "-0" || trimmed === "" ? "0" : trimmed;
}

/** `num` with at least one decimal (Dart and Kotlin float literals). */
function fnum(v: number, digits: number): string {
  const s = num(v, digits);
  return s.includes(".") ? s : `${s}.0`;
}

const unsupported = (code: ExportUnsupportedCode, reason: string): ExportUnsupported => ({ status: "unsupported", code, reason });

/** Run `f`; any exception (a hostile getter, a Proxy) becomes an unsupported result. */
function guard<T extends ExportText>(f: () => ExportOutcome<T>): ExportOutcome<T> {
  try {
    return f();
  } catch {
    return unsupported("invalid-input", "The input could not be read.");
  }
}

/**
 * A lower-case identifier of `[a-z0-9-]`, at most 40 characters, starting with
 * a letter; anything else collapses to `-`. Empty input gives `fallback`.
 */
function ident(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  let s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  if (s === "") return fallback;
  if (!/^[a-z]/.test(s)) s = `g-${s}`.slice(0, 40).replace(/-+$/g, "");
  return s;
}

/** An SVG id: `[A-Za-z][A-Za-z0-9_-]*`, at most 64 characters. */
function svgId(raw: unknown): string {
  if (typeof raw !== "string") return "gradient";
  let s = raw.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^[-_]+|-+$/g, "").slice(0, 64);
  if (s === "") return "gradient";
  if (!/^[A-Za-z]/.test(s)) s = `g-${s}`.slice(0, 64);
  return s;
}

/** A DTCG token name: `[A-Za-z0-9_-]+`, no leading `$`. */
function tokenName(raw: unknown): string {
  if (typeof raw !== "string") return "gradient";
  const s = raw.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return s === "" ? "gradient" : s;
}

function aspectOf(v: unknown): number {
  return finite(v) && v >= 0.01 && v <= 100 ? v : 1;
}

function sizeOf(v: unknown, fallback: number): number {
  return finite(v) && v > 0 && v <= 100000 ? v : fallback;
}

/** Angle normalised to [0, 360), rounded to 6 decimals. */
function normAngle(angle: number): number {
  const a = Math.round((((angle % 360) + 360) % 360) * 1e6) / 1e6;
  return a >= 360 ? 0 : a;
}

const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0").toUpperCase();

/** `#AARRGGBB` (Android, Compose, Flutter). */
function argb(color: string, alpha: number): string {
  const { r, g, b } = hexToRgb(color);
  return `${hex2(alpha * 255)}${hex2(r)}${hex2(g)}${hex2(b)}`;
}

// ── Document validation ───────────────────────────────────────────────────────

interface Checked {
  angle: number;
  interpolation: Interpolation | undefined;
  /** In document order, positions as authored (undefined = automatic). */
  stops: { color: string; alpha: number; position: number | undefined }[];
}

function interpolationOf(doc: GradientDocument): Interpolation | undefined {
  const i = doc.interpolation;
  if (i && (i.space === "srgb" || i.space === "oklab" || i.space === "oklch")) return i;
  return undefined;
}

function check(doc: unknown, allowRepeating: boolean): Checked | ExportUnsupported {
  if (!isDocumentLike(doc)) return unsupported("invalid-document", "Not a gradient document.");
  if (doc.kind !== "linear") return unsupported("unsupported-kind", "Only linear gradients can be exported.");
  if (doc.repeating === true && !allowRepeating)
    return unsupported("repeating", "This format has no repeating gradient; export the CSS instead.");
  if (!printable(doc.angle)) return unsupported("invalid-document", "The angle is not a finite number.");
  if (doc.stops.length < 2) return unsupported("invalid-document", "A gradient needs at least two stops.");
  const stops: Checked["stops"] = [];
  for (const s of doc.stops) {
    const alpha = stopAlpha(s);
    if (!isValidStopColor(s.color) || alpha === null) return unsupported("invalid-document", "A stop has an invalid colour or alpha.");
    if (s.position !== undefined && !printable(s.position)) return unsupported("invalid-document", "A stop position is not a finite number.");
    stops.push({ color: s.color.toLowerCase(), alpha, position: s.position });
  }
  return { angle: doc.angle, interpolation: interpolationOf(doc), stops };
}

const isFailure = (v: unknown): v is ExportUnsupported => (v as { status?: string }).status === "unsupported";

// ── Geometry ──────────────────────────────────────────────────────────────────

export interface GradientLine {
  /** Start point (0% stop) in the unit box, x to the right, y down. */
  x1: number;
  y1: number;
  /** End point (100% stop). */
  x2: number;
  y2: number;
  /** Gradient-line length in box units where the height is 1 (so the width is `aspect`). */
  length: number;
}

/**
 * The CSS gradient line of a `linear-gradient(<angle>deg, ...)` in a box of
 * aspect ratio `aspect` (width / height), in unit-box coordinates (0-1, y
 * down). Per css-images-3 the line passes through the box centre, points along
 * the angle (0deg = up, clockwise) and is `|W sin a| + |H cos a|` long, so the
 * 0% and 100% isolines pass through the corners. For a square, 45deg runs from
 * the bottom-left corner to the top-right one. Returns null for a non-finite
 * angle.
 */
export function cssAngleToLine(angle: number, aspect = 1): GradientLine | null {
  if (!finite(angle)) return null;
  const w = aspectOf(aspect);
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const length = Math.abs(w * dx) + Math.abs(dy);
  return {
    x1: (w / 2 - (dx * length) / 2) / w,
    y1: 0.5 - (dy * length) / 2,
    x2: (w / 2 + (dx * length) / 2) / w,
    y2: 0.5 + (dy * length) / 2,
    length,
  };
}

/**
 * Figma's `gradientTransform` for a linear gradient at the CSS `angle` in a box
 * of aspect ratio `aspect`.
 *
 * Convention (derived from how Figma gradient handles are commonly decoded;
 * NOT verified against Figma itself): the matrix maps a point of the node's
 * unit box (x right, y down, both 0-1) into "gradient space", where the
 * gradient runs along x from 0 (first stop) to 1 (last stop) at y = 0.5. So
 * the identity matrix is a left-to-right gradient, and the handles in the node
 * are `inverse(M) * (0, .5)` and `inverse(M) * (1, .5)`. The matrix is
 * `[[a, c, e], [b, d, f]]` (two rows, three columns; x' = ax + cy + e).
 * Returns null for a non-finite angle.
 */
export function angleToFigmaTransform(angle: number, aspect = 1): FigmaTransform | null {
  const line = cssAngleToLine(angle, aspect);
  if (!line) return null;
  const w = aspectOf(aspect);
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  // Perpendicular (d rotated a quarter turn clockwise on screen): n = (-dy, dx).
  const nx = -dy;
  const ny = dx;
  const L = line.length;
  const sx = line.x1 * w; // start in box units (height = 1)
  const sy = line.y1;
  const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);
  return [
    [clean((dx * w) / L), clean(dy / L), clean(-(dx * sx + dy * sy) / L)],
    [clean((nx * w) / L), clean(ny / L), clean(-(nx * sx + ny * sy) / L + 0.5)],
  ];
}

/**
 * The CSS angle (degrees in [0, 360)) a Figma `gradientTransform` encodes in a
 * box of aspect ratio `aspect`, or null when the matrix is not invertible or
 * not finite. Inverse of `angleToFigmaTransform`.
 */
export function figmaTransformToAngle(m: unknown, aspect = 1): number | null {
  const t = readTransform(m);
  if (!t) return null;
  const [[a, c, e], [b, d, f]] = t;
  const det = a * d - b * c;
  if (!finite(det) || Math.abs(det) < 1e-12) return null;
  // Gradient-space (0, .5) and (1, .5) back into the unit box.
  const inv = (gx: number, gy: number) => {
    const px = gx - e;
    const py = gy - f;
    return { x: (d * px - c * py) / det, y: (-b * px + a * py) / det };
  };
  const p0 = inv(0, 0.5);
  const p1 = inv(1, 0.5);
  const w = aspectOf(aspect);
  const dx = (p1.x - p0.x) * w;
  const dy = p1.y - p0.y;
  if (!finite(dx) || !finite(dy) || (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12)) return null;
  // CSS: direction = (sin a, -cos a)  =>  a = atan2(dx, -dy).
  return normAngle((Math.atan2(dx, -dy) * 180) / Math.PI);
}

function readTransform(m: unknown): FigmaTransform | null {
  if (!Array.isArray(m) || m.length !== 2) return null;
  const rows: number[][] = [];
  for (const r of m as unknown[]) {
    if (!Array.isArray(r) || r.length !== 3 || !r.every(finite)) return null;
    rows.push(r as number[]);
  }
  return [
    [rows[0][0], rows[0][1], rows[0][2]],
    [rows[1][0], rows[1][1], rows[1][2]],
  ];
}

// ── Stops for toolkits that interpolate in sRGB ───────────────────────────────

interface NativeStop {
  position: number;
  color: string;
  alpha: number;
}

interface Native {
  angle: number;
  aspect: number;
  stops: NativeStop[];
  notes: string[];
}

const spaceName = (i: Interpolation): string =>
  i.space === "oklch" ? `OKLCH${i.hue && i.hue !== "shorter" ? `, ${i.hue} hue` : ""}` : i.space === "oklab" ? "OKLAB" : "sRGB";

/**
 * Resolved stops in 0-1, baked when asked (or when sRGB interpolation of the
 * given stops would not match: OKLAB/OKLCH documents, differing alphas), and
 * clipped to the unit interval. The shared front end of every non-CSS target.
 */
function prepareNative(doc: unknown, opts: NativeExportOptions | undefined, label: string): Native | ExportUnsupported {
  const checked = check(doc, false);
  if (isFailure(checked)) return checked;
  const d = doc as GradientDocument;
  const aspect = aspectOf(opts?.aspect);
  const notes: string[] = [];
  const resolved = resolveStops(d);
  const alphas = checked.stops.map((s) => s.alpha);
  const varyingAlpha = alphas.some((a) => a !== alphas[0]);
  const interp = checked.interpolation;
  const wantsSpace = interp !== undefined && interp.space !== "srgb";
  const explicit = opts?.bake !== undefined && finite(opts.bake);
  let n = explicit ? Math.floor(opts?.bake as number) : wantsSpace || varyingAlpha ? Math.max(16, resolved.length * 2) : 0;
  n = Math.max(0, Math.min(n, 256));

  let stops: Stop[] = resolved;
  if (n > resolved.length) {
    const space: Interpolation = interp ?? (explicit ? { space: "oklab" } : { space: "srgb" });
    const baked = bakeSegments(d, resolved, n, space);
    if (baked.length > resolved.length) {
      stops = baked;
      notes.push(
        `Pre-sampled into ${baked.length} stops (${spaceName(space)}, alpha premultiplied) so ${label} approximates the CSS rendering.`,
      );
    }
  } else if (wantsSpace && interp) {
    notes.push(`The document interpolates in ${spaceName(interp)}; ${label} will interpolate in sRGB between these stops. Use the bake option to approximate it.`);
  }

  const list: NativeStop[] = stops.map((s) => ({
    position: s.position as number,
    color: s.color.toLowerCase(),
    alpha: s.alpha === undefined ? 1 : s.alpha,
  }));
  const clipped = clipUnit(list);
  if (clipped.changed) notes.push("Stops outside 0%-100% were clipped to the gradient line.");
  if (aspect !== 1) notes.push(`Start and end points are for a box with aspect ratio ${num(aspect, 4)}:1 (width:height).`);
  else notes.push("Start and end points assume a square box (aspect ratio 1:1); pass an aspect ratio for other boxes.");
  return { angle: checked.angle, aspect, stops: clipped.stops, notes };
}

/**
 * `bakeStops`, but only for the segments where sRGB interpolation of the two
 * end stops would differ from `space` (always for OKLAB/OKLCH; for sRGB only
 * where the alphas differ, because CSS premultiplies and toolkits may not).
 * The extra samples are shared between those segments by length.
 */
function bakeSegments(doc: GradientDocument, stops: Stop[], n: number, space: Interpolation): Stop[] {
  const k = stops.length;
  const needs = (i: number) => space.space !== "srgb" || (stops[i].alpha ?? 1) !== (stops[i + 1].alpha ?? 1);
  const len = (i: number) => (stops[i + 1].position as number) - (stops[i].position as number);
  let total = 0;
  for (let i = 0; i < k - 1; i++) if (needs(i) && len(i) > 0) total += len(i);
  if (total <= 0) return stops;
  const budget = n - k;
  const out: Stop[] = [stops[0]];
  for (let i = 0; i < k - 1; i++) {
    if (needs(i) && len(i) > 0) {
      const extra = Math.max(1, Math.round((budget * len(i)) / total));
      const seg = bakeStops({ ...doc, stops: [stops[i], stops[i + 1]] }, extra + 2, { interpolation: space });
      out.push(...seg.slice(1, seg.length - 1));
    }
    out.push(stops[i + 1]);
  }
  return out;
}

function clipUnit(stops: NativeStop[]): { stops: NativeStop[]; changed: boolean } {
  const first = stops[0].position;
  const last = stops[stops.length - 1].position;
  if (first >= 0 && last <= 1) return { stops: stops.map(round), changed: false };
  const doc: GradientDocument = {
    kind: "linear",
    angle: 0,
    stops: stops.map((s) => ({ color: s.color, alpha: s.alpha, position: s.position })),
  };
  const out: NativeStop[] = [];
  const at = (t: number) => {
    const c = sampleGradient(doc, t, { interpolation: { space: "srgb" } });
    return c ? { position: t, color: c.color, alpha: c.alpha } : null;
  };
  if (first < 0) {
    const s = at(0);
    if (s) out.push(s);
  }
  for (const s of stops) if (s.position >= 0 && s.position <= 1) out.push(s);
  if (last > 1) {
    const s = at(1);
    if (s) out.push(s);
  }
  if (out.length < 2) {
    // Everything lies on one side: a flat colour.
    const c = at(first >= 1 ? 1 : 0) ?? stops[0];
    return { stops: [round({ ...c, position: 0 }), round({ ...c, position: 1 })], changed: true };
  }
  return { stops: out.map(round), changed: true };
}

function round(s: NativeStop): NativeStop {
  return { ...s, position: Math.max(0, Math.min(1, Math.round(s.position * 1e6) / 1e6)) };
}

const rgbOf = (color: string) => hexToRgb(color);

function line(n: Native): GradientLine {
  // check() guaranteed a finite angle.
  return cssAngleToLine(n.angle, n.aspect) as GradientLine;
}

const NATIVE_NOTE = "Untested on device.";
const joinNotes = (n: Native) => [...n.notes, NATIVE_NOTE];

// ── CSS-family formats ────────────────────────────────────────────────────────

function cssColor(color: string, alpha: number): string {
  if (alpha < 1) {
    const { r, g, b } = rgbOf(color);
    return `rgb(${r} ${g} ${b} / ${num(alpha, 4)})`;
  }
  return color;
}

/** Stop position as a CSS percentage, or null when automatic. */
const pct = (p: number | undefined): string | null => (p === undefined ? null : `${num(p * 100, 4)}%`);

function interpolationText(i: Interpolation | undefined): string {
  if (!i || (i.space !== "oklab" && i.space !== "oklch")) return "";
  const hue = i.space === "oklch" && (i.hue === "longer" || i.hue === "increasing" || i.hue === "decreasing") ? ` ${i.hue} hue` : "";
  return ` in ${i.space}${hue}`;
}

/** Tailwind's interpolation modifier (`/oklab`, `/longer`, ...) for the document's interpolation. */
function twModifier(i: Interpolation | undefined): string {
  if (!i || i.space === "srgb") return "srgb";
  if (i.space === "oklab") return "oklab";
  return i.hue === "longer" || i.hue === "increasing" || i.hue === "decreasing" ? i.hue : "oklch";
}

/**
 * Tailwind CSS v4 (checked against the `tailwindcss@4.1.11` source offline,
 * not run in a browser). Four forms:
 *
 * - `arbitrary`: `bg-[linear-gradient(...)]`, spaces as underscores. Exactly
 *   `toCSS(doc)`; works for any number of stops, hard stops, alpha, repeating.
 * - `native`: `bg-linear-<angle>/<space> from-[..] via-[..] to-[..]` plus
 *   `from-<n>%` etc. Only for two or three stops. Tailwind v4's
 *   `bg-linear-<angle>` interpolates in OKLAB by default, so a document with no
 *   interpolation gets the `/srgb` modifier to stay exact. Positions equal to
 *   Tailwind's defaults (0%, 50%, 100%) are omitted. Null when not expressible.
 * - `theme`: `@theme { --background-image-<name>: ... }`, used as `bg-<name>`.
 * - `utility`: `@utility bg-<name> { background-image: ... }`.
 *
 * `name` is reduced to `[a-z0-9-]`. Hostile input cannot add anything else.
 */
export function toTailwind(doc: GradientDocument, opts?: { name?: string }): ExportOutcome<TailwindExport> {
  return guard(() => {
    const checked = check(doc, true);
    if (isFailure(checked)) return checked;
    const css = toCSS(doc);
    if (css === null) return unsupported("invalid-document", "The document has no CSS form.");
    const name = ident(opts?.name, "gradient");
    const arbitrary = `bg-[${css.replace(/, /g, ",").replace(/ /g, "_")}]`;
    const native = doc.repeating === true ? null : nativeTailwind(doc, checked);
    const theme = `@theme {\n  --background-image-${name}: ${css};\n}`;
    const utility = `@utility bg-${name} {\n  background-image: ${css};\n}`;
    const parts = [
      "/* Arbitrary value: exactly the CSS gradient, any Tailwind v4 project. */",
      arbitrary,
    ];
    const notes = ["The arbitrary value is exact. Underscores stand for spaces, as Tailwind expects."];
    if (native) {
      parts.push(
        "",
        "/* Native utilities (two or three stops). bg-linear-<angle> interpolates in OKLAB by default in Tailwind v4; the modifier pins the space. */",
        native,
      );
      notes.push("The native utilities are exact for two or three stops; the /srgb, /oklab or /oklch modifier matches the document.");
    } else if (doc.repeating !== true) {
      notes.push("The native from/via/to utilities express at most three stops, so only the arbitrary value and the theme forms are given.");
    }
    parts.push(
      "",
      `/* Theme variable: use as class "bg-${name}". */`,
      theme,
      "",
      `/* Custom utility: use as class "bg-${name}". */`,
      utility,
    );
    return { status: "ok", text: parts.join("\n"), language: "Tailwind CSS", notes, arbitrary, native, theme, utility };
  });
}

function nativeTailwind(doc: GradientDocument, checked: Checked): string | null {
  if (checked.stops.length > 3) return null;
  const resolved = resolveStops(doc);
  if (resolved.some((s) => (s.position as number) < 0 || (s.position as number) > 1)) return null;
  const angle = normAngle(checked.angle);
  const mod = twModifier(checked.interpolation);
  const interp = interpolationText(checked.interpolation);
  // Integer angles use the named utility; others need the arbitrary angle (which takes no modifier).
  const head = Number.isInteger(angle) ? `bg-linear-${angle}/${mod}` : `bg-linear-[${num(angle, 4)}deg${interp.replace(/ /g, "_")}]`;
  const names = checked.stops.length === 2 ? ["from", "to"] : ["from", "via", "to"];
  const defaults = [0, 0.5, 1];
  const classes: string[] = [head];
  checked.stops.forEach((s, i) => {
    const role = names[i];
    const { r, g, b } = rgbOf(s.color);
    const color = s.alpha < 1 ? `rgb(${r}_${g}_${b}_/_${num(s.alpha, 4)})` : s.color;
    classes.push(`${role}-[${color}]`);
    const p = resolved[i].position as number;
    const dflt = role === "from" ? defaults[0] : role === "via" ? defaults[1] : defaults[2];
    if (Math.abs(p - dflt) > 1e-9) {
      const pctValue = num(p * 100, 4);
      classes.push(/^\d+$/.test(pctValue) ? `${role}-${pctValue}%` : `${role}-[${pctValue}%]`);
    }
  });
  return classes.join(" ");
}

/**
 * Sass variables and a function-free gradient (`$name: linear-gradient(...)`
 * with plain CSS arguments, no Sass functions beyond `rgba()` for translucent
 * stops). Variables: `$<name>-angle`, `$<name>-color-N`, `$<name>-position-N`
 * (only for stops with a position). `name` is reduced to `[a-z0-9-]`.
 */
export function toScss(doc: GradientDocument, opts?: { name?: string }): ExportOutcome {
  return guard(() => {
    const checked = check(doc, true);
    if (isFailure(checked)) return checked;
    const name = ident(opts?.name, "gradient");
    const lines: string[] = [`$${name}-angle: ${num(checked.angle, 4)}deg;`];
    const args: string[] = [];
    checked.stops.forEach((s, i) => {
      const k = i + 1;
      const value = s.alpha < 1 ? `rgba(${s.color}, ${num(s.alpha, 4)})` : s.color;
      lines.push(`$${name}-color-${k}: ${value};`);
      const p = pct(s.position);
      if (p) lines.push(`$${name}-position-${k}: ${p};`);
      args.push(p ? `$${name}-color-${k} $${name}-position-${k}` : `$${name}-color-${k}`);
    });
    const fn = doc.repeating === true ? "repeating-linear-gradient" : "linear-gradient";
    const head = `$${name}-angle${interpolationText(checked.interpolation)}`;
    lines.push("", `$${name}: ${fn}(`, `  ${[head, ...args].join(",\n  ")}`, ");", "", `// Usage: background: $${name};`);
    return { status: "ok", text: lines.join("\n"), language: "SCSS", notes: [] };
  });
}

/**
 * Custom properties on `:root`: `--<prefix>-angle`, `--<prefix>-color-N`,
 * `--<prefix>-position-N` and `--<prefix>` (the gradient built from them).
 * `prefix` is reduced to `[a-z0-9-]`.
 */
export function toCssVariables(doc: GradientDocument, opts?: { prefix?: string }): ExportOutcome {
  return guard(() => {
    const checked = check(doc, true);
    if (isFailure(checked)) return checked;
    const p = ident(opts?.prefix, "gradient");
    const lines: string[] = [":root {", `  --${p}-angle: ${num(checked.angle, 4)}deg;`];
    const args: string[] = [];
    checked.stops.forEach((s, i) => {
      const k = i + 1;
      lines.push(`  --${p}-color-${k}: ${cssColor(s.color, s.alpha)};`);
      const pos = pct(s.position);
      if (pos) lines.push(`  --${p}-position-${k}: ${pos};`);
      args.push(pos ? `var(--${p}-color-${k}) var(--${p}-position-${k})` : `var(--${p}-color-${k})`);
    });
    const fn = doc.repeating === true ? "repeating-linear-gradient" : "linear-gradient";
    lines.push(`  --${p}: ${fn}(var(--${p}-angle)${interpolationText(checked.interpolation)}, ${args.join(", ")});`, "}", "", `/* Usage: background: var(--${p}); */`);
    return { status: "ok", text: lines.join("\n"), language: "CSS", notes: [] };
  });
}

// ── SVG ───────────────────────────────────────────────────────────────────────

/**
 * A standalone SVG with one `<linearGradient>` filling a `width` x `height`
 * rectangle (defaults 512). The CSS angle becomes a `gradientTransform` matrix
 * on a default (objectBoundingBox) gradient: for a box of that aspect ratio the
 * 0% and 100% isolines touch the corners exactly as in CSS. Colours are
 * validated hex; `id` is reduced to `[A-Za-z0-9_-]` starting with a letter.
 * The gradient is only correct for shapes whose bounding box has the given
 * aspect ratio. Repeating gradients are unsupported.
 */
export function toSvg(
  doc: GradientDocument,
  opts?: NativeExportOptions & { width?: number; height?: number; id?: string },
): ExportOutcome {
  return guard(() => {
    let width = sizeOf(opts?.width, 512);
    let height = sizeOf(opts?.height, 512);
    if (width / height < 0.01 || width / height > 100) width = height = 512;
    const n = prepareNative(doc, { ...opts, aspect: width / height }, "SVG");
    if (isFailure(n)) return n;
    const id = svgId(opts?.id);
    const g = line(n);
    const w = n.aspect;
    const m = svgGradientMatrix(n.angle, g, w);
    const stops = n.stops
      .map((s) => {
        const op = s.alpha < 1 ? ` stop-opacity="${num(s.alpha, 4)}"` : "";
        return `      <stop offset="${num(s.position, 5)}" stop-color="${s.color}"${op}/>`;
      })
      .join("\n");
    const W = num(width, 4);
    const H = num(height, 4);
    const text = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
      "  <defs>",
      `    <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0" gradientTransform="matrix(${m.map((v) => num(v, 6)).join(" ")})">`,
      stops,
      "    </linearGradient>",
      "  </defs>",
      `  <rect width="${W}" height="${H}" fill="url(#${id})"/>`,
      "</svg>",
    ].join("\n");
    const notes = [
      ...n.notes.filter((x) => !x.startsWith("Start and end")),
      `The gradient geometry is exact for a shape with a ${num(width, 2)} x ${num(height, 2)} bounding box (aspect ratio ${num(n.aspect, 4)}).`,
    ];
    return { status: "ok", text, language: "SVG", notes };
  });
}

/**
 * SVG `matrix(a b c d e f)` taking the default bounding-box gradient vector
 * (0,0)->(1,0) onto the CSS gradient line: g -> S + L (g_x d + g_y n), then
 * into box fractions.
 */
function svgGradientMatrix(angle: number, g: GradientLine, w: number): number[] {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const L = g.length;
  const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);
  // Column vectors: x axis -> L*d, y axis -> L*n with n = (-dy, dx); box fractions divide by (w, 1).
  return [clean((L * dx) / w), clean(L * dy), clean((L * -dy) / w), clean(L * dx), clean(g.x1), clean(g.y1)];
}

// ── Native toolkits ───────────────────────────────────────────────────────────

/**
 * SwiftUI `LinearGradient(stops:startPoint:endPoint:)`. Colours are sRGB
 * (`Color(.sRGB, ...)`); start and end are `UnitPoint`s of the CSS gradient
 * line for a box of aspect ratio `aspect`. Untested on device; how SwiftUI
 * interpolates between stops, and whether a perceptual colour space option
 * applies, was not verified, which is why OKLAB/OKLCH documents are pre-sampled.
 */
export function toSwiftUI(doc: GradientDocument, opts?: NativeExportOptions): ExportOutcome {
  return guard(() => {
    const n = prepareNative(doc, opts, "SwiftUI");
    if (isFailure(n)) return n;
    const g = line(n);
    const stops = n.stops.map((s) => {
      const { r, gr, b } = chan(s.color);
      return `        Gradient.Stop(color: Color(.sRGB, red: ${r} / 255, green: ${gr} / 255, blue: ${b} / 255, opacity: ${num(s.alpha, 4)}), location: ${num(s.position, 5)}),`;
    });
    const text = [
      "import SwiftUI",
      "",
      "// Untested on device. Stop colours are given in sRGB.",
      `// Start and end points are the CSS gradient line of ${num(normAngle(n.angle), 4)}deg in a box with aspect ratio ${num(n.aspect, 4)}:1 (width:height).`,
      "let gradient = LinearGradient(",
      "    stops: [",
      ...stops,
      "    ],",
      `    startPoint: UnitPoint(x: ${num(g.x1, 5)}, y: ${num(g.y1, 5)}),`,
      `    endPoint: UnitPoint(x: ${num(g.x2, 5)}, y: ${num(g.y2, 5)})`,
      ")",
    ].join("\n");
    return { status: "ok", text, language: "Swift", notes: joinNotes(n) };
  });
}

function chan(color: string): { r: number; gr: number; b: number } {
  const { r, g, b } = rgbOf(color);
  return { r, gr: g, b };
}

/**
 * Jetpack Compose `Brush.linearGradient(colorStops, start, end)` with pixel
 * offsets for a `width` x `height` reference box (default 1000 x 1000), plus a
 * size-independent `ShaderBrush` that recomputes the CSS gradient line from the
 * angle for whatever size it is drawn at. Untested on device; the colour space
 * Compose interpolates in was not verified.
 */
export function toCompose(
  doc: GradientDocument,
  opts?: NativeExportOptions & { width?: number; height?: number },
): ExportOutcome {
  return guard(() => {
    let width = sizeOf(opts?.width, 1000);
    let height = sizeOf(opts?.height, 1000);
    if (width / height < 0.01 || width / height > 100) width = height = 1000;
    const n = prepareNative(doc, { ...opts, aspect: width / height }, "Compose");
    if (isFailure(n)) return n;
    const g = line(n);
    const stops = n.stops.map((s) => `        ${fnum(s.position, 5)}f to Color(0x${argb(s.color, s.alpha)}),`);
    const colors = n.stops.map((s) => `Color(0x${argb(s.color, s.alpha)})`).join(", ");
    const offsets = n.stops.map((s) => `${fnum(s.position, 5)}f`).join(", ");
    const angle = num(normAngle(n.angle), 6);
    const text = [
      "import androidx.compose.ui.geometry.Offset",
      "import androidx.compose.ui.geometry.Size",
      "import androidx.compose.ui.graphics.Brush",
      "import androidx.compose.ui.graphics.Color",
      "import androidx.compose.ui.graphics.LinearGradientShader",
      "import androidx.compose.ui.graphics.Shader",
      "import androidx.compose.ui.graphics.ShaderBrush",
      "import kotlin.math.abs",
      "import kotlin.math.cos",
      "import kotlin.math.sin",
      "",
      "// Untested on device.",
      `// Offsets are pixels of a ${num(width, 2)} x ${num(height, 2)} box, the CSS gradient line of ${angle}deg.`,
      "val gradientBrush = Brush.linearGradient(",
      "    colorStops = arrayOf(",
      ...stops,
      "    ),",
      `    start = Offset(${fnum(g.x1 * width, 3)}f, ${fnum(g.y1 * height, 3)}f),`,
      `    end = Offset(${fnum(g.x2 * width, 3)}f, ${fnum(g.y2 * height, 3)}f),`,
      ")",
      "",
      "// Size-independent variant: recomputes the CSS gradient line for the size it is drawn at.",
      "val gradientShaderBrush = object : ShaderBrush() {",
      "    override fun createShader(size: Size): Shader {",
      `        val radians = Math.toRadians(${fnum(normAngle(n.angle), 6)})`,
      "        val dx = sin(radians).toFloat()",
      "        val dy = -cos(radians).toFloat()",
      "        val length = abs(size.width * dx) + abs(size.height * dy)",
      "        val center = Offset(size.width / 2f, size.height / 2f)",
      "        val half = Offset(dx * length / 2f, dy * length / 2f)",
      "        return LinearGradientShader(",
      "            from = center - half,",
      "            to = center + half,",
      `            colors = listOf(${colors}),`,
      `            colorStops = listOf(${offsets}),`,
      "        )",
      "    }",
      "}",
    ].join("\n");
    const notes = [...n.notes.filter((x) => !x.startsWith("Start and end")), `Offsets are pixels of a ${num(width, 2)} x ${num(height, 2)} box; the ShaderBrush variant adapts to any size.`, NATIVE_NOTE];
    return { status: "ok", text, language: "Kotlin", notes };
  });
}

/**
 * Flutter `LinearGradient(begin, end, colors, stops)`. `begin` and `end` are
 * `Alignment`s (-1..1 from the box centre) by default, or `FractionalOffset`s
 * (0..1 from the top-left) with `alignment: "fractionalOffset"`. Untested on
 * device.
 */
export function toFlutter(
  doc: GradientDocument,
  opts?: NativeExportOptions & { alignment?: "alignment" | "fractionalOffset" },
): ExportOutcome {
  return guard(() => {
    const n = prepareNative(doc, opts, "Flutter");
    if (isFailure(n)) return n;
    const g = line(n);
    const frac = opts?.alignment === "fractionalOffset";
    const point = (x: number, y: number) =>
      frac ? `FractionalOffset(${fnum(x, 5)}, ${fnum(y, 5)})` : `Alignment(${fnum(2 * x - 1, 5)}, ${fnum(2 * y - 1, 5)})`;
    const text = [
      "import 'package:flutter/material.dart';",
      "",
      "// Untested on device.",
      `// begin and end are the CSS gradient line of ${num(normAngle(n.angle), 4)}deg in a box with aspect ratio ${num(n.aspect, 4)}:1 (width:height).`,
      "const gradient = LinearGradient(",
      `  begin: ${point(g.x1, g.y1)},`,
      `  end: ${point(g.x2, g.y2)},`,
      "  colors: [",
      ...n.stops.map((s) => `    Color(0x${argb(s.color, s.alpha)}),`),
      "  ],",
      `  stops: [${n.stops.map((s) => fnum(s.position, 5)).join(", ")}],`,
      ");",
    ].join("\n");
    return { status: "ok", text, language: "Dart", notes: joinNotes(n) };
  });
}

/**
 * Godot 4: GDScript building a `Gradient` (offsets and colours as packed
 * arrays) and a `GradientTexture2D` with a linear fill between two points, plus
 * the Gradient as a `.tres` resource. Untested in Godot. The Gradient's
 * interpolation mode is left at its default; whether the linear fill is
 * measured in pixels or in texture coordinates was not verified, so non-square
 * textures may differ from CSS.
 */
export function toGodot(doc: GradientDocument, opts?: NativeExportOptions): ExportOutcome<GodotExport> {
  return guard(() => {
    const n = prepareNative(doc, opts, "Godot");
    if (isFailure(n)) return n;
    const g = line(n);
    const offsets = n.stops.map((s) => fnum(s.position, 5)).join(", ");
    const colors = n.stops
      .map((s) => {
        const { r, gr, b } = chan(s.color);
        return `Color8(${r}, ${gr}, ${b}${s.alpha < 1 ? `, ${Math.round(s.alpha * 255)}` : ""})`;
      })
      .join(", ");
    const side = 256;
    const text = [
      "# Untested in Godot.",
      "# The Gradient interpolates linearly between its points (interpolation_mode is left at its default).",
      `# fill_from and fill_to are the CSS gradient line of ${num(normAngle(n.angle), 4)}deg in a box with aspect ratio ${num(n.aspect, 4)}:1 (width:height).`,
      "var gradient := Gradient.new()",
      `gradient.offsets = PackedFloat32Array([${offsets}])`,
      `gradient.colors = PackedColorArray([${colors}])`,
      "",
      "var texture := GradientTexture2D.new()",
      "texture.gradient = gradient",
      "texture.fill = GradientTexture2D.FILL_LINEAR",
      `texture.fill_from = Vector2(${fnum(g.x1, 5)}, ${fnum(g.y1, 5)})`,
      `texture.fill_to = Vector2(${fnum(g.x2, 5)}, ${fnum(g.y2, 5)})`,
      `texture.width = ${Math.round(side * Math.max(1, n.aspect))}`,
      `texture.height = ${Math.round(side * Math.max(1, 1 / n.aspect))}`,
    ].join("\n");
    const flat = n.stops
      .map((s) => {
        const { r, g: gg, b } = rgbOf(s.color);
        return [r, gg, b].map((v) => num(v / 255, 6)).concat(num(s.alpha, 4)).join(", ");
      })
      .join(", ");
    const tres = [
      "[gd_resource type=\"Gradient\" format=3]",
      "",
      "[resource]",
      `offsets = PackedFloat32Array(${n.stops.map((s) => num(s.position, 5)).join(", ")})`,
      `colors = PackedColorArray(${flat})`,
    ].join("\n");
    return { status: "ok", text, language: "GDScript", notes: joinNotes(n), tres };
  });
}

/**
 * Android. With two or three stops at 0 (, 50%) and 100% and an angle that is
 * a multiple of 45: `<shape><gradient>` with `startColor`/`centerColor`/
 * `endColor` (`android:angle` = 90 - CSS angle, counter-clockwise from
 * left-to-right). Anything else: a `VectorDrawable` whose path has a linear
 * gradient fill with `<item offset color>` stops and start/end points for a
 * 100-unit-high viewport of the given aspect ratio (variant `vector`).
 * Untested on device. Not verified: how a `<shape>` gradient places a 45-degree
 * line in a non-square view (it may run corner to corner rather than at 45
 * degrees), and the minimum API level of the vector form.
 */
export function toAndroidXml(doc: GradientDocument, opts?: NativeExportOptions): ExportOutcome<AndroidExport> {
  return guard(() => {
    const n = prepareNative(doc, opts, "Android");
    if (isFailure(n)) return n;
    const angle = normAngle(n.angle);
    const s = n.stops;
    const simple =
      s.length <= 3 &&
      angle % 45 === 0 &&
      s[0].position === 0 &&
      s[s.length - 1].position === 1 &&
      (s.length === 2 || s[1].position === 0.5);
    if (simple) {
      const droid = (((90 - angle) % 360) + 360) % 360;
      const parts = [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<!-- Untested on device. android:angle is counter-clockwise from left-to-right: 90 minus the CSS angle. -->",
        '<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">',
        "    <gradient",
        '        android:type="linear"',
        `        android:angle="${droid}"`,
        `        android:startColor="#${argb(s[0].color, s[0].alpha)}"`,
        ...(s.length === 3 ? [`        android:centerColor="#${argb(s[1].color, s[1].alpha)}"`] : []),
        `        android:endColor="#${argb(s[s.length - 1].color, s[s.length - 1].alpha)}" />`,
        "</shape>",
      ];
      return { status: "ok", text: parts.join("\n"), language: "Android XML", notes: joinNotes(n), variant: "shape" };
    }
    const g = line(n);
    const vw = 100 * n.aspect;
    const f = (v: number) => num(v, 3);
    const parts = [
      '<?xml version="1.0" encoding="utf-8"?>',
      "<!-- Untested on device. A shape gradient cannot hold this many stops, positions or this angle, so the gradient is a VectorDrawable fill. -->",
      `<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt"`,
      `    android:width="${f(vw)}dp"`,
      '    android:height="100dp"',
      `    android:viewportWidth="${f(vw)}"`,
      '    android:viewportHeight="100">',
      `    <path android:pathData="M0,0h${f(vw)}v100h-${f(vw)}z">`,
      '        <aapt:attr name="android:fillColor">',
      "            <gradient",
      '                android:type="linear"',
      `                android:startX="${f(g.x1 * vw)}"`,
      `                android:startY="${f(g.y1 * 100)}"`,
      `                android:endX="${f(g.x2 * vw)}"`,
      `                android:endY="${f(g.y2 * 100)}">`,
      ...s.map((x) => `                <item android:offset="${num(x.position, 5)}" android:color="#${argb(x.color, x.alpha)}" />`),
      "            </gradient>",
      "        </aapt:attr>",
      "    </path>",
      "</vector>",
    ];
    return { status: "ok", text: parts.join("\n"), language: "Android XML", notes: joinNotes(n), variant: "vector" };
  });
}

// ── Design tokens and Figma ───────────────────────────────────────────────────

/**
 * A W3C Design Tokens (DTCG) token of `$type: "gradient"`.
 *
 * UNVERIFIED against the normative text: this was written from memory of the
 * 2025.10 Format Module (the spec was not available offline). The shape is the
 * commonly implemented one: `$value` is an array of `{ color, position }` with
 * `position` in 0-1 and `color` a 2025.10 colour object
 * (`{ colorSpace: "srgb", components: [r, g, b], alpha, hex }`, components 0-1)
 * or, with `colorFormat: "hex"`, a hex string for older tools. DTCG gradients
 * carry no angle, so the angle and interpolation travel in a vendor
 * `$extensions` entry. `name` is reduced to `[A-Za-z0-9_-]`.
 */
export function toDtcg(doc: GradientDocument, opts?: NativeExportOptions & { name?: string; colorFormat?: "object" | "hex" }): ExportOutcome {
  return guard(() => {
    const n = prepareNative(doc, opts, "the token consumer");
    if (isFailure(n)) return n;
    const asHex = opts?.colorFormat === "hex";
    const value = n.stops.map((s) => {
      const { r, g, b } = rgbOf(s.color);
      const color = asHex
        ? s.alpha < 1
          ? `#${s.color.slice(1)}${hex2(s.alpha * 255).toLowerCase()}`
          : s.color
        : {
            colorSpace: "srgb",
            components: [r, g, b].map((v) => Math.round((v / 255) * 1e6) / 1e6),
            alpha: Math.round(s.alpha * 1e4) / 1e4,
            hex: s.color,
          };
      return { color, position: Math.round(s.position * 1e5) / 1e5 };
    });
    const token = {
      $type: "gradient",
      $value: value,
      $description: "Linear gradient exported by @opal42/gradient.",
      $extensions: {
        "io.github.lightseek3r.gradient-studio": {
          angle: Math.round(normAngle(n.angle) * 1e4) / 1e4,
          ...(interpolationOf(doc as GradientDocument) ? { interpolation: interpolationOf(doc as GradientDocument) } : {}),
        },
      },
    };
    const text = compactJson({ [tokenName(opts?.name)]: token });
    const notes = [
      "Unverified against the normative DTCG text: the commonly implemented array of { color, position } stops.",
      "DTCG gradients carry no angle; it is kept in $extensions.",
      ...n.notes.filter((x) => !x.startsWith("Start and end") && !x.startsWith("Stops outside")),
    ];
    return { status: "ok", text, language: "JSON", notes };
  });
}

/**
 * A Figma `GradientPaint` (type `GRADIENT_LINEAR`): `gradientStops` with RGBA
 * in 0-1 and a `gradientTransform` from `angleToFigmaTransform`. Figma has no
 * OKLAB/OKLCH interpolation, so a document that asks for one is pre-sampled
 * into stops (`bake`, default 16 in that case) and the render approximates it.
 * The transform convention is derived, not verified against Figma.
 */
export function toFigmaPaint(doc: GradientDocument, opts?: NativeExportOptions): ExportOutcome<FigmaExport> {
  return guard(() => {
    const n = prepareNative(doc, opts, "Figma");
    if (isFailure(n)) return n;
    const transform = angleToFigmaTransform(n.angle, n.aspect) as FigmaTransform;
    const paint: FigmaGradientPaint = {
      type: "GRADIENT_LINEAR",
      gradientStops: n.stops.map((s) => {
        const { r, g, b } = rgbOf(s.color);
        const c = (v: number) => Math.round((v / 255) * 1e6) / 1e6;
        return { position: s.position, color: { r: c(r), g: c(g), b: c(b), a: Math.round(s.alpha * 1e4) / 1e4 } };
      }),
      gradientTransform: [
        [roundT(transform[0][0]), roundT(transform[0][1]), roundT(transform[0][2])],
        [roundT(transform[1][0]), roundT(transform[1][1]), roundT(transform[1][2])],
      ],
      opacity: 1,
      visible: true,
      blendMode: "NORMAL",
    };
    const notes = [
      "Paste into a plugin as node.fills = [paint]. Figma has no OKLAB interpolation; use the bake option to approximate it.",
      "The gradientTransform convention is derived, not verified against Figma.",
      ...joinNotes(n),
    ];
    return { status: "ok", text: compactJson(paint), language: "JSON", notes, paint };
  });
}

/** JSON with two-space indentation, but arrays of numbers on one line. */
function compactJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/\[\s*(-?[\d.e+-]+(?:,\s*-?[\d.e+-]+)*)\s*\]/g, (_m, inner: string) => `[${inner.replace(/\s+/g, " ")}]`);
}

const roundT = (v: number) => Math.round(v * 1e9) / 1e9;

/**
 * The inverse of `toFigmaPaint`: a `GRADIENT_LINEAR` paint (any object of that
 * shape) back to a document, for a box of aspect ratio `opts.aspect`. Stops
 * with positions outside 0-1, a non-linear type, a singular transform or
 * colour channels outside 0-1 give an unsupported result. A paint `opacity`
 * below 1 multiplies every stop's alpha.
 */
export function fromFigmaPaint(paint: unknown, opts?: { aspect?: number }): FromFigmaResult {
  try {
    const p = paint as {
      type?: unknown;
      gradientStops?: unknown;
      gradientTransform?: unknown;
      opacity?: unknown;
    } | null;
    if (typeof p !== "object" || p === null) return unsupported("invalid-input", "Not a paint object.");
    if (p.type !== "GRADIENT_LINEAR") return unsupported("unsupported-paint", "Only GRADIENT_LINEAR paints can be read.");
    if (!Array.isArray(p.gradientStops) || p.gradientStops.length < 2) return unsupported("invalid-input", "A gradient paint needs at least two stops.");
    const opacity = p.opacity === undefined ? 1 : finite(p.opacity) && p.opacity >= 0 && p.opacity <= 1 ? p.opacity : null;
    if (opacity === null) return unsupported("invalid-input", "The paint opacity is not a number in 0-1.");
    const angle = figmaTransformToAngle(p.gradientTransform, aspectOf(opts?.aspect));
    if (angle === null) return unsupported("invalid-input", "The gradientTransform is missing, not finite or not invertible.");
    const stops: Stop[] = [];
    for (const raw of p.gradientStops as unknown[]) {
      const s = raw as { position?: unknown; color?: { r?: unknown; g?: unknown; b?: unknown; a?: unknown } } | null;
      if (typeof s !== "object" || s === null || typeof s.color !== "object" || s.color === null) return unsupported("invalid-input", "A gradient stop is malformed.");
      const { r, g, b } = s.color;
      const a = s.color.a === undefined ? 1 : s.color.a;
      if (!finite(s.position) || s.position < 0 || s.position > 1) return unsupported("invalid-input", "A stop position is not a number in 0-1.");
      if (![r, g, b, a].every((v) => finite(v) && v >= 0 && v <= 1)) return unsupported("invalid-input", "A stop colour channel is not a number in 0-1.");
      const alpha = Math.round((a as number) * opacity * 1e4) / 1e4;
      const stop: Stop = {
        color: `#${[r, g, b].map((v) => hex2((v as number) * 255).toLowerCase()).join("")}`,
        position: Math.round(s.position * 1e6) / 1e6,
      };
      if (alpha < 1) stop.alpha = alpha;
      stops.push(stop);
    }
    return { status: "ok", document: { kind: "linear", angle, stops } };
  } catch {
    return unsupported("invalid-input", "The paint could not be read.");
  }
}

// ── Everything at once ────────────────────────────────────────────────────────

function cssBlock(doc: GradientDocument): ExportOutcome {
  const checked = check(doc, true);
  if (isFailure(checked)) return checked;
  const css = toCSS(doc);
  if (css === null) return unsupported("invalid-document", "The document has no CSS form.");
  return { status: "ok", text: `background: ${css};`, language: "CSS", notes: [] };
}

function cssOklab(doc: GradientDocument): ExportOutcome {
  const checked = check(doc, true);
  if (isFailure(checked)) return checked;
  const css = toCSSWithFallback(doc);
  if (css === null) return unsupported("invalid-document", "The document has no CSS form.");
  const target = checked.interpolation?.space === "srgb" ? "sRGB" : "OKLAB or OKLCH";
  return {
    status: "ok",
    text: css,
    language: "CSS",
    notes: [
      `The first declaration is a plain sRGB gradient pre-sampled along the target space. The second interpolates in ${target} natively; browsers that do not understand the "in" clause ignore it and keep the first.`,
    ],
  };
}

/**
 * Every format of `EXPORT_FORMATS`, keyed by `ExportKey`, for a UI that shows
 * them all. Each value is an `ExportText` or an `ExportUnsupported`; the
 * Tailwind, Godot, Android and Figma values carry extra fields (see their
 * functions). Pure; never throws.
 */
export function exportAll(doc: GradientDocument, opts?: ExportAllOptions): Record<ExportKey, ExportOutcome> {
  const o = opts ?? {};
  return {
    css: guard(() => cssBlock(doc)),
    "css-oklab": guard(() => cssOklab(doc)),
    tailwind: toTailwind(doc, { name: o.name }),
    scss: toScss(doc, { name: o.name }),
    "css-variables": toCssVariables(doc, { prefix: o.prefix }),
    svg: toSvg(doc, { width: o.width, height: o.height, id: o.id, bake: o.bake }),
    swiftui: toSwiftUI(doc, o),
    compose: toCompose(doc, { width: o.width, height: o.height, bake: o.bake }),
    flutter: toFlutter(doc, o),
    godot: toGodot(doc, o),
    android: toAndroidXml(doc, o),
    dtcg: toDtcg(doc, { name: o.name, aspect: o.aspect, bake: o.bake }),
    figma: toFigmaPaint(doc, o),
  };
}
