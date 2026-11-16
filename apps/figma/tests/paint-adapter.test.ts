import { describe, expect, it } from 'vitest'
import { angleToFigmaTransform } from '@opal42/gradient/export'
import { aspectOfBox, buildPaint, isGradientPaint, readMatrix, readPaint, sameStops, type PaintLike } from '../src/paint-adapter'
import { IDENTITY, RGB_DOC, SMOOTH_DOC, paintFromDoc, radial, solid } from './helpers'

const stop = (position: number, r: number, g: number, b: number, a?: number) => ({ position, color: a === undefined ? { r, g, b } : { r, g, b, a } })

function linear(transform: unknown, extra: Partial<PaintLike> = {}): PaintLike {
  return { type: 'GRADIENT_LINEAR', gradientTransform: transform as PaintLike['gradientTransform'], gradientStops: [stop(0, 1, 0, 0), stop(1, 0, 0, 1)], ...extra }
}

function ok(r: ReturnType<typeof readPaint>) {
  if (r.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`)
  return r
}

/** CSS angle of a matrix, derived here from the inverse of its linear part (independent of core). */
function expectedAngle(m: number[][], aspect: number): number {
  const [[a, c], [b, d]] = m
  const det = a * d - b * c
  const dx = (d / det) * aspect // the gradient axis (1, 0) pulled back into the box, in pixels
  const dy = -b / det
  return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360
}

describe('readPaint: round trips with core', () => {
  const angles = [0, 17, 45, 90, 135, 180, 225, 270, 315, 359]
  const aspects = [1, 2, 0.5, 16 / 9, 3]
  for (const aspect of aspects) {
    it(`angle -> paint -> angle at aspect ${aspect.toFixed(2)}`, () => {
      for (const angle of angles) {
        const doc = { ...SMOOTH_DOC, angle }
        const r = ok(readPaint(paintFromDoc(doc, aspect), aspect))
        const diff = Math.abs(((r.document.angle - angle + 540) % 360) - 180)
        expect(diff).toBeLessThan(1e-6)
        expect(r.geometry).toBe('standard')
      }
    })
  }

  it('keeps stop positions and 8-bit colours', () => {
    const doc = { ...RGB_DOC, stops: [{ color: '#ff0000', position: 0.1 }, { color: '#00ff00', position: 0.55 }, { color: '#0000ff', position: 0.9 }] }
    const r = ok(readPaint(paintFromDoc(doc), 1))
    expect(r.document.stops.map((s) => [s.color, s.position])).toEqual([['#ff0000', 0.1], ['#00ff00', 0.55], ['#0000ff', 0.9]])
  })

  it('rounds Figma float channels to the nearest 8-bit hex', () => {
    const r = ok(readPaint(linear(IDENTITY, { gradientStops: [stop(0, 0.2, 0.4, 0.6), stop(1, 1, 1, 0.999)] }), 1))
    expect(r.document.stops.map((s) => s.color)).toEqual(['#336699', '#fffffe'.replace('fe', 'ff')])
  })

  it('does not mutate the paint it reads', () => {
    const paint = paintFromDoc(RGB_DOC)
    const before = JSON.stringify(paint)
    readPaint(paint, 1)
    expect(JSON.stringify(paint)).toBe(before)
  })
})

describe('readPaint: non-trivial gradientTransform matrices', () => {
  const cases: { name: string; m: number[][]; aspect: number; angle?: number }[] = [
    { name: 'identity is left to right', m: [[1, 0, 0], [0, 1, 0]], aspect: 1, angle: 90 },
    { name: 'a quarter turn runs top to bottom', m: [[0, 1, 0], [-1, 0, 1]], aspect: 1, angle: 180 },
    { name: 'both axes flipped runs right to left', m: [[-1, 0, 1], [0, -1, 1]], aspect: 1, angle: 270 },
    { name: 'a quarter turn the other way runs bottom to top', m: [[0, -1, 1], [1, 0, 0]], aspect: 1, angle: 0 },
    { name: 'horizontal flip on a 3:1 box', m: [[-1, 0, 1], [0, 1, 0]], aspect: 3, angle: 270 },
    { name: 'rotated by 30 degrees', m: [[Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0.2], [-Math.sin(Math.PI / 6), Math.cos(Math.PI / 6), 0.3]], aspect: 1 },
    { name: 'rotated by 30 degrees on a 2:1 box', m: [[Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0.2], [-Math.sin(Math.PI / 6), Math.cos(Math.PI / 6), 0.3]], aspect: 2 },
    { name: 'scaled non-uniformly (handles pulled in)', m: [[2, 0, -0.5], [0, 1, 0]], aspect: 1, angle: 90 },
    { name: 'scaled non-uniformly and rotated', m: [[1, 1, -0.5], [-1, 1, 0]], aspect: 2, angle: 116.565051 },
    { name: 'skewed', m: [[1, 0.6, -0.1], [0, 1, 0]], aspect: 1 },
    { name: 'flipped and scaled on a tall box', m: [[0, 2, -0.5], [-1, 0, 1]], aspect: 0.4 },
  ]
  for (const c of cases) {
    it(c.name, () => {
      const r = ok(readPaint(linear(c.m), c.aspect))
      expect(r.document.angle).toBeCloseTo(expectedAngle(c.m, c.aspect), 6)
      if (c.angle !== undefined) expect(r.document.angle).toBeCloseTo(c.angle, 4)
    })
  }

  it('labels the geometry custom when the handles are not what the angle alone gives', () => {
    expect(ok(readPaint(linear([[2, 0, -0.5], [0, 1, 0]]), 1)).geometry).toBe('custom')
    expect(ok(readPaint(linear([[1, 0.6, -0.1], [0, 1, 0]]), 1)).geometry).toBe('custom')
    expect(ok(readPaint(linear(IDENTITY), 1)).geometry).toBe('standard')
    const std = angleToFigmaTransform(45, 2) as number[][]
    expect(ok(readPaint(linear(std), 2)).geometry).toBe('standard')
  })

  it('skips singular, malformed and non-finite matrices', () => {
    for (const m of [[[1, 1, 0], [1, 1, 0]], [[1, 0], [0, 1]], [[1, 0, 0]], 'x', null, [[1, 0, NaN], [0, 1, 0]], [[0, 0, 0], [0, 0, 0]]]) {
      const r = readPaint(linear(m), 1)
      expect(r.status, JSON.stringify(m)).toBe('skipped')
      if (r.status === 'skipped') expect(r.code).toBe('invalid')
    }
  })
})

describe('readPaint: alpha and opacity', () => {
  it('keeps stop alpha and flags transparency', () => {
    const r = ok(readPaint(linear(IDENTITY, { gradientStops: [stop(0, 1, 0, 0, 0.5), stop(1, 0, 0, 1, 1)] }), 1))
    expect(r.document.stops[0].alpha).toBe(0.5)
    expect(r.document.stops[1].alpha).toBeUndefined()
    expect(r.translucent).toBe(true)
  })

  it('treats a missing stop alpha as opaque', () => {
    const r = ok(readPaint(linear(IDENTITY), 1))
    expect(r.document.stops.every((s) => s.alpha === undefined)).toBe(true)
    expect(r.translucent).toBe(false)
    expect(r.paintOpacity).toBe(1)
  })

  it('leaves paint opacity out of the scored document but puts it in the rendered one', () => {
    const r = ok(readPaint(linear(IDENTITY, { opacity: 0.5 }), 1))
    expect(r.paintOpacity).toBe(0.5)
    expect(r.document.stops.every((s) => s.alpha === undefined)).toBe(true)
    expect(r.renderDocument.stops.every((s) => s.alpha === 0.5)).toBe(true)
  })

  it('multiplies paint opacity into stop alpha for the rendered document', () => {
    const r = ok(readPaint(linear(IDENTITY, { opacity: 0.5, gradientStops: [stop(0, 1, 0, 0, 0.5), stop(1, 0, 0, 1, 1)] }), 1))
    expect(r.document.stops[0].alpha).toBe(0.5)
    expect(r.renderDocument.stops.map((s) => s.alpha)).toEqual([0.25, 0.5])
  })

  it('rejects an opacity outside 0-1', () => {
    expect(readPaint(linear(IDENTITY, { opacity: 2 }), 1).status).toBe('skipped')
    expect(readPaint(linear(IDENTITY, { opacity: -0.1 }), 1).status).toBe('skipped')
  })
})

describe('readPaint: unsupported and odd paints', () => {
  it('names the non-linear gradient types as skipped', () => {
    for (const [type, code] of [['GRADIENT_RADIAL', 'radial'], ['GRADIENT_ANGULAR', 'angular'], ['GRADIENT_DIAMOND', 'diamond']] as const) {
      const r = readPaint({ ...radial, type }, 1)
      expect(r).toMatchObject({ status: 'skipped', code })
      if (r.status === 'skipped') expect(r.reason).toMatch(/Only linear gradients are scored/)
    }
  })

  it('ignores paints that are not gradients', () => {
    for (const p of [solid, { type: 'IMAGE', scaleMode: 'FILL', imageHash: null }, { type: 'VIDEO' }, { type: 'PATTERN' }, { type: 'SHADER' }, null, undefined, 3, 'GRADIENT_LINEAR', []]) {
      expect(readPaint(p, 1).status, JSON.stringify(p)).toBe('ignored')
    }
  })

  it('skips a gradient with a variable bound to a stop (a write would unbind it)', () => {
    const stops = [{ ...stop(0, 1, 0, 0), boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'VariableID:1:2' } } }, stop(1, 0, 0, 1)]
    const r = readPaint(linear(IDENTITY, { gradientStops: stops }), 1)
    expect(r).toMatchObject({ status: 'skipped', code: 'variables' })
  })

  it('accepts an empty boundVariables object', () => {
    const stops = [{ ...stop(0, 1, 0, 0), boundVariables: {} }, stop(1, 0, 0, 1)]
    expect(readPaint(linear(IDENTITY, { gradientStops: stops }), 1).status).toBe('ok')
  })

  it('skips malformed stops without throwing', () => {
    const bad: unknown[] = [
      [],
      [stop(0, 1, 0, 0)],
      [stop(0, 1, 0, 0), stop(1.5, 0, 0, 1)],
      [stop(0, 1, 0, 0), stop(NaN, 0, 0, 1)],
      [stop(0, 1, 0, 0), stop(1, 2, 0, 1)],
      [stop(0, 1, 0, 0), stop(1, 0, 0, 1, -1)],
      [stop(0, 1, 0, 0), null],
      [stop(0, 1, 0, 0), { position: 1 }],
      'stops',
      undefined,
    ]
    for (const s of bad) {
      const r = readPaint(linear(IDENTITY, { gradientStops: s as PaintLike['gradientStops'] }), 1)
      expect(r.status, JSON.stringify(s)).toBe('skipped')
    }
  })

  it('survives a paint whose getters throw', () => {
    const hostile = {
      type: 'GRADIENT_LINEAR',
      get gradientStops(): never {
        throw new Error('boom')
      },
    }
    expect(readPaint(hostile, 1).status).toBe('skipped')
  })

  it('isGradientPaint', () => {
    expect(isGradientPaint({ type: 'GRADIENT_ANGULAR' })).toBe(true)
    expect(isGradientPaint({ type: 'SOLID' })).toBe(false)
    expect(isGradientPaint(null)).toBe(false)
    expect(isGradientPaint({ type: 4 })).toBe(false)
  })
})

describe('buildPaint', () => {
  const original = (over: Partial<PaintLike> = {}) => linear([[2, 0, -0.5], [0, 1, 0]], { opacity: 0.8, visible: false, blendMode: 'MULTIPLY', ...over })

  it('keeps the layer\'s own matrix, opacity, visibility and blend mode', () => {
    const b = buildPaint(original(), SMOOTH_DOC, 1, 0)
    expect(b.status).toBe('ok')
    if (b.status !== 'ok') return
    expect(b.paint).toMatchObject({ type: 'GRADIENT_LINEAR', gradientTransform: [[2, 0, -0.5], [0, 1, 0]], opacity: 0.8, visible: false, blendMode: 'MULTIPLY' })
  })

  it('defaults opacity, visible and blendMode like Figma does', () => {
    const b = buildPaint(linear(IDENTITY), SMOOTH_DOC, 1, 0)
    expect(b.status === 'ok' && b.paint).toMatchObject({ opacity: 1, visible: true, blendMode: 'NORMAL' })
  })

  it('writes exactly the document\'s stops when bake is 0', () => {
    const b = buildPaint(original(), RGB_DOC, 1, 0)
    if (b.status !== 'ok') throw new Error(b.reason)
    expect(b.paint.gradientStops).toEqual([
      { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
      { position: 0.5, color: { r: 0, g: 1, b: 0, a: 1 } },
      { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
    ])
  })

  it('pre-samples about `bake` stops and keeps every original stop', () => {
    for (const n of [2, 3, 8, 16]) {
      const b = buildPaint(original(), RGB_DOC, 1, n)
      if (b.status !== 'ok') throw new Error(b.reason)
      expect(b.paint.gradientStops.length).toBeGreaterThanOrEqual(Math.max(n, 3))
      expect(b.paint.gradientStops.length).toBeLessThanOrEqual(n + 2)
      const positions = b.paint.gradientStops.map((s) => s.position)
      expect(positions).toEqual([...positions].sort((a, b) => a - b))
      for (const p of [0, 0.5, 1]) expect(positions).toContain(p)
    }
  })

  it('round trips: build then read gives the document back (bake 0)', () => {
    const b = buildPaint(linear(angleToFigmaTransform(135, 1.6)), SMOOTH_DOC, 1.6, 0)
    if (b.status !== 'ok') throw new Error(b.reason)
    const r = ok(readPaint(b.paint, 1.6))
    expect(r.document.stops.map((s) => s.color)).toEqual(['#101b45', '#9333ea'])
    expect(r.document.angle).toBeCloseTo(135, 6)
  })

  it('returns a copy of the matrix, not the layer\'s array', () => {
    const o = original()
    const b = buildPaint(o, SMOOTH_DOC, 1, 0)
    if (b.status !== 'ok') throw new Error(b.reason)
    expect(b.paint.gradientTransform).not.toBe(o.gradientTransform)
    expect(b.paint.gradientTransform[0]).not.toBe((o.gradientTransform as number[][])[0])
  })

  it('errors on a bad matrix or an unusable document', () => {
    expect(buildPaint(linear([[1, 0], [0, 1]]), SMOOTH_DOC, 1, 0).status).toBe('error')
    expect(buildPaint(linear(IDENTITY), { kind: 'linear', angle: 0, stops: [{ color: '#ff0000' }] }, 1, 0).status).toBe('error')
  })
})

describe('small helpers', () => {
  it('sameStops compares within half an 8-bit step', () => {
    const a = [stop(0, 1, 0, 0), stop(1, 0, 0, 1)]
    expect(sameStops(a, JSON.parse(JSON.stringify(a)))).toBe(true)
    expect(sameStops(a, [stop(0, 1 - 0.4 / 255, 0, 0), stop(1, 0, 0, 1)])).toBe(true)
    expect(sameStops(a, [stop(0, 1 - 1 / 255, 0, 0), stop(1, 0, 0, 1)])).toBe(false)
    expect(sameStops(a, [stop(0, 1, 0, 0), stop(0.9, 0, 0, 1)])).toBe(false)
    expect(sameStops(a, [stop(0, 1, 0, 0)])).toBe(false)
    expect(sameStops(a, [stop(0, 1, 0, 0, 0.5), stop(1, 0, 0, 1)])).toBe(false)
    expect(sameStops(undefined, a)).toBe(false)
  })

  it('aspectOfBox falls back to a square', () => {
    expect(aspectOfBox(200, 100)).toBe(2)
    for (const [w, h] of [[0, 10], [10, 0], [-1, 5], [NaN, 5], [5, Infinity], ['a', 1], [undefined, undefined], [1e9, 1]]) expect(aspectOfBox(w, h)).toBe(1)
  })

  it('readMatrix accepts only a finite 2x3 and copies it', () => {
    const m = [[1, 2, 3], [4, 5, 6]]
    const r = readMatrix(m)
    expect(r).toEqual(m)
    expect(r?.[0]).not.toBe(m[0])
    expect(readMatrix([[1, 2, 3]])).toBeNull()
    expect(readMatrix([[1, 2, 3], [4, 5, Infinity]])).toBeNull()
    expect(readMatrix('m')).toBeNull()
  })
})
