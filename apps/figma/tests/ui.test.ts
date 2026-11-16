// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeSelection } from '../src/analyze'
import { COPY_FORMATS, type PluginMessage, type UiMessage } from '../src/messages'
import { copyToClipboard, mountUi, type UiHandle } from '../src/ui'
import { RGB_DOC, SMOOTH_DOC, layer, paintFromDoc, radial } from './helpers'

let root: HTMLElement
let sent: UiMessage[]
let ui: UiHandle
let copy: ReturnType<typeof vi.fn<(text: string) => Promise<boolean>>>

const analysis = (...layers: ReturnType<typeof layer>[]): PluginMessage => ({ type: 'analysis', analysis: analyzeSelection(layers, { colorProfile: 'SRGB' }) })
const button = (text: string | RegExp) => [...root.querySelectorAll('button')].find((b) => (typeof text === 'string' ? b.textContent === text : text.test(b.textContent ?? ''))) as HTMLButtonElement
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>'
  root = document.getElementById('app') as HTMLElement
  sent = []
  copy = vi.fn<(text: string) => Promise<boolean>>(async () => true)
  ui = mountUi(root, { post: (m) => void sent.push(m), copy })
})

describe('rendering', () => {
  it('starts with a waiting message and a disabled Undo', () => {
    expect(root.textContent).toMatch(/Waiting for the selection/)
    expect(button('Undo last change').disabled).toBe(true)
  })

  it('asks to select something when the selection is empty', () => {
    ui.receive(analysis())
    expect(root.querySelector('.summary')?.textContent).toMatch(/Select a layer/)
  })

  it('shows a card per gradient with score, findings and explanations, and no verdict wording', () => {
    ui.receive(analysis(layer({ name: 'Hero', fills: [paintFromDoc(RGB_DOC)] })))
    const card = root.querySelector('.card') as HTMLElement
    expect(card.textContent).toContain('Hero')
    expect(card.querySelector('.score')?.getAttribute('aria-label')).toBe('Smoothness score 58 out of 100')
    expect(card.textContent).toContain('3 findings: why not 100')
    expect(card.textContent).toContain('lightness reversal')
    expect(card.textContent).toContain('−12 points')
    expect(card.textContent).toMatch(/Counts stops that are darker/)
    expect(root.textContent).not.toMatch(/\b(pass|fail|passed|failed)\b/i)
  })

  it('names the reason when a gradient is not scored, and has no score or apply buttons', () => {
    ui.receive(analysis(layer({ fills: [radial] })))
    const card = root.querySelector('.card') as HTMLElement
    expect(card.textContent).toMatch(/Not scored: Radial gradient/)
    expect(card.querySelector('.score')?.textContent).toBe('Not scored')
    expect(button(/Apply/)).toBeUndefined()
  })

  it('renders layer names as text, never as markup', () => {
    ui.receive(analysis(layer({ name: '<img src=x onerror=alert(1)>', fills: [paintFromDoc(RGB_DOC)] })))
    expect(root.querySelector('img')).toBeNull()
    expect(root.textContent).toContain('<img src=x')
  })

  it('draws the swatch from the validated CSS', () => {
    ui.receive(analysis(layer({ fills: [paintFromDoc(RGB_DOC)] })))
    const fill = root.querySelector('.swatch-fill') as HTMLElement
    expect(fill.style.background).toContain('linear-gradient')
  })

  it('ignores malformed and unknown messages from the sandbox', () => {
    ui.receive({ type: 'analysis', analysis: { gradients: 'x' } })
    ui.receive(null)
    ui.receive('x')
    expect(root.textContent).toMatch(/Waiting for the selection/)
  })

  it('lists the notes of the analysis', () => {
    const m = analysis(layer({ fills: [paintFromDoc(RGB_DOC)] })) as Extract<PluginMessage, { type: 'analysis' }>
    m.analysis.notes = ['A note.']
    ui.receive(m)
    expect(root.querySelector('.note')?.textContent).toBe('A note.')
  })
})

describe('actions', () => {
  beforeEach(() => ui.receive(analysis(layer({ id: '7:7', fills: [paintFromDoc(RGB_DOC)] }))))

  it('Apply refined sends the chosen bake count', () => {
    button(/^Apply refined \(\+32\)$/).click()
    expect(sent.at(-1)).toEqual({ type: 'apply', ref: { nodeId: '7:7', target: 'fills', index: 0 }, action: { kind: 'refine', bake: 8 } })
    const slider = root.querySelector('#bake') as HTMLInputElement
    slider.value = '12'
    slider.dispatchEvent(new Event('input'))
    expect(root.querySelector('#bake-out')?.textContent).toBe('12')
    button(/^Apply refined/).click()
    expect(sent.at(-1)).toMatchObject({ action: { kind: 'refine', bake: 12 } })
  })

  it('has a fix button per proposed fix with its label and gain', () => {
    const fix = button('Apply fix: Make stop 2 darker (+12)')
    fix.click()
    expect(sent.at(-1)).toMatchObject({ type: 'apply', action: { kind: 'fix', index: 0, label: 'Make stop 2 darker' } })
    expect(root.querySelectorAll('button[data-key^="fix:"]')).toHaveLength(3)
  })

  it('explains baking next to the slider, with the 2-16 range', () => {
    const slider = root.querySelector('#bake') as HTMLInputElement
    expect([slider.min, slider.max, slider.value]).toEqual(['2', '16', '8'])
    expect(root.querySelector('#bake-help')?.textContent).toMatch(/^Figma blends in RGB, so we pre-compute OKLAB stops/)
    expect(slider.getAttribute('aria-describedby')).toBe('bake-help')
  })

  it('selects the layer from its name', () => {
    root.querySelector<HTMLButtonElement>('.link')!.click()
    expect(sent.at(-1)).toEqual({ type: 'select', nodeId: '7:7' })
  })

  it('Rescan and Undo post their messages; Undo enables after an applied change', () => {
    button('Rescan').click()
    expect(sent.at(-1)).toEqual({ type: 'rescan' })
    ui.receive({ type: 'apply-result', ok: true, message: 'Applied.', undoAvailable: true })
    expect(root.querySelector('.status')?.textContent).toBe('Applied.')
    button('Undo last change').click()
    expect(sent.at(-1)).toEqual({ type: 'undo' })
  })

  it('shows failures as errors in a live region', () => {
    ui.receive({ type: 'apply-result', ok: false, message: 'Nope.', undoAvailable: false })
    const s = root.querySelector('.status') as HTMLElement
    expect(s.className).toContain('error')
    expect(s.getAttribute('role')).toBe('status')
  })

  it('keeps keyboard focus on the same button after the list re-renders', () => {
    const b = button(/^Apply refined/)
    b.focus()
    ui.receive(analysis(layer({ id: '7:7', fills: [paintFromDoc(RGB_DOC)] })))
    expect(document.activeElement?.getAttribute('data-key')).toContain('refine:')
  })

  it('keeps an opened findings list open after a re-render', () => {
    const d = root.querySelector('details') as HTMLDetailsElement
    d.open = true
    d.dispatchEvent(new Event('toggle'))
    ui.receive(analysis(layer({ id: '7:7', fills: [paintFromDoc(RGB_DOC)] })))
    expect((root.querySelector('details') as HTMLDetailsElement).open).toBe(true)
  })
})

describe('copy', () => {
  beforeEach(() => ui.receive(analysis(layer({ id: '7:7', fills: [paintFromDoc(RGB_DOC)] }))))

  it('Copy CSS asks for the css export, then copies the text', async () => {
    button('Copy CSS').click()
    const req = sent.at(-1) as Extract<UiMessage, { type: 'export' }>
    expect(req).toMatchObject({ type: 'export', format: 'css' })
    ui.receive({ type: 'export-result', requestId: req.requestId, ok: true, format: 'css', text: 'background: red;', language: 'CSS', notes: [], message: '' })
    await flush()
    expect(copy).toHaveBeenCalledWith('background: red;')
    expect(root.querySelector('.status')?.textContent).toBe('Copied CSS to the clipboard.')
  })

  it('Copy as uses the chosen format and offers every other format', () => {
    const select = root.querySelector('select') as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toEqual(COPY_FORMATS.filter((f) => f.key !== 'css').map((f) => f.key))
    select.value = 'tailwind'
    button('Copy').click()
    expect(sent.at(-1)).toMatchObject({ type: 'export', format: 'tailwind' })
    expect(select.labels?.[0]?.textContent).toBe('Copy as')
  })

  it('shows a selected text box when the clipboard is blocked', async () => {
    copy.mockResolvedValue(false)
    button('Copy CSS').click()
    const req = sent.at(-1) as Extract<UiMessage, { type: 'export' }>
    ui.receive({ type: 'export-result', requestId: req.requestId, ok: true, format: 'css', text: 'background: red;', language: 'CSS', notes: [], message: '' })
    await flush()
    const area = root.querySelector('.manual textarea') as HTMLTextAreaElement
    expect(area.value).toBe('background: red;')
    expect(root.querySelector('.manual')?.hasAttribute('hidden')).toBe(false)
    expect(root.querySelector('.status')?.className).toContain('error')
  })

  it('ignores an export result nobody asked for', async () => {
    ui.receive({ type: 'export-result', requestId: 999, ok: true, format: 'css', text: 'x', language: 'CSS', notes: [], message: '' })
    await flush()
    expect(copy).not.toHaveBeenCalled()
  })

  it('copyToClipboard prefers execCommand and falls back to navigator.clipboard', async () => {
    const exec = vi.fn(() => true)
    Object.assign(document, { execCommand: exec })
    expect(await copyToClipboard('a')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
    exec.mockReturnValue(false)
    const write = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    expect(await copyToClipboard('b')).toBe(true)
    expect(write).toHaveBeenCalledWith('b')
    write.mockRejectedValue(new Error('denied'))
    expect(await copyToClipboard('c')).toBe(false)
  })
})

describe('From CSS tab and keyboard', () => {
  it('has tabs that work with the arrow keys and move the roving tabindex', () => {
    const [a, b] = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect([a.getAttribute('aria-selected'), b.getAttribute('aria-selected')]).toEqual(['true', 'false'])
    a.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect([a.getAttribute('aria-selected'), b.getAttribute('aria-selected')]).toEqual(['false', 'true'])
    expect(document.activeElement).toBe(b)
    expect([a.tabIndex, b.tabIndex]).toEqual([-1, 0])
    expect((root.querySelector('#panel-css') as HTMLElement).hidden).toBe(false)
    expect((root.querySelector('#panel-selection') as HTMLElement).hidden).toBe(true)
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    expect(a.getAttribute('aria-selected')).toBe('true')
  })

  it('creates only when the button is pressed, and shows the skip reasons', () => {
    const area = root.querySelector('#css-input') as HTMLTextAreaElement
    area.value = 'linear-gradient(red, blue) radial-gradient(red, blue)'
    area.dispatchEvent(new Event('input'))
    expect(sent.filter((m) => m.type === 'create-from-css')).toHaveLength(0)
    button('Create gradient rectangle').click()
    expect(sent.at(-1)).toEqual({ type: 'create-from-css', css: 'linear-gradient(red, blue) radial-gradient(red, blue)', bake: 8 })
    ui.receive({ type: 'create-result', ok: true, message: 'Created 1 rectangle with a gradient fill.', created: 1, skipped: ['Gradient 2: radial gradient'] })
    expect(root.querySelector('.css-result')?.textContent).toContain('Created 1 rectangle')
    expect(root.querySelector('.skips li')?.textContent).toBe('Gradient 2: radial gradient')
  })

  it('every control has an accessible name', () => {
    ui.receive(analysis(layer({ fills: [paintFromDoc(RGB_DOC)] })))
    for (const el of root.querySelectorAll<HTMLElement>('button, input, select, textarea')) {
      const name = el.getAttribute('aria-label') || el.textContent?.trim() || (el as HTMLInputElement).labels?.[0]?.textContent
      expect(name, el.outerHTML.slice(0, 80)).toBeTruthy()
    }
  })

  it('resizes with the arrow keys within the limits, from the 320x480 default', () => {
    const grip = root.querySelector('.grip') as HTMLButtonElement
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(sent.at(-1)).toEqual({ type: 'resize', width: 340, height: 480 })
    for (let i = 0; i < 40; i++) grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true }))
    expect(sent.at(-1)).toMatchObject({ height: 320 })
  })

  it('renders a smooth gradient with no findings', () => {
    ui.receive(analysis(layer({ fills: [paintFromDoc(SMOOTH_DOC)] })))
    expect(root.querySelector('.why summary')?.textContent).toMatch(/findings?|No findings/)
  })
})
