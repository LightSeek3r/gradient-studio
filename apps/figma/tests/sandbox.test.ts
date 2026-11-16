import { beforeEach, describe, expect, it, vi } from 'vitest'
import { refine } from '@opal42/gradient'
import { start, type FigmaLike, type NodeHandle, type RectHandle } from '../src/sandbox'
import type { PluginMessage } from '../src/messages'
import { readPaint } from '../src/paint-adapter'
import { RGB_DOC, layer, paintFromDoc, radial } from './helpers'

interface Stub {
  api: FigmaLike
  posted: PluginMessage[]
  calls: string[]
  nodes: Map<string, NodeHandle>
  selected(): NodeHandle[]
  rects: RectHandle[]
  emit(type: string): void
  send(msg: unknown): Promise<void>
  last<T extends PluginMessage['type']>(type: T): Extract<PluginMessage, { type: T }>
}

function makeStub(initial: NodeHandle[] = []): Stub {
  const handlers = new Map<string, (() => void)[]>()
  const posted: PluginMessage[] = []
  const calls: string[] = []
  const nodes = new Map<string, NodeHandle>(initial.map((n) => [n.id, n]))
  const page = { selection: initial as readonly NodeHandle[] }
  const rects: RectHandle[] = []
  const stub = {} as Stub
  const api: FigmaLike = {
    showUI: (html, options) => void calls.push(`showUI:${html}:${JSON.stringify(options)}`),
    ui: { postMessage: (m) => void posted.push(m as PluginMessage), onmessage: undefined, resize: (w, h) => void calls.push(`resize:${w}x${h}`) },
    on: (type, cb) => void handlers.set(type, [...(handlers.get(type) ?? []), cb]),
    currentPage: page,
    root: { documentColorProfile: 'SRGB' },
    viewport: { center: { x: 500, y: 300 }, scrollAndZoomIntoView: () => void calls.push('zoom') },
    notify: () => undefined,
    commitUndo: () => void calls.push('commitUndo'),
    getNodeByIdAsync: async (id) => nodes.get(id) ?? null,
    createRectangle: () => {
      const r = { id: `9:${rects.length}`, name: 'Rectangle', type: 'RECTANGLE', x: 0, y: 0, width: 100, height: 100, fills: [], resize(w: number, h: number) { r.width = w; r.height = h } } as RectHandle
      rects.push(r)
      nodes.set(r.id, r)
      calls.push('createRectangle')
      return r
    },
  }
  Object.assign(stub, {
    api,
    posted,
    calls,
    nodes,
    rects,
    selected: () => page.selection as NodeHandle[],
    emit: (type: string) => handlers.get(type)?.forEach((f) => f()),
    send: async (msg: unknown) => {
      api.ui.onmessage?.(msg, { origin: 'x' })
      await new Promise((r) => setTimeout(r, 0))
    },
    last: (type: string) => [...posted].reverse().find((m) => m.type === type),
  })
  return stub
}

const analysisOf = (s: Stub) => (s.last('analysis') as Extract<PluginMessage, { type: 'analysis' }>).analysis

describe('start: wiring', () => {
  it('opens the UI with the compact size and Figma theme variables, then posts the first analysis', () => {
    const s = makeStub([layer({ fills: [paintFromDoc(RGB_DOC)] })])
    start(s.api, '<html>ui</html>')
    expect(s.calls[0]).toBe('showUI:<html>ui</html>:{"width":320,"height":480,"themeColors":true,"title":"Opal42 Gradient Score"}')
    expect(analysisOf(s).gradients).toHaveLength(1)
  })

  it('sends a fresh analysis when the selection or page changes', () => {
    const a = layer({ fills: [paintFromDoc(RGB_DOC)] })
    const s = makeStub([a])
    start(s.api, '')
    const before = s.posted.length
    ;(s.api.currentPage as { selection: unknown }).selection = []
    s.emit('selectionchange')
    expect(s.posted.length).toBe(before + 1)
    expect(analysisOf(s).selectionCount).toBe(0)
    s.emit('currentpagechange')
    expect(s.posted.length).toBe(before + 2)
  })

  it('answers ready and rescan with an analysis', async () => {
    const s = makeStub([layer({ fills: [paintFromDoc(RGB_DOC)] })])
    start(s.api, '')
    const n = s.posted.length
    await s.send({ type: 'ready' })
    await s.send({ type: 'rescan' })
    expect(s.posted.slice(n).map((m) => m.type)).toEqual(['analysis', 'analysis'])
  })

  it('reports a selection that cannot be analysed instead of throwing', () => {
    const s = makeStub()
    s.api.currentPage = { get selection(): never { throw new Error('gone') } }
    start(s.api, '')
    expect(s.last('error')?.message).toMatch(/Could not analyse/)
  })
})

describe('apply', () => {
  let node: NodeHandle
  let s: Stub
  beforeEach(() => {
    node = layer({ id: '5:1', fills: [paintFromDoc(RGB_DOC, 2)], width: 200, height: 100 })
    s = makeStub([node])
    start(s.api, '')
  })
  const ref = { nodeId: '5:1', target: 'fills', index: 0 }

  it('refined: assigns node.fills with a baked paint, after commitUndo', async () => {
    const original = node.fills as unknown[]
    await s.send({ type: 'apply', ref, action: { kind: 'refine', bake: 8 } })
    expect(s.calls.indexOf('commitUndo')).toBeGreaterThan(-1)
    expect(node.fills).not.toBe(original)
    const [paint] = node.fills as { type: string; gradientStops: unknown[]; gradientTransform: unknown }[]
    expect(paint.type).toBe('GRADIENT_LINEAR')
    expect(paint.gradientStops.length).toBeGreaterThanOrEqual(8)
    expect(paint.gradientTransform).toEqual((original[0] as { gradientTransform: unknown }).gradientTransform)
    expect(s.last('apply-result')).toMatchObject({ ok: true, undoAvailable: true })
    expect(analysisOf(s).gradients[0].score).toBeGreaterThan(58)
  })

  it('does not modify the original paints array (a new array is assigned)', async () => {
    const original = node.fills as unknown[]
    const snap = JSON.stringify(original)
    await s.send({ type: 'apply', ref, action: { kind: 'refine', bake: 8 } })
    expect(JSON.stringify(original)).toBe(snap)
  })

  it('fix: writes the expected paint', async () => {
    await s.send({ type: 'apply', ref, action: { kind: 'fix', index: 0, label: 'Make stop 2 darker' } })
    const [paint] = node.fills as { gradientStops: { color: { g: number } }[] }[]
    expect(paint.gradientStops).toHaveLength(3)
    expect(paint.gradientStops[1].color.g).toBeLessThan(1)
    expect(s.last('apply-result')?.message).toMatch(/Make stop 2 darker/)
  })

  it('writes nothing when the gradient is already refined', async () => {
    node.fills = [paintFromDoc(refine(RGB_DOC).document, 2)]
    const before = node.fills
    s.calls.length = 0
    await s.send({ type: 'apply', ref, action: { kind: 'refine', bake: 2 } })
    expect(node.fills).toBe(before)
    expect(s.calls).not.toContain('commitUndo')
    expect(s.last('apply-result')).toMatchObject({ ok: true })
    expect(s.last('apply-result')?.message).toMatch(/nothing was changed/)
  })

  it('applies to strokes and leaves fills alone', async () => {
    node.strokes = [paintFromDoc(RGB_DOC, 2)]
    const fills = node.fills
    await s.send({ type: 'apply', ref: { ...ref, target: 'strokes' }, action: { kind: 'refine', bake: 4 } })
    expect(node.fills).toBe(fills)
    expect((node.strokes as unknown[]).length).toBe(1)
    expect(readPaint((node.strokes as unknown[])[0], 2).status).toBe('ok')
    expect(s.last('apply-result')?.ok).toBe(true)
  })

  it('refuses a layer that is gone, a paint that is no longer a gradient and non-gradient paints', async () => {
    await s.send({ type: 'apply', ref: { ...ref, nodeId: '9:99' }, action: { kind: 'refine', bake: 8 } })
    expect(s.last('apply-result')).toMatchObject({ ok: false })
    await s.send({ type: 'apply', ref: { ...ref, index: 4 }, action: { kind: 'refine', bake: 8 } })
    expect(s.last('apply-result')).toMatchObject({ ok: false })
    node.fills = [radial]
    await s.send({ type: 'apply', ref, action: { kind: 'refine', bake: 8 } })
    expect(s.last('apply-result')).toMatchObject({ ok: false })
    expect(node.fills).toEqual([radial])
  })

  it('reports Figma refusing the write', async () => {
    Object.defineProperty(node, 'fills', { configurable: true, get: () => [paintFromDoc(RGB_DOC, 2)], set() { throw new Error('read-only in this context') } })
    await s.send({ type: 'apply', ref, action: { kind: 'refine', bake: 8 } })
    expect(s.last('apply-result')).toMatchObject({ ok: false, undoAvailable: false })
    expect(s.last('apply-result')?.message).toMatch(/did not accept/)
  })

  it('ignores a malformed message and writes nothing', async () => {
    const before = node.fills
    await s.send({ type: 'apply', ref, action: { kind: 'refine', bake: 99 } })
    await s.send({ type: 'apply', ref, action: { kind: 'refine', bake: 8 }, paint: { type: 'SOLID' } })
    await s.send('hello')
    expect(node.fills).toBe(before)
    expect(s.last('error')?.message).toMatch(/malformed/)
  })
})

describe('undo', () => {
  const ref = { nodeId: '5:1', target: 'fills', index: 0 }
  it('restores the previous paints with a property assignment', async () => {
    const node = layer({ id: '5:1', fills: [paintFromDoc(RGB_DOC, 2)] })
    const original = node.fills
    const s = makeStub([node])
    start(s.api, '')
    await s.send({ type: 'apply', ref, action: { kind: 'refine', bake: 8 } })
    expect(node.fills).not.toBe(original)
    await s.send({ type: 'undo' })
    expect(node.fills).toBe(original)
    expect(s.last('undo-result')).toMatchObject({ ok: true, undoAvailable: false })
  })

  it('refuses to overwrite a layer that was edited after the write', async () => {
    const node = layer({ id: '5:1', fills: [paintFromDoc(RGB_DOC, 2)] })
    const s = makeStub([node])
    start(s.api, '')
    await s.send({ type: 'apply', ref, action: { kind: 'refine', bake: 8 } })
    const edited = [paintFromDoc({ ...RGB_DOC, stops: [{ color: '#112233', position: 0 }, { color: '#445566', position: 1 }] }, 2)]
    node.fills = edited
    await s.send({ type: 'undo' })
    expect(node.fills).toBe(edited)
    expect(s.last('undo-result')).toMatchObject({ ok: false })
  })

  it('says so when there is nothing to undo', async () => {
    const s = makeStub([])
    start(s.api, '')
    await s.send({ type: 'undo' })
    expect(s.last('undo-result')).toMatchObject({ ok: false, message: 'Nothing to undo.' })
  })

  it('undoes in reverse order', async () => {
    const node = layer({ id: '5:1', fills: [paintFromDoc(RGB_DOC, 2)] })
    const s = makeStub([node])
    start(s.api, '')
    const first = node.fills
    await s.send({ type: 'apply', ref, action: { kind: 'fix', index: 0, label: 'Make stop 2 darker' } })
    const second = node.fills
    await s.send({ type: 'apply', ref, action: { kind: 'refine', bake: 4 } })
    await s.send({ type: 'undo' })
    expect(node.fills).toBe(second)
    await s.send({ type: 'undo' })
    expect(node.fills).toBe(first)
  })
})

describe('export, select, resize', () => {
  const ref = { nodeId: '5:1', target: 'fills', index: 0 }
  it('exports the CSS of the layer\'s gradient', async () => {
    const s = makeStub([layer({ id: '5:1', fills: [paintFromDoc(RGB_DOC, 2)] })])
    start(s.api, '')
    await s.send({ type: 'export', requestId: 3, ref, format: 'css' })
    const r = s.last('export-result')
    expect(r).toMatchObject({ requestId: 3, ok: true, language: 'CSS' })
    expect(r?.text).toMatch(/^background: linear-gradient\(90deg, #ff0000/)
  })

  it('reports an export that is not possible', async () => {
    const s = makeStub([layer({ id: '5:1', fills: [radial] })])
    start(s.api, '')
    await s.send({ type: 'export', requestId: 4, ref, format: 'css' })
    expect(s.last('export-result')).toMatchObject({ requestId: 4, ok: false })
  })

  it('selects a layer and zooms to it, but never a page', async () => {
    const a = layer({ id: '5:1' })
    const s = makeStub([a])
    s.nodes.set('0:1', { ...layer({ id: '0:1' }), type: 'PAGE' })
    start(s.api, '')
    await s.send({ type: 'select', nodeId: '0:1' })
    expect(s.calls).not.toContain('zoom')
    await s.send({ type: 'select', nodeId: '5:1' })
    expect(s.selected()).toEqual([a])
    expect(s.calls).toContain('zoom')
  })

  it('resizes within limits', async () => {
    const s = makeStub()
    start(s.api, '')
    await s.send({ type: 'resize', width: 5000, height: 10 })
    expect(s.calls).toContain('resize:720x320')
  })
})

describe('create from CSS', () => {
  const create = async (css: string, bake = 8) => {
    const s = makeStub()
    start(s.api, '')
    await s.send({ type: 'create-from-css', css, bake })
    return s
  }

  it('creates a rectangle with a gradient fill at the viewport centre and selects it', async () => {
    const s = await create('background: linear-gradient(90deg, #ff0000, #0000ff);')
    expect(s.rects).toHaveLength(1)
    const [r] = s.rects
    expect([r.width, r.height, r.x, r.y]).toEqual([320, 200, 340, 200])
    const fills = r.fills as { type: string; gradientStops: { color: { r: number } }[] }[]
    expect(fills[0].type).toBe('GRADIENT_LINEAR')
    expect(fills[0].gradientStops.map((x) => x.color.r)).toEqual([1, 0])
    expect(s.selected()).toEqual([r])
    expect(s.last('create-result')).toMatchObject({ ok: true, created: 1 })
    expect(s.calls.indexOf('commitUndo')).toBeLessThan(s.calls.indexOf('createRectangle'))
  })

  it('creates nothing and says why for text without a gradient', async () => {
    const s = await create('color: red')
    expect(s.rects).toHaveLength(0)
    expect(s.last('create-result')).toMatchObject({ ok: false, created: 0 })
  })

  it('creates the linear ones and lists the skip reasons for the others', async () => {
    const s = await create('a { background: radial-gradient(red, blue) } b { background: linear-gradient(red, var(--x)) } c { background: linear-gradient(to right, red, blue) } d { background: repeating-linear-gradient(red, blue 10px) }')
    expect(s.rects).toHaveLength(1)
    const r = s.last('create-result')!
    expect(r.skipped).toHaveLength(3)
    expect(r.skipped.join('\n')).toMatch(/Gradient 1:/)
    expect(r.skipped.join('\n')).toMatch(/Gradient 2:/)
    expect(r.skipped.join('\n')).toMatch(/Gradient 4:/)
  })

  it('bakes OKLAB documents with the chosen count, but not plain sRGB ones', async () => {
    const baked = await create('linear-gradient(in oklab 90deg, #ff0000, #0000ff)', 6)
    const n = (baked.rects[0].fills as unknown[][]).length === 1 ? ((baked.rects[0].fills as { gradientStops: unknown[] }[])[0].gradientStops.length) : 0
    expect(n).toBeGreaterThanOrEqual(6)
    const plain = await create('linear-gradient(90deg, #ff0000, #0000ff)', 6)
    expect((plain.rects[0].fills as { gradientStops: unknown[] }[])[0].gradientStops).toHaveLength(2)
  })

  it('caps the number of rectangles', async () => {
    const css = Array.from({ length: 14 }, () => 'linear-gradient(red, blue)').join(' ')
    const s = await create(css)
    expect(s.rects).toHaveLength(10)
    expect(s.last('create-result')?.skipped.join()).toMatch(/Only the first 10/)
  })
})

describe('code.ts entry', () => {
  it('starts the sandbox with the figma and __html__ globals', async () => {
    vi.resetModules()
    const s = makeStub([layer({ fills: [paintFromDoc(RGB_DOC)] })])
    ;(globalThis as Record<string, unknown>).figma = s.api
    ;(globalThis as Record<string, unknown>).__html__ = '<p>from manifest</p>'
    await import('../src/code')
    expect(s.calls[0]).toContain('<p>from manifest</p>')
    expect(analysisOf(s).gradients).toHaveLength(1)
    delete (globalThis as Record<string, unknown>).figma
    delete (globalThis as Record<string, unknown>).__html__
  })
})
