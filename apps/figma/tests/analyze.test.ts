import { describe, expect, it } from 'vitest'
import { EXPORT_FORMATS } from '@opal42/gradient/export'
import { refine, type GradientDocument } from '@opal42/gradient'
import { analyzeSelection, collectTargets, computeActions, describeTarget, exportPaint, layerWarnings, planApply, reasonText } from '../src/analyze'
import { COPY_FORMATS } from '../src/messages'
import { readPaint, type PaintLike } from '../src/paint-adapter'
import { RGB_DOC, SMOOTH_DOC, adopt, layer, paintFromDoc, radial, solid } from './helpers'

const rgbLayer = (over = {}) => layer({ fills: [paintFromDoc(RGB_DOC, 2)], ...over })

describe('collectTargets', () => {
  it('finds gradient fills and strokes and counts other paints', () => {
    const l = layer({ fills: [solid, paintFromDoc(RGB_DOC)], strokes: [paintFromDoc(SMOOTH_DOC), radial] })
    const c = collectTargets([l])
    expect(c.targets.map((t) => [t.ref.target, t.ref.index])).toEqual([['fills', 1], ['strokes', 0], ['strokes', 1]])
    expect(c.otherPaints).toBe(1)
    expect(c.scannedLayers).toBe(1)
  })

  it('looks inside selected frames, in order, once per layer', () => {
    const a = rgbLayer()
    const b = rgbLayer()
    const frame = adopt(layer({ type: 'FRAME' }), a, adopt(layer({ type: 'GROUP' }), b))
    const c = collectTargets([frame, a])
    expect(c.targets.map((t) => t.host)).toEqual([a, b])
    expect(c.scannedLayers).toBe(4)
  })

  it('counts layers with mixed fills (a symbol) and skips them', () => {
    const c = collectTargets([layer({ type: 'TEXT', fills: Symbol('mixed') })])
    expect(c.mixedLayers).toBe(1)
    expect(c.targets).toEqual([])
  })

  it('stops at the layer and gradient caps and says so', () => {
    const kids = Array.from({ length: 10 }, () => rgbLayer())
    const frame = adopt(layer({ type: 'FRAME' }), ...kids)
    expect(collectTargets([frame], { layers: 4, gradients: 99 })).toMatchObject({ truncated: 'layers', scannedLayers: 4 })
    const g = collectTargets([frame], { layers: 99, gradients: 3 })
    expect(g.truncated).toBe('gradients')
    expect(g.targets).toHaveLength(3)
  })

  it('does not throw when reading paints throws', () => {
    const l = layer()
    Object.defineProperty(l, 'fills', { get() { throw new Error('x') } })
    expect(collectTargets([l]).targets).toEqual([])
  })

  it('marks layers inside component instances', () => {
    const inner = rgbLayer()
    const inst = adopt(layer({ type: 'INSTANCE' }), inner)
    const c = collectTargets([inst])
    expect(c.targets[0].insideInstance).toBe(true)
    expect(collectTargets([inner]).targets[0].insideInstance).toBe(true)
  })
})

describe('layerWarnings', () => {
  it('warns for instances, main components, locked layers (and locked parents) and paint styles', () => {
    expect(layerWarnings(layer({ type: 'INSTANCE' }), 'fills', false).join()).toMatch(/Component instance/)
    expect(layerWarnings(layer(), 'fills', true).join()).toMatch(/Component instance/)
    expect(layerWarnings(layer({ type: 'COMPONENT' }), 'fills', false).join()).toMatch(/Main component/)
    expect(layerWarnings(layer({ locked: true }), 'fills', false).join()).toMatch(/Locked/)
    const child = layer()
    adopt(layer({ locked: true }), child)
    expect(layerWarnings(child, 'fills', false).join()).toMatch(/Locked/)
    expect(layerWarnings(layer({ fillStyleId: 'S:1' }), 'fills', false).join()).toMatch(/paint style/)
    expect(layerWarnings(layer({ fillStyleId: 'S:1' }), 'strokes', false)).toEqual([])
    expect(layerWarnings(layer({ fillStyleId: Symbol('mixed') }), 'fills', false)).toEqual([])
  })

  it('has nothing to say about an ordinary layer', () => {
    expect(layerWarnings(layer(), 'fills', false)).toEqual([])
  })
})

describe('describeTarget', () => {
  const view = (l = rgbLayer()) => describeTarget(collectTargets([l]).targets[0])

  it('scores a gradient with coded issues and plain-language explanations', () => {
    const v = view()
    expect(v.status).toBe('scored')
    expect(v.score).toBe(58)
    expect(v.issues.map((i) => i.code)).toEqual(['lightness/reversal', 'hue/wide-arc', 'chroma/muddy-midpoint'])
    expect(v.issues[0]).toMatchObject({ name: 'lightness reversal', stops: [2] })
    expect(v.issues[0].measures).toMatch(/darker, or lighter/)
    expect(v.dimensions.map((d) => d.max)).toEqual([30, 30, 20, 20])
    expect(v.dimensions.map((d) => d.key)).toEqual(['lightness', 'hue', 'chroma', 'spacing'])
    expect(v.swatch).toMatch(/^linear-gradient\(90deg/)
    expect(v.angle).toBe(90)
    expect(v.exportable).toBe(true)
  })

  it('lists fixes with their gain and a refinement', () => {
    const v = view()
    expect(v.fixes.map((f) => f.label)).toEqual(['Make stop 2 darker', 'Bring the hues of stops 1 and 3 closer', 'Shift the hue of stop 2'])
    expect(v.fixes.every((f) => f.gain > 0)).toBe(true)
    expect(v.refine).toEqual({ scoreAfter: 90, gain: 32 })
  })

  it('uses neutral wording: no pass/fail anywhere', () => {
    const text = JSON.stringify(view())
    expect(text).not.toMatch(/\b(pass|fail|good|bad|excellent|poor)\b/i)
  })

  it('has no actions when the score cannot improve', () => {
    const refined = refine(RGB_DOC).document
    const v = view(layer({ fills: [paintFromDoc(refined)] }))
    expect(v.status).toBe('scored')
    expect(v.refine).toBeNull()
  })

  it('explains why radial, angular and diamond paints are not scored', () => {
    for (const type of ['GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND']) {
      const v = view(layer({ fills: [{ ...radial, type }] }))
      expect(v).toMatchObject({ status: 'not-scored', score: null, swatch: null, exportable: false, fixes: [], refine: null })
      expect(v.reason?.text).toMatch(/^Not scored: .*Only linear gradients are scored/)
    }
  })

  it('does not score transparent stops, but can still copy them', () => {
    const doc: GradientDocument = { ...SMOOTH_DOC, stops: [{ color: '#101b45', alpha: 0.4, position: 0 }, { color: '#9333ea', position: 1 }] }
    const v = view(layer({ fills: [paintFromDoc(doc)] }))
    expect(v).toMatchObject({ status: 'not-scored', translucent: true, exportable: true })
    expect(v.reason?.code).toBe('alpha')
    expect(v.reason?.text).toMatch(/opaque stops only/)
  })

  it('scores opaque stops under a translucent paint and keeps the paint opacity', () => {
    const v = view(layer({ fills: [{ ...paintFromDoc(RGB_DOC), opacity: 0.5 }] }))
    expect(v).toMatchObject({ status: 'scored', score: 58, translucent: true, paintOpacity: 0.5 })
  })

  it('does not score hard stops (stripes)', () => {
    const doc: GradientDocument = { ...SMOOTH_DOC, stops: [{ color: '#ff0000', position: 0 }, { color: '#ff0000', position: 0.5 }, { color: '#0000ff', position: 0.5 }, { color: '#0000ff', position: 1 }] }
    const v = view(layer({ fills: [paintFromDoc(doc)] }))
    expect(v.reason?.code).toBe('hard-stops')
    expect(v.reason?.text).toMatch(/hard edge/)
  })

  it('flags hidden paints and hidden layers', () => {
    expect(view(layer({ fills: [{ ...paintFromDoc(RGB_DOC), visible: false }] })).hidden).toBe(true)
    expect(view(rgbLayer({ visible: false })).hidden).toBe(true)
    expect(view().hidden).toBe(false)
  })

  it('reports custom handles and layer warnings', () => {
    const p = { ...paintFromDoc(RGB_DOC), gradientTransform: [[2, 0, -0.5], [0, 1, 0]] }
    const v = view(layer({ fills: [p], locked: true }))
    expect(v.geometry).toBe('custom')
    expect(v.warnings.join()).toMatch(/Locked/)
  })

  it('leaves a variable-bound gradient alone', () => {
    const p = paintFromDoc(RGB_DOC)
    ;(p.gradientStops[0] as { boundVariables?: unknown }).boundVariables = { color: { id: 'v' } }
    const v = view(layer({ fills: [p] }))
    expect(v.reason?.code).toBe('variables')
    expect(v.fixes).toEqual([])
  })

  it('truncates very long layer names', () => {
    expect(view(rgbLayer({ name: 'x'.repeat(5000) })).nodeName).toHaveLength(300)
  })
})

describe('analyzeSelection', () => {
  it('summarises a selection', () => {
    const a = analyzeSelection([layer({ fills: [solid] }), rgbLayer()], { colorProfile: 'SRGB' })
    expect(a).toMatchObject({ selectionCount: 2, scannedLayers: 2, otherPaints: 1, truncated: null, notes: [] })
    expect(a.gradients).toHaveLength(1)
  })

  it('notes a Display P3 file, mixed fills and truncation', () => {
    const a = analyzeSelection([layer({ type: 'TEXT', fills: Symbol('m') }), rgbLayer(), rgbLayer()], { colorProfile: 'DISPLAY_P3' }, { layers: 99, gradients: 1 })
    expect(a.notes.join('\n')).toMatch(/Display P3/)
    expect(a.notes.join('\n')).toMatch(/mixed fills/)
    expect(a.notes.join('\n')).toMatch(/first 1 gradients/)
    expect(a.truncated).toBe('gradients')
  })

  it('is empty for an empty selection', () => {
    expect(analyzeSelection([], { colorProfile: 'SRGB' }).gradients).toEqual([])
  })
})

describe('computeActions', () => {
  it('is memoised and pure', () => {
    const a = computeActions(RGB_DOC)
    expect(computeActions(JSON.parse(JSON.stringify(RGB_DOC)))).toBe(a)
  })
  it('explains unscorable documents', () => {
    expect(computeActions({ kind: 'linear', angle: 0, stops: [{ color: '#ff0000' }] })).toMatchObject({ code: 'too-few-stops' })
  })
  it('reasonText always starts with Not scored', () => {
    expect(reasonText('engine', 'whatever')).toBe('Not scored: whatever')
  })
})

describe('planApply', () => {
  const box = { width: 200, height: 100 }

  it('writes a refined gradient with the chosen number of baked stops, keeping matrix and opacity', () => {
    const paint = { ...paintFromDoc(RGB_DOC, 2), gradientTransform: [[2, 0, -0.5], [0, 1, 0]], opacity: 0.7 }
    const plan = planApply(paint, box, { kind: 'refine', bake: 8 })
    if (plan.status !== 'write') throw new Error(JSON.stringify(plan))
    expect(plan.paint.gradientStops.length).toBeGreaterThanOrEqual(8)
    expect(plan.paint.gradientStops.length).toBeLessThanOrEqual(10)
    expect(plan.paint.gradientTransform).toEqual([[2, 0, -0.5], [0, 1, 0]])
    expect(plan.paint.opacity).toBe(0.7)
    expect(plan.summary).toMatch(/58 to 90/)
    const written = readPaint(plan.paint, 2)
    expect(written.status).toBe('ok')
  })

  it('bake 2 writes just the refined stops', () => {
    const plan = planApply(paintFromDoc(RGB_DOC, 2), box, { kind: 'refine', bake: 2 })
    if (plan.status !== 'write') throw new Error('no write')
    expect(plan.paint.gradientStops).toHaveLength(3)
  })

  it('applies a fix by index and label, without baking', () => {
    const plan = planApply(paintFromDoc(RGB_DOC, 2), box, { kind: 'fix', index: 0, label: 'Make stop 2 darker' })
    if (plan.status !== 'write') throw new Error(JSON.stringify(plan))
    expect(plan.paint.gradientStops).toHaveLength(3)
    expect(plan.paint.gradientStops[0].color).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    expect(plan.paint.gradientStops[1].color.g).toBeLessThan(1)
    expect(plan.summary).toMatch(/Make stop 2 darker/)
  })

  it('blocks a stale fix (label no longer matches) and an out-of-range index', () => {
    expect(planApply(paintFromDoc(RGB_DOC, 2), box, { kind: 'fix', index: 0, label: 'Something else' }).status).toBe('blocked')
    expect(planApply(paintFromDoc(RGB_DOC, 2), box, { kind: 'fix', index: 9, label: 'Make stop 2 darker' }).status).toBe('blocked')
  })

  it('makes no write when nothing would change', () => {
    const refined = refine(RGB_DOC).document
    const plan = planApply(paintFromDoc(refined, 2), box, { kind: 'refine', bake: 2 })
    expect(plan.status).toBe('noop')
  })

  it('no write when the written stops equal the current ones', () => {
    const first = planApply(paintFromDoc(RGB_DOC, 2), box, { kind: 'refine', bake: 8 })
    if (first.status !== 'write') throw new Error('no write')
    const second = planApply(first.paint, box, { kind: 'refine', bake: 8 })
    expect(second.status).toBe('noop')
  })

  it('blocks paints that are not scored', () => {
    expect(planApply({ ...radial } as PaintLike, box, { kind: 'refine', bake: 8 }).status).toBe('blocked')
    expect(planApply(solid as PaintLike, box, { kind: 'refine', bake: 8 }).status).toBe('blocked')
    const t = paintFromDoc({ ...SMOOTH_DOC, stops: [{ color: '#101b45', alpha: 0.5, position: 0 }, { color: '#9333ea', position: 1 }] })
    expect(planApply(t, box, { kind: 'refine', bake: 8 }).status).toBe('blocked')
  })

  it('does not mutate the live paint', () => {
    const paint = paintFromDoc(RGB_DOC, 2)
    const before = JSON.stringify(paint)
    planApply(paint, box, { kind: 'refine', bake: 8 })
    expect(JSON.stringify(paint)).toBe(before)
  })
})

describe('exportPaint', () => {
  it('lists the same formats as core', () => {
    expect(COPY_FORMATS.map((f) => f.key)).toEqual(EXPORT_FORMATS.map((f) => f.key))
  })

  it('copies CSS for the gradient as shown, paint opacity included', () => {
    const out = exportPaint({ ...paintFromDoc(RGB_DOC, 2), opacity: 0.5 }, { width: 200, height: 100 }, 'css')
    if (out.status !== 'ok') throw new Error(out.reason)
    expect(out.text).toMatch(/^background: linear-gradient\(90deg/)
    expect(out.text).toMatch(/rgb\(255 0 0 \/ 0\.5\)/)
    expect(out.notes[0]).toMatch(/50%/)
  })

  it('produces every format for an ordinary gradient', () => {
    for (const f of COPY_FORMATS) {
      const out = exportPaint(paintFromDoc(RGB_DOC, 2), { width: 200, height: 100 }, f.key)
      expect(out.status, f.key).toBe('ok')
    }
  })

  it('refuses non-linear paints', () => {
    expect(exportPaint({ ...radial } as PaintLike, {}, 'css').status).toBe('unsupported')
  })
})
