import { describe, expect, it } from 'vitest'
import { analyzeSelection } from '../src/analyze'
import { BAKE_MAX, BAKE_MIN, MAX_CSS_LENGTH, SIZE_LIMITS, clampSize, parsePluginMessage, parseUiMessage } from '../src/messages'
import { RGB_DOC, layer, paintFromDoc } from './helpers'

const ref = { nodeId: '12:34', target: 'fills', index: 0 }

describe('parseUiMessage: accepts', () => {
  it.each([
    [{ type: 'ready' }],
    [{ type: 'rescan' }],
    [{ type: 'undo' }],
    [{ type: 'select', nodeId: 'I12:34;56:78' }],
    [{ type: 'apply', ref, action: { kind: 'refine', bake: 8 } }],
    [{ type: 'apply', ref: { ...ref, target: 'strokes', index: 3 }, action: { kind: 'fix', index: 1, label: 'Make stop 2 darker' } }],
    [{ type: 'export', requestId: 7, ref, format: 'tailwind' }],
    [{ type: 'create-from-css', css: 'linear-gradient(red, blue)', bake: 4 }],
    [{ type: 'resize', width: 400, height: 500 }],
  ])('%j', (m) => {
    expect(parseUiMessage(m)).toEqual({ ok: true, value: m })
  })

  it('accepts the bake limits', () => {
    for (const bake of [BAKE_MIN, BAKE_MAX]) expect(parseUiMessage({ type: 'create-from-css', css: '', bake }).ok).toBe(true)
  })
})

describe('parseUiMessage: rejects malformed messages', () => {
  const bad: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['a string', 'ready'],
    ['an array', [{ type: 'ready' }]],
    ['no type', {}],
    ['an unknown type', { type: 'eval', code: '1' }],
    ['a non-string type', { type: 7 }],
    ['extra fields on ready', { type: 'ready', extra: 1 }],
    ['a class instance', new (class M { type = 'ready' })()],
    ['select with a bad id', { type: 'select', nodeId: '1:2 <script>' }],
    ['select with an empty id', { type: 'select', nodeId: '' }],
    ['select with a long id', { type: 'select', nodeId: '1'.repeat(300) }],
    ['select with a numeric id', { type: 'select', nodeId: 12 }],
    ['apply without ref', { type: 'apply', action: { kind: 'refine', bake: 8 } }],
    ['apply with a bad target', { type: 'apply', ref: { ...ref, target: 'effects' }, action: { kind: 'refine', bake: 8 } }],
    ['apply with a negative index', { type: 'apply', ref: { ...ref, index: -1 }, action: { kind: 'refine', bake: 8 } }],
    ['apply with a fractional index', { type: 'apply', ref: { ...ref, index: 0.5 }, action: { kind: 'refine', bake: 8 } }],
    ['apply with extra ref fields', { type: 'apply', ref: { ...ref, paint: {} }, action: { kind: 'refine', bake: 8 } }],
    ['apply carrying a paint to write', { type: 'apply', ref, action: { kind: 'refine', bake: 8 }, paint: { type: 'SOLID' } }],
    ['apply with bake 1', { type: 'apply', ref, action: { kind: 'refine', bake: 1 } }],
    ['apply with bake 17', { type: 'apply', ref, action: { kind: 'refine', bake: 17 } }],
    ['apply with bake 8.5', { type: 'apply', ref, action: { kind: 'refine', bake: 8.5 } }],
    ['apply with a string bake', { type: 'apply', ref, action: { kind: 'refine', bake: '8' } }],
    ['apply with NaN bake', { type: 'apply', ref, action: { kind: 'refine', bake: NaN } }],
    ['apply with an unknown action', { type: 'apply', ref, action: { kind: 'delete' } }],
    ['fix without a label', { type: 'apply', ref, action: { kind: 'fix', index: 0 } }],
    ['fix with a negative index', { type: 'apply', ref, action: { kind: 'fix', index: -2, label: 'x' } }],
    ['export with an unknown format', { type: 'export', requestId: 1, ref, format: 'pdf' }],
    ['export with a prototype key as format', { type: 'export', requestId: 1, ref, format: '__proto__' }],
    ['export with a bad request id', { type: 'export', requestId: -1, ref, format: 'css' }],
    ['create with non-string css', { type: 'create-from-css', css: 5, bake: 8 }],
    ['create with too long css', { type: 'create-from-css', css: 'a'.repeat(MAX_CSS_LENGTH + 1), bake: 8 }],
    ['create with a bad bake', { type: 'create-from-css', css: '', bake: 0 }],
    ['resize with NaN', { type: 'resize', width: NaN, height: 400 }],
    ['resize with a string', { type: 'resize', width: '400', height: 400 }],
    ['resize with a negative size', { type: 'resize', width: -5, height: 400 }],
  ]
  for (const [name, m] of bad) {
    it(name, () => {
      const r = parseUiMessage(m)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0)
    })
  }

  it('rejects a JSON object with an own __proto__ key', () => {
    expect(parseUiMessage(JSON.parse('{"type":"ready","__proto__":{"x":1}}')).ok).toBe(false)
  })

  it('never throws on hostile getters', () => {
    const m = { get type(): never { throw new Error('boom') } }
    expect(parseUiMessage(m).ok).toBe(false)
  })
})

describe('resize', () => {
  it('clamps to the window limits', () => {
    expect(parseUiMessage({ type: 'resize', width: 10, height: 10 })).toMatchObject({ ok: true, value: { width: SIZE_LIMITS.minWidth, height: SIZE_LIMITS.minHeight } })
    expect(parseUiMessage({ type: 'resize', width: 9000, height: 9000 })).toMatchObject({ ok: true, value: { width: SIZE_LIMITS.maxWidth, height: SIZE_LIMITS.maxHeight } })
    expect(clampSize(333.6, 'Width')).toBe(334)
  })
})

describe('parsePluginMessage', () => {
  const analysis = () => analyzeSelection([layer({ fills: [paintFromDoc(RGB_DOC)] })], { colorProfile: 'SRGB' })

  it('accepts a real analysis (round trips through JSON like postMessage)', () => {
    const m = { type: 'analysis', analysis: analysis() }
    const r = parsePluginMessage(JSON.parse(JSON.stringify(m)))
    expect(r.ok).toBe(true)
    if (r.ok && r.value.type === 'analysis') expect(r.value.analysis.gradients[0].score).toBe(58)
  })

  it('accepts the result messages', () => {
    for (const m of [
      { type: 'apply-result', ok: true, message: 'done', undoAvailable: true },
      { type: 'undo-result', ok: false, message: 'no', undoAvailable: false },
      { type: 'export-result', requestId: 1, ok: true, format: 'css', text: 'x', language: 'CSS', notes: [], message: '' },
      { type: 'create-result', ok: true, message: 'ok', created: 1, skipped: ['a'] },
      { type: 'error', message: 'oops' },
    ]) expect(parsePluginMessage(m).ok, m.type).toBe(true)
  })

  it('rejects a swatch that is not a plain linear-gradient', () => {
    for (const swatch of ['url(http://evil/x.png)', 'linear-gradient(red, blue); background: url(x)', 'red', 'linear-gradient(url(x))', 'javascript:alert(1)']) {
      const a = analysis()
      a.gradients[0].swatch = swatch
      expect(parsePluginMessage({ type: 'analysis', analysis: a }).ok, swatch).toBe(false)
    }
  })

  it('accepts the swatches core prints', () => {
    const a = analysis()
    expect(a.gradients[0].swatch).toBeTruthy()
    const t = analyzeSelection([layer({ fills: [paintFromDoc({ ...RGB_DOC, stops: [{ color: '#ff0000', alpha: 0.5, position: 0 }, { color: '#0000ff', position: 1 }] })] })], { colorProfile: 'SRGB' })
    expect(parsePluginMessage({ type: 'analysis', analysis: t }).ok).toBe(true)
  })

  it('rejects out-of-range or malformed fields', () => {
    const mutate = (f: (a: ReturnType<typeof analysis>) => void) => {
      const a = analysis()
      f(a)
      return parsePluginMessage({ type: 'analysis', analysis: a }).ok
    }
    expect(mutate((a) => (a.gradients[0].score = 101))).toBe(false)
    expect(mutate((a) => (a.gradients[0].score = 50.5))).toBe(false)
    expect(mutate((a) => (a.gradients[0].paintOpacity = 2))).toBe(false)
    expect(mutate((a) => (a.gradients[0].ref.nodeId = '<b>'))).toBe(false)
    expect(mutate((a) => (a.gradients[0].status = 'passed' as never))).toBe(false)
    expect(mutate((a) => (a.gradients[0].issues[0].severity = 'fatal' as never))).toBe(false)
    expect(mutate((a) => (a.gradients = 'x' as never))).toBe(false)
    expect(mutate(() => {})).toBe(true)
  })

  it('rejects non-objects, unknown types and bad results', () => {
    for (const m of [null, 3, [], {}, { type: 'nope' }, { type: 'apply-result', ok: 'yes', message: '', undoAvailable: true }, { type: 'export-result', requestId: 1, ok: true, format: 'pdf', text: '', language: '', notes: [], message: '' }, { type: 'error', message: 5 }]) {
      expect(parsePluginMessage(m).ok).toBe(false)
    }
  })
})
