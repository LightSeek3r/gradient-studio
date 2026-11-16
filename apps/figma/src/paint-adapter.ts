// ── Figma paint <-> gradient document: pure, no `figma` ──────────────────────
//
// Reads a Figma gradient paint (structurally: any object of that shape, so the
// tests need no Figma) into a core `GradientDocument`, and builds the paint to
// write back. All the maths is core's (`fromFigmaPaint`, `toFigmaPaint`,
// `angleToFigmaTransform`); this module decides what is readable, what is
// skipped and why, and which parts of a layer's paint are kept as they are.
//
// The matrix convention is core's and is NOT verified against Figma (see
// docs/exports.md and docs/figma.md). Writing therefore never builds a new
// `gradientTransform` from an angle: it keeps the layer's own matrix and
// replaces the stops only.

import type { GradientDocument } from '@opal42/gradient'
import { angleToFigmaTransform, fromFigmaPaint, toFigmaPaint } from '@opal42/gradient/export'

export interface PaintStopLike {
  position: number
  color: { r: number; g: number; b: number; a?: number }
  boundVariables?: Record<string, unknown>
}

/** The parts of a Figma `Paint` this plugin reads. */
export interface PaintLike {
  type: string
  visible?: boolean
  opacity?: number
  blendMode?: string
  gradientStops?: readonly PaintStopLike[]
  gradientTransform?: readonly (readonly number[])[]
}

/** A plain `GradientPaint` as the plugin writes it (no proxies, no extra fields). */
export interface PlainGradientPaint {
  type: 'GRADIENT_LINEAR'
  gradientStops: { position: number; color: { r: number; g: number; b: number; a: number } }[]
  gradientTransform: [[number, number, number], [number, number, number]]
  opacity: number
  visible: boolean
  blendMode: string
}

export type PaintSkipCode = 'radial' | 'angular' | 'diamond' | 'variables' | 'invalid'

export type PaintReading =
  /** Solid, image, video, pattern, shader: not a gradient, nothing to say. */
  | { status: 'ignored' }
  | { status: 'skipped'; code: PaintSkipCode; reason: string; paintType: string }
  | {
      status: 'ok'
      /** The gradient as the stops alone describe it (paint opacity left out): what is scored. */
      document: GradientDocument
      /** The same with the paint's opacity multiplied into the stop alphas: what Figma shows. */
      renderDocument: GradientDocument
      paintOpacity: number
      /** `custom` when the handles were moved or skewed away from what the angle alone would give. */
      geometry: 'standard' | 'custom'
      translucent: boolean
    }

export const NON_LINEAR_REASONS: Readonly<Record<'radial' | 'angular' | 'diamond', string>> = {
  radial: 'Radial gradient. Only linear gradients are scored.',
  angular: 'Angular (conic) gradient. Only linear gradients are scored.',
  diamond: 'Diamond gradient. Only linear gradients are scored.',
}

const TYPE_TO_CODE: Readonly<Record<string, 'radial' | 'angular' | 'diamond'>> = {
  GRADIENT_RADIAL: 'radial',
  GRADIENT_ANGULAR: 'angular',
  GRADIENT_DIAMOND: 'diamond',
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Width / height of a box, 1 when either is missing, zero or not finite. */
export function aspectOfBox(width: unknown, height: unknown): number {
  if (typeof width !== 'number' || typeof height !== 'number') return 1
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1
  const a = width / height
  return a >= 1e-3 && a <= 1e3 ? a : 1
}

export function isGradientPaint(paint: unknown): paint is PaintLike {
  return isObj(paint) && typeof paint.type === 'string' && paint.type.startsWith('GRADIENT_')
}

/** A plain copy of the readable fields, so nothing is read from a live proxy twice. */
function snapshot(paint: PaintLike, opacity: number): Record<string, unknown> {
  return {
    type: paint.type,
    opacity,
    gradientTransform: Array.isArray(paint.gradientTransform) ? paint.gradientTransform.map((r) => (Array.isArray(r) ? [...r] : r)) : paint.gradientTransform,
    gradientStops: Array.isArray(paint.gradientStops)
      ? paint.gradientStops.map((s) => (isObj(s) && isObj(s.color) ? { position: s.position, color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a } } : s))
      : paint.gradientStops,
  }
}

function hasBoundVariables(paint: PaintLike): boolean {
  const stops = paint.gradientStops
  if (!Array.isArray(stops)) return false
  return stops.some((s) => isObj(s) && isObj(s.boundVariables) && Object.keys(s.boundVariables).length > 0)
}

const closeTo = (a: number, b: number, eps: number): boolean => Math.abs(a - b) <= eps

/** True when `m` is, within `eps`, the matrix `angleToFigmaTransform` builds for the angle it encodes. */
function isStandardGeometry(m: PaintLike['gradientTransform'], angle: number, aspect: number): boolean {
  const std = angleToFigmaTransform(angle, aspect)
  if (!std || !Array.isArray(m)) return false
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) if (!closeTo(Number(m[r]?.[c]), std[r][c], 1e-3)) return false
  return true
}

/**
 * Read one paint of a layer whose box has aspect ratio `aspect`.
 *
 * Linear paints become documents (angle from `gradientTransform`, hex colours,
 * stop alpha kept); other gradient types, paints with variables bound to a
 * stop (a write would drop the binding) and malformed paints are skipped with
 * a reason; everything else is ignored. Never throws.
 */
export function readPaint(paint: unknown, aspect: number): PaintReading {
  try {
    if (!isGradientPaint(paint)) return { status: 'ignored' }
    const nonLinear = TYPE_TO_CODE[paint.type]
    if (nonLinear) return { status: 'skipped', code: nonLinear, reason: NON_LINEAR_REASONS[nonLinear], paintType: paint.type }
    if (paint.type !== 'GRADIENT_LINEAR') return { status: 'skipped', code: 'invalid', reason: `Unknown gradient type ${paint.type.slice(0, 40)}.`, paintType: 'GRADIENT_LINEAR' }
    if (hasBoundVariables(paint)) {
      return { status: 'skipped', code: 'variables', reason: 'A stop colour is bound to a variable. Applying would unbind it, so this gradient is left alone.', paintType: paint.type }
    }
    const opacity = paint.opacity === undefined ? 1 : paint.opacity
    const bare = fromFigmaPaint(snapshot(paint, 1), { aspect })
    if (bare.status !== 'ok') return { status: 'skipped', code: 'invalid', reason: bare.reason, paintType: paint.type }
    const shown = opacity === 1 ? bare : fromFigmaPaint(snapshot(paint, opacity), { aspect })
    if (shown.status !== 'ok') return { status: 'skipped', code: 'invalid', reason: shown.reason, paintType: paint.type }
    const document = bare.document
    return {
      status: 'ok',
      document,
      renderDocument: shown.document,
      paintOpacity: opacity,
      geometry: isStandardGeometry(paint.gradientTransform, document.angle, aspect) ? 'standard' : 'custom',
      translucent: document.stops.some((s) => s.alpha !== undefined && s.alpha < 1),
    }
  } catch {
    return { status: 'skipped', code: 'invalid', reason: 'The paint could not be read.', paintType: 'GRADIENT_LINEAR' }
  }
}

/** The matrix as plain numbers, or null when it is not a 2x3 array of finite numbers. */
export function readMatrix(m: unknown): PlainGradientPaint['gradientTransform'] | null {
  if (!Array.isArray(m) || m.length !== 2) return null
  const rows: number[][] = []
  for (const r of m as unknown[]) {
    if (!Array.isArray(r) || r.length !== 3 || !r.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
    rows.push([...(r as number[])])
  }
  return [
    [rows[0][0], rows[0][1], rows[0][2]],
    [rows[1][0], rows[1][1], rows[1][2]],
  ]
}

export type BuiltPaint = { status: 'ok'; paint: PlainGradientPaint } | { status: 'error'; reason: string }

/**
 * The paint to write for `document`: its stops (pre-sampled into about `bake`
 * stops along OKLAB when `bake` > 0, else exactly the document's stops), on the
 * layer's own matrix, opacity, visibility and blend mode.
 */
export function buildPaint(original: PaintLike, document: GradientDocument, aspect: number, bake: number): BuiltPaint {
  const matrix = readMatrix(original.gradientTransform)
  if (!matrix) return { status: 'error', reason: 'The layer\'s gradientTransform is not a 2x3 matrix.' }
  const out = toFigmaPaint(document, { aspect, bake })
  if (out.status !== 'ok') return { status: 'error', reason: out.reason }
  return {
    status: 'ok',
    paint: {
      type: 'GRADIENT_LINEAR',
      gradientStops: out.paint.gradientStops.map((s) => ({ position: s.position, color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a } })),
      gradientTransform: matrix,
      opacity: original.opacity === undefined ? 1 : original.opacity,
      visible: original.visible === undefined ? true : original.visible,
      blendMode: original.blendMode === undefined ? 'NORMAL' : original.blendMode,
    },
  }
}

/** Half of one 8-bit step: colours closer than this are the same colour. */
const COLOR_EPS = 0.5 / 255
const POSITION_EPS = 5e-5

/** True when the two stop lists paint the same thing (same count, positions and 8-bit colours). */
export function sameStops(a: readonly PaintStopLike[] | undefined, b: readonly PaintStopLike[] | undefined): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (!closeTo(x.position, y.position, POSITION_EPS)) return false
    const ca = x.color
    const cb = y.color
    if (!closeTo(ca.r, cb.r, COLOR_EPS) || !closeTo(ca.g, cb.g, COLOR_EPS) || !closeTo(ca.b, cb.b, COLOR_EPS)) return false
    if (!closeTo(ca.a === undefined ? 1 : ca.a, cb.a === undefined ? 1 : cb.a, 5e-5)) return false
  }
  return true
}
