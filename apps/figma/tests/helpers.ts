import type { GradientDocument } from '@opal42/gradient'
import { toFigmaPaint } from '@opal42/gradient/export'
import type { HostLike } from '../src/analyze'
import type { PaintLike } from '../src/paint-adapter'

export const RGB_DOC: GradientDocument = {
  kind: 'linear',
  angle: 90,
  stops: [
    { color: '#ff0000', position: 0 },
    { color: '#00ff00', position: 0.5 },
    { color: '#0000ff', position: 1 },
  ],
}

export const SMOOTH_DOC: GradientDocument = {
  kind: 'linear',
  angle: 135,
  stops: [
    { color: '#101b45', position: 0 },
    { color: '#9333ea', position: 1 },
  ],
}

/** A plain GRADIENT_LINEAR paint (what `toFigmaPaint` documents) for a document in a box of the given aspect. */
export function paintFromDoc(doc: GradientDocument, aspect = 1, opts: { bake?: number } = { bake: 0 }): PaintLike & {
  gradientStops: { position: number; color: { r: number; g: number; b: number; a: number } }[]
  gradientTransform: [[number, number, number], [number, number, number]]
} {
  const out = toFigmaPaint(doc, { aspect, ...opts })
  if (out.status !== 'ok') throw new Error(out.reason)
  return JSON.parse(JSON.stringify(out.paint))
}

let counter = 0

export function layer(over: Partial<HostLike> & { fills?: unknown; strokes?: unknown } = {}): HostLike {
  counter++
  return { id: `1:${counter}`, name: `Layer ${counter}`, type: 'RECTANGLE', width: 200, height: 100, fills: [], strokes: [], ...over }
}

/** Link parent pointers the way Figma exposes them. */
export function adopt(parent: HostLike, ...kids: HostLike[]): HostLike {
  parent.children = kids
  for (const k of kids) k.parent = parent
  return parent
}

export const solid = { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }
export const radial = { type: 'GRADIENT_RADIAL', gradientStops: [], gradientTransform: [[1, 0, 0], [0, 1, 0]] }

export const IDENTITY: [[number, number, number], [number, number, number]] = [
  [1, 0, 0],
  [0, 1, 0],
]
