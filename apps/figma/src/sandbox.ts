// ── The plugin sandbox: everything that touches `figma.*` ─────────────────────
//
// `start(api, html)` wires a Figma-like API to the pure modules. `code.ts`
// calls it with the real `figma` global; the tests call it with a stub.
//
// Writes are plain property assignments (`node.fills = [...]`, as the typings
// describe), preceded by `commitUndo()` so Figma's own Edit > Undo can revert
// exactly one plugin action. The plugin also keeps the paints it replaced and
// restores them on "Undo" (only while the layer still holds what it wrote).
// None of this has been run inside Figma: see docs/figma.md.

import { parseGradient } from '@opal42/gradient'
import { toFigmaPaint } from '@opal42/gradient/export'
import { analyzeSelection, exportPaint, planApply, type HostLike } from './analyze'
import { BAKE_DEFAULT, DEFAULT_SIZE, MAX_CSS_LENGTH, clampSize, parseUiMessage, type GradientRef, type PluginMessage, type UiMessage } from './messages'
import { sameStops, type PaintLike } from './paint-adapter'

/** A scene node as the sandbox needs it: readable layer facts plus writable paints. */
export type NodeHandle = HostLike

export interface RectHandle extends HostLike {
  x: number
  y: number
  resize(width: number, height: number): void
}

/** The part of `PluginAPI` this plugin uses; the real `figma` global satisfies it. */
export interface FigmaLike {
  showUI(html: string, options?: { width?: number; height?: number; themeColors?: boolean; title?: string }): void
  ui: {
    postMessage(message: unknown): void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onmessage: ((message: any, props: any) => void) | undefined
    resize(width: number, height: number): void
  }
  on(type: 'selectionchange' | 'currentpagechange' | 'close', callback: () => void): void
  currentPage: { selection: readonly HostLike[] }
  root: { documentColorProfile?: string }
  viewport: { center: { x: number; y: number }; scrollAndZoomIntoView(nodes: readonly HostLike[]): void }
  notify(message: string, options?: { error?: boolean; timeout?: number }): unknown
  commitUndo(): void
  getNodeByIdAsync(id: string): Promise<NodeHandle | null>
  createRectangle(): RectHandle
}

interface UndoEntry {
  nodeId: string
  target: 'fills' | 'strokes'
  index: number
  /** The paints array before the write. */
  before: readonly unknown[]
  /** The paint written at `index`. */
  wrote: PaintLike
}

const UNDO_DEPTH = 20
const CREATE_LIMIT = 10
const RECT = { width: 320, height: 200, gap: 24 } as const

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 300)

export function start(api: FigmaLike, html: string): void {
  api.showUI(html, { width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height, themeColors: true, title: 'Opal42 Gradient Score' })

  const undoStack: UndoEntry[] = []
  const send = (message: PluginMessage): void => {
    try {
      api.ui.postMessage(message)
    } catch {
      // The UI is gone (plugin closing): nothing to tell.
    }
  }

  const colorProfile = (): string => {
    try {
      return String(api.root.documentColorProfile ?? 'UNKNOWN')
    } catch {
      return 'UNKNOWN'
    }
  }

  const sendAnalysis = (): void => {
    try {
      send({ type: 'analysis', analysis: analyzeSelection(api.currentPage.selection, { colorProfile: colorProfile() }) })
    } catch (e) {
      send({ type: 'error', message: `Could not analyse the selection: ${errorText(e)}` })
    }
  }

  /** The live paint a reference points at, and the layer, or why not. */
  const lookup = async (ref: GradientRef): Promise<{ node: NodeHandle; paints: readonly unknown[]; paint: PaintLike } | string> => {
    const node = await api.getNodeByIdAsync(ref.nodeId)
    if (!node) return 'That layer no longer exists. Rescanned.'
    const paints = node[ref.target]
    if (!Array.isArray(paints)) return 'That layer has no editable paints of this kind (mixed fills?). Rescanned.'
    const paint = paints[ref.index] as PaintLike | undefined
    if (!paint || typeof paint.type !== 'string' || !paint.type.startsWith('GRADIENT_')) return 'That paint is no longer a gradient. Rescanned.'
    return { node, paints, paint }
  }

  const onApply = async (msg: Extract<UiMessage, { type: 'apply' }>): Promise<void> => {
    const found = await lookup(msg.ref)
    if (typeof found === 'string') {
      send({ type: 'apply-result', ok: false, message: found, undoAvailable: undoStack.length > 0 })
      sendAnalysis()
      return
    }
    const plan = planApply(found.paint, found.node, msg.action)
    if (plan.status !== 'write') {
      send({ type: 'apply-result', ok: plan.status === 'noop', message: plan.reason, undoAvailable: undoStack.length > 0 })
      if (plan.status === 'blocked') sendAnalysis()
      return
    }
    try {
      api.commitUndo()
      const next = found.paints.slice()
      next[msg.ref.index] = plan.paint
      found.node[msg.ref.target] = next
      undoStack.push({ nodeId: msg.ref.nodeId, target: msg.ref.target, index: msg.ref.index, before: found.paints, wrote: plan.paint })
      if (undoStack.length > UNDO_DEPTH) undoStack.shift()
    } catch (e) {
      send({ type: 'apply-result', ok: false, message: `Figma did not accept the change: ${errorText(e)}`, undoAvailable: undoStack.length > 0 })
      return
    }
    send({ type: 'apply-result', ok: true, message: `${plan.summary} Edit > Undo in Figma reverts it.`, undoAvailable: true })
    sendAnalysis()
  }

  const onUndo = async (): Promise<void> => {
    const entry = undoStack.pop()
    if (!entry) {
      send({ type: 'undo-result', ok: false, message: 'Nothing to undo.', undoAvailable: false })
      return
    }
    const node = await api.getNodeByIdAsync(entry.nodeId)
    const current = node ? node[entry.target] : null
    const now = Array.isArray(current) ? (current[entry.index] as PaintLike | undefined) : undefined
    if (!node || !now || !sameStops(now.gradientStops, entry.wrote.gradientStops)) {
      send({ type: 'undo-result', ok: false, message: 'That layer changed after the plugin wrote to it, so the plugin did not overwrite it. Use Edit > Undo in Figma.', undoAvailable: undoStack.length > 0 })
      sendAnalysis()
      return
    }
    try {
      api.commitUndo()
      node[entry.target] = entry.before
    } catch (e) {
      send({ type: 'undo-result', ok: false, message: `Figma did not accept the change: ${errorText(e)}`, undoAvailable: undoStack.length > 0 })
      return
    }
    send({ type: 'undo-result', ok: true, message: 'Restored the previous paint.', undoAvailable: undoStack.length > 0 })
    sendAnalysis()
  }

  const onExport = async (msg: Extract<UiMessage, { type: 'export' }>): Promise<void> => {
    const base = { type: 'export-result', requestId: msg.requestId, format: msg.format } as const
    const found = await lookup(msg.ref)
    if (typeof found === 'string') {
      send({ ...base, ok: false, text: '', language: '', notes: [], message: found })
      return
    }
    const out = exportPaint(found.paint, found.node, msg.format)
    if (out.status !== 'ok') send({ ...base, ok: false, text: '', language: '', notes: [], message: out.reason })
    else send({ ...base, ok: true, text: out.text, language: out.language, notes: out.notes, message: '' })
  }

  const onCreate = (msg: Extract<UiMessage, { type: 'create-from-css' }>): void => {
    const parsed = parseGradient(msg.css, { maxInputLength: MAX_CSS_LENGTH })
    if (parsed.gradients.length === 0) {
      send({ type: 'create-result', ok: false, created: 0, skipped: [], message: 'No gradient found. Paste CSS such as linear-gradient(90deg, #ff0066, #3300ff).' })
      return
    }
    const skipped: string[] = []
    const made: RectHandle[] = []
    const notes: string[] = []
    const center = api.viewport.center
    api.commitUndo()
    parsed.gradients.forEach((g, i) => {
      const label = `Gradient ${i + 1}`
      if (made.length >= CREATE_LIMIT) {
        if (made.length === CREATE_LIMIT && !skipped.some((s) => s.startsWith('Only the first'))) skipped.push(`Only the first ${CREATE_LIMIT} gradients were created.`)
        return
      }
      if (!g.document) {
        skipped.push(`${label}: ${g.skipped?.reason ?? 'not understood'}`)
        return
      }
      const interpolates = g.document.interpolation !== undefined && g.document.interpolation.space !== 'srgb'
      const out = toFigmaPaint(g.document, { aspect: RECT.width / RECT.height, ...(interpolates ? { bake: msg.bake } : {}) })
      if (out.status !== 'ok') {
        skipped.push(`${label}: ${out.reason}`)
        return
      }
      for (const w of g.warnings) notes.push(`${label}: ${w.message}`)
      for (const n of out.notes.filter((x) => !x.startsWith('Paste into') && !x.startsWith('The gradientTransform'))) notes.push(`${label}: ${n}`)
      const rect = api.createRectangle()
      rect.name = `Gradient from CSS ${made.length + 1}`
      rect.resize(RECT.width, RECT.height)
      rect.x = Math.round(center.x - RECT.width / 2 + made.length * (RECT.width + RECT.gap))
      rect.y = Math.round(center.y - RECT.height / 2)
      rect.fills = [out.paint]
      made.push(rect)
    })
    if (made.length > 0) {
      api.currentPage.selection = made
      api.viewport.scrollAndZoomIntoView(made)
    }
    const head = made.length === 0 ? 'Nothing was created.' : `Created ${made.length} rectangle${made.length === 1 ? '' : 's'} with a gradient fill.`
    const extra = notes.length > 0 ? ` ${notes.slice(0, 3).join(' ')}` : ''
    send({ type: 'create-result', ok: made.length > 0, created: made.length, skipped: skipped.slice(0, 50), message: `${head}${extra}`.slice(0, 590) })
  }

  const onSelect = async (nodeId: string): Promise<void> => {
    const node = await api.getNodeByIdAsync(nodeId)
    if (!node || node.type === 'PAGE' || node.type === 'DOCUMENT') return
    api.currentPage.selection = [node]
    api.viewport.scrollAndZoomIntoView([node])
  }

  const handle = async (raw: unknown): Promise<void> => {
    const parsed = parseUiMessage(raw)
    if (!parsed.ok) {
      send({ type: 'error', message: `Ignored a malformed message from the plugin window: ${parsed.error}` })
      return
    }
    const msg = parsed.value
    switch (msg.type) {
      case 'ready':
      case 'rescan':
        sendAnalysis()
        return
      case 'select':
        return onSelect(msg.nodeId)
      case 'apply':
        return onApply(msg)
      case 'undo':
        return onUndo()
      case 'export':
        return onExport(msg)
      case 'create-from-css':
        return onCreate(msg)
      case 'resize':
        api.ui.resize(clampSize(msg.width, 'Width'), clampSize(msg.height, 'Height'))
        return
    }
  }

  api.ui.onmessage = (raw) => {
    handle(raw).catch((e: unknown) => send({ type: 'error', message: `Something went wrong: ${errorText(e)}` }))
  }
  api.on('selectionchange', sendAnalysis)
  api.on('currentpagechange', sendAnalysis)
  sendAnalysis()
}

/** Bake count used when the UI does not say (kept in one place for docs and tests). */
export const DEFAULT_BAKE = BAKE_DEFAULT
