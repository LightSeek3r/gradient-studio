// ── The plugin window: DOM only, no `figma`, no network ──────────────────────
//
// `mountUi(root, env)` builds the interface into `root`, sends `UiMessage`s
// through `env.post` and renders the validated `PluginMessage`s it is given
// through the returned `receive`. Every string from the sandbox is rendered
// with `textContent`; the only value assigned to `style` is a swatch that
// `parsePluginMessage` has already matched against a strict pattern.
//
// Not run inside Figma. The jsdom tests exercise it; see docs/figma.md.

import {
  BAKE_DEFAULT,
  BAKE_MAX,
  BAKE_MIN,
  COPY_FORMATS,
  DEFAULT_SIZE,
  MAX_CSS_LENGTH,
  SIZE_LIMITS,
  clampSize,
  parsePluginMessage,
  type AnalysisPayload,
  type CopyFormatKey,
  type GradientRef,
  type GradientView,
  type PluginMessage,
  type UiMessage,
} from './messages'

export interface UiEnv {
  post(message: UiMessage): void
  /** Put text on the clipboard; resolves false when the browser refuses. */
  copy(text: string): Promise<boolean>
}

export interface UiHandle {
  /** Feed a raw message from the sandbox (validated here). */
  receive(raw: unknown): void
}

type Child = Node | string | null | undefined | false

interface Props {
  class?: string
  text?: string
  title?: string
  attrs?: Record<string, string>
  on?: Partial<Record<'click' | 'input' | 'change' | 'keydown' | 'pointerdown' | 'pointermove' | 'pointerup', (e: Event) => void>>
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (props.class) el.className = props.class
  if (props.text !== undefined) el.textContent = props.text
  if (props.title !== undefined) el.title = props.title
  for (const [k, v] of Object.entries(props.attrs ?? {})) el.setAttribute(k, v)
  for (const [k, fn] of Object.entries(props.on ?? {})) if (fn) el.addEventListener(k, fn)
  for (const c of children) if (c) el.append(c)
  return el
}

const MINUS = '−'
const refKey = (r: GradientRef): string => `${r.nodeId}|${r.target}|${r.index}`
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

function describePaint(g: GradientView): string {
  const where = g.ref.target === 'fills' ? `Fill ${g.ref.index + 1}` : `Stroke ${g.ref.index + 1}`
  const kind = g.paintType.replace('GRADIENT_', '').toLowerCase()
  const shape = g.paintType === 'GRADIENT_LINEAR' ? `linear${g.angle === null ? '' : ` ${g.angle}°`}` : kind
  return `${where} · ${shape} · ${plural(g.stopCount, 'stop')}`
}

export function mountUi(root: HTMLElement, env: UiEnv): UiHandle {
  let analysis: AnalysisPayload | null = null
  let bake = BAKE_DEFAULT
  let undoAvailable = false
  let nextRequest = 1
  const pendingCopies = new Map<number, string>()
  const openDetails = new Set<string>()
  let size: { width: number; height: number } = { width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height }

  // ── static structure ──
  const status = h('p', { class: 'status', attrs: { role: 'status', 'aria-live': 'polite' } })
  const list = h('ul', { class: 'cards', attrs: { 'aria-label': 'Gradients in the selection' } })
  const summary = h('p', { class: 'summary' })
  const manual = h('div', { class: 'manual', attrs: { hidden: '' } })

  const bakeValue = h('output', { class: 'bake-value', text: String(bake), attrs: { id: 'bake-out', for: 'bake' } })
  const bakeInput = h('input', {
    attrs: { id: 'bake', type: 'range', min: String(BAKE_MIN), max: String(BAKE_MAX), step: '1', value: String(bake), 'aria-describedby': 'bake-help' },
    on: {
      input: () => {
        bake = Number(bakeInput.value)
        bakeValue.textContent = String(bake)
      },
    },
  })
  const bakeRow = h(
    'div',
    { class: 'bake' },
    h('label', { text: 'Baked stops', attrs: { for: 'bake' } }),
    bakeInput,
    bakeValue,
    h('p', {
      class: 'help',
      attrs: { id: 'bake-help' },
      text: `Figma blends in RGB, so we pre-compute OKLAB stops: "Apply refined" writes about this many stops (${BAKE_MIN} keeps just the refined stops). Fixes change only the stops they name.`,
    }),
  )

  const undoButton = h('button', { class: 'btn', text: 'Undo last change', attrs: { type: 'button', disabled: '' }, on: { click: () => env.post({ type: 'undo' }) } })
  const rescanButton = h('button', { class: 'btn', text: 'Rescan', attrs: { type: 'button' }, on: { click: () => env.post({ type: 'rescan' }) } })

  const selectionPanel = h('section', { class: 'panel', attrs: { id: 'panel-selection', role: 'tabpanel', 'aria-labelledby': 'tab-selection' } }, summary, list)

  // Create from CSS
  const cssInput = h('textarea', {
    attrs: { id: 'css-input', rows: '5', spellcheck: 'false', maxlength: String(MAX_CSS_LENGTH), placeholder: 'linear-gradient(135deg, #101b45, #9333ea)', 'aria-describedby': 'css-help' },
  })
  const cssResult = h('div', { class: 'css-result', attrs: { role: 'status', 'aria-live': 'polite' } })
  const cssPanel = h(
    'section',
    { class: 'panel', attrs: { id: 'panel-css', role: 'tabpanel', 'aria-labelledby': 'tab-css', hidden: '' } },
    h('label', { text: 'CSS gradient', attrs: { for: 'css-input' } }),
    cssInput,
    h('p', {
      class: 'help',
      attrs: { id: 'css-help' },
      text: 'Paste any CSS that contains linear-gradient(...). Nothing is created until you press the button. Radial, conic, repeating and var() gradients are reported and skipped.',
    }),
    h('button', {
      class: 'btn primary',
      text: 'Create gradient rectangle',
      attrs: { type: 'button' },
      on: { click: () => env.post({ type: 'create-from-css', css: cssInput.value, bake }) },
    }),
    cssResult,
  )

  // Tabs
  const tabs: { id: 'selection' | 'css'; label: string; button: HTMLButtonElement }[] = (
    [
      { id: 'selection', label: 'Selection' },
      { id: 'css', label: 'From CSS' },
    ] as const
  ).map(({ id, label }) => ({
    id,
    label,
    button: h('button', { class: 'tab', text: label, attrs: { id: `tab-${id}`, type: 'button', role: 'tab', 'aria-controls': `panel-${id}` } }),
  }))
  const tablist = h('div', { class: 'tabs', attrs: { role: 'tablist', 'aria-label': 'Plugin sections' } }, ...tabs.map((t) => t.button))
  const setTab = (id: 'selection' | 'css', focus = false): void => {
    for (const t of tabs) {
      const on = t.id === id
      t.button.setAttribute('aria-selected', String(on))
      t.button.tabIndex = on ? 0 : -1
      if (on && focus) t.button.focus()
    }
    selectionPanel.hidden = id !== 'selection'
    cssPanel.hidden = id !== 'css'
  }
  tabs.forEach((t, i) => {
    t.button.addEventListener('click', () => setTab(t.id))
    t.button.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key
      const to = k === 'ArrowRight' ? i + 1 : k === 'ArrowLeft' ? i - 1 : k === 'Home' ? 0 : k === 'End' ? tabs.length - 1 : -1
      if (to < 0) return
      e.preventDefault()
      setTab(tabs[(to + tabs.length) % tabs.length].id, true)
    })
  })

  // Resize grip: drag, or arrow keys when focused.
  const applySize = (w: number, hh: number): void => {
    size = { width: clampSize(w, 'Width'), height: clampSize(hh, 'Height') }
    env.post({ type: 'resize', width: size.width, height: size.height })
  }
  let drag: { x: number; y: number; w: number; h: number } | null = null
  const grip = h('button', {
    class: 'grip',
    attrs: {
      type: 'button',
      'aria-label': `Resize the plugin window. Arrow keys change its size; it is ${DEFAULT_SIZE.width} by ${DEFAULT_SIZE.height} pixels by default.`,
      title: 'Drag or use the arrow keys to resize',
    },
    on: {
      pointerdown: (e) => {
        const p = e as PointerEvent
        drag = { x: p.clientX, y: p.clientY, w: size.width, h: size.height }
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(p.pointerId)
      },
      pointermove: (e) => {
        if (!drag) return
        const p = e as PointerEvent
        applySize(drag.w + (p.clientX - drag.x), drag.h + (p.clientY - drag.y))
      },
      pointerup: () => {
        drag = null
      },
      keydown: (e) => {
        const k = (e as KeyboardEvent).key
        const step = (e as KeyboardEvent).shiftKey ? 80 : 20
        const d = k === 'ArrowRight' ? [step, 0] : k === 'ArrowLeft' ? [-step, 0] : k === 'ArrowDown' ? [0, step] : k === 'ArrowUp' ? [0, -step] : null
        if (!d) return
        e.preventDefault()
        applySize(size.width + d[0], size.height + d[1])
      },
    },
  })

  root.replaceChildren(
    h(
      'header',
      { class: 'top' },
      h('h1', { text: 'Gradient Score' }),
      h('div', { class: 'top-actions' }, rescanButton, undoButton),
    ),
    tablist,
    bakeRow,
    status,
    manual,
    h('main', { attrs: { id: 'main' } }, selectionPanel, cssPanel),
    h('footer', { class: 'foot' }, h('p', { text: 'Runs locally. No network access, no telemetry. The smoothness score describes the stops; it is not a verdict.' }), grip),
  )
  setTab('selection')

  // ── rendering ──
  const say = (text: string, kind: 'ok' | 'error' = 'ok'): void => {
    status.textContent = text
    status.className = `status ${kind}`
  }

  const requestCopy = (ref: GradientRef, format: CopyFormatKey): void => {
    const id = nextRequest++
    pendingCopies.set(id, format)
    env.post({ type: 'export', requestId: id, ref, format })
  }

  const showManual = (text: string, label: string): void => {
    const area = h('textarea', { attrs: { readonly: '', rows: '5', 'aria-label': `${label}: select all and copy` } })
    area.value = text
    manual.replaceChildren(
      h('p', { text: 'Your browser blocked the clipboard. The text is selected below: press Ctrl+C (Cmd+C on a Mac).' }),
      area,
      h('button', { class: 'btn', text: 'Close', attrs: { type: 'button' }, on: { click: () => manual.setAttribute('hidden', '') } }),
    )
    manual.removeAttribute('hidden')
    area.focus()
    area.select()
  }

  const card = (g: GradientView): HTMLElement => {
    const key = refKey(g.ref)
    const swatch = h('span', { class: `swatch${g.translucent ? ' checker' : ''}`, attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'swatch-fill' }))
    const fill = swatch.firstElementChild as HTMLElement
    if (g.swatch) fill.style.background = g.swatch
    else swatch.classList.add('none')

    const layer = h('button', {
      class: 'link',
      text: g.nodeName || g.nodeType,
      attrs: { type: 'button', title: 'Select this layer on the canvas', 'data-key': `select:${key}` },
      on: { click: () => env.post({ type: 'select', nodeId: g.ref.nodeId }) },
    })

    const scoreBox =
      g.score === null
        ? h('div', { class: 'score none' }, h('span', { text: 'Not scored' }))
        : h(
            'div',
            { class: 'score', attrs: { role: 'img', 'aria-label': `Smoothness score ${g.score} out of 100` } },
            h('strong', { text: String(g.score) }),
            h('span', { text: '/100' }),
            h('span', { class: 'bar', attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'bar-fill', attrs: { style: `width:${g.score}%` } })),
          )

    const chips = h('p', { class: 'chips' })
    if (g.hidden) chips.append(h('span', { class: 'chip', text: 'Hidden' }))
    if (g.translucent) chips.append(h('span', { class: 'chip', text: 'Transparency' }))
    if (g.paintOpacity < 1) chips.append(h('span', { class: 'chip', text: `Paint opacity ${Math.round(g.paintOpacity * 100)}%` }))
    if (g.geometry === 'custom') chips.append(h('span', { class: 'chip', title: 'The handles were moved or skewed. Writes keep this layer\'s own matrix.', text: 'Custom handles' }))
    if (!chips.childElementCount) chips.hidden = true

    const el = h(
      'li',
      { class: 'card', attrs: { 'data-key': key } },
      h('div', { class: 'head' }, swatch, h('div', { class: 'meta' }, layer, h('span', { class: 'sub', text: describePaint(g) })), scoreBox),
      chips,
    )

    if (g.reason) el.append(h('p', { class: 'reason', text: g.reason.text }))

    if (g.status === 'scored') {
      const dimText = g.dimensions.map((d) => `${d.label} ${d.kept}/${d.max}`).join(' · ')
      const why = h('details', { class: 'why', attrs: { 'data-open': `why:${key}` } })
      if (openDetails.has(`why:${key}`)) why.open = true
      why.addEventListener('toggle', () => (why.open ? openDetails.add(`why:${key}`) : openDetails.delete(`why:${key}`)))
      const n = g.issues.length
      why.append(h('summary', { text: n === 0 ? 'No findings. How the score is built' : `${plural(n, 'finding')}: why not 100` }))
      const ul = h('ul', { class: 'issues' })
      for (const i of g.issues) {
        ul.append(
          h(
            'li',
            {},
            h('span', { class: 'issue-head' }, h('strong', { text: i.name }), h('span', { class: 'pts', text: ` ${MINUS}${i.points} points` })),
            h('span', { class: 'issue-msg', text: i.message }),
            h('span', { class: 'issue-measures', text: i.measures }),
          ),
        )
      }
      why.append(ul, h('p', { class: 'dims', text: `Points kept: ${dimText}` }))
      el.append(why)
    }

    for (const w of g.warnings) el.append(h('p', { class: 'warn', text: w }))

    const actions = h('div', { class: 'actions' })
    if (g.refine) {
      actions.append(
        h('button', {
          class: 'btn primary',
          text: `Apply refined (+${g.refine.gain})`,
          attrs: { type: 'button', 'data-key': `refine:${key}`, title: `Smoothness ${g.score} to ${g.refine.scoreAfter}, about ${bake} stops` },
          on: { click: () => env.post({ type: 'apply', ref: g.ref, action: { kind: 'refine', bake } }) },
        }),
      )
    }
    for (const f of g.fixes) {
      actions.append(
        h('button', {
          class: 'btn',
          text: `Apply fix: ${f.label} (+${f.gain})`,
          attrs: { type: 'button', 'data-key': `fix:${key}:${f.index}`, title: `Smoothness ${g.score} to ${f.scoreAfter}` },
          on: { click: () => env.post({ type: 'apply', ref: g.ref, action: { kind: 'fix', index: f.index, label: f.label } }) },
        }),
      )
    }
    if (g.exportable) {
      const selectId = `fmt-${key.replace(/[^A-Za-z0-9]/g, '_')}`
      const select = h('select', { attrs: { id: selectId } })
      for (const f of COPY_FORMATS) if (f.key !== 'css') select.append(h('option', { text: f.label, attrs: { value: f.key } }))
      actions.append(
        h('button', {
          class: 'btn',
          text: 'Copy CSS',
          attrs: { type: 'button', 'data-key': `copy-css:${key}` },
          on: { click: () => requestCopy(g.ref, 'css') },
        }),
        h(
          'span',
          { class: 'copy-as' },
          h('label', { text: 'Copy as', attrs: { for: selectId } }),
          select,
          h('button', {
            class: 'btn',
            text: 'Copy',
            attrs: { type: 'button', 'data-key': `copy-as:${key}`, 'aria-label': 'Copy in the chosen format' },
            on: { click: () => requestCopy(g.ref, select.value as CopyFormatKey) },
          }),
        ),
      )
    }
    if (actions.childElementCount) el.append(actions)
    return el
  }

  const render = (): void => {
    const active = document.activeElement
    const focusKey = active instanceof HTMLElement && root.contains(active) ? active.getAttribute('data-key') : null
    list.replaceChildren()
    if (!analysis) {
      summary.textContent = 'Waiting for the selection...'
    } else if (analysis.selectionCount === 0) {
      summary.textContent = 'Select a layer, frame or group. Gradient fills and strokes inside the selection are scored.'
    } else if (analysis.gradients.length === 0) {
      summary.textContent = `No gradient fills or strokes in the selection (${plural(analysis.scannedLayers, 'layer')} checked${analysis.otherPaints ? `, ${plural(analysis.otherPaints, 'other paint')} ignored` : ''}).`
    } else {
      summary.textContent = `${plural(analysis.gradients.length, 'gradient')} in ${plural(analysis.scannedLayers, 'layer')}.`
    }
    if (analysis) {
      for (const g of analysis.gradients) list.append(card(g))
      for (const note of analysis.notes) list.append(h('li', { class: 'note', text: note }))
    }
    undoButton.toggleAttribute('disabled', !undoAvailable)
    if (focusKey) {
      for (const el of root.querySelectorAll<HTMLElement>('[data-key]')) {
        if (el.getAttribute('data-key') === focusKey) {
          el.focus()
          break
        }
      }
    }
  }

  const handle = (m: PluginMessage): void => {
    switch (m.type) {
      case 'analysis':
        analysis = m.analysis
        render()
        return
      case 'apply-result':
      case 'undo-result':
        undoAvailable = m.undoAvailable
        say(m.message, m.ok ? 'ok' : 'error')
        render()
        return
      case 'export-result': {
        const label = pendingCopies.get(m.requestId)
        pendingCopies.delete(m.requestId)
        if (label === undefined) return
        if (!m.ok) {
          say(m.message, 'error')
          return
        }
        const name = COPY_FORMATS.find((f) => f.key === m.format)?.label ?? m.format
        void env.copy(m.text).then((done) => {
          if (done) {
            manual.setAttribute('hidden', '')
            say(`Copied ${name} to the clipboard.${m.notes.length ? ` ${m.notes[0]}` : ''}`)
          } else {
            say(`Could not copy ${name} automatically.`, 'error')
            showManual(m.text, name)
          }
        })
        return
      }
      case 'create-result':
        cssResult.replaceChildren(h('p', { class: m.ok ? 'ok' : 'error', text: m.message }))
        if (m.skipped.length) cssResult.append(h('ul', { class: 'skips' }, ...m.skipped.map((s) => h('li', { text: s }))))
        return
      case 'error':
        say(m.message, 'error')
        return
    }
  }

  render()
  return {
    receive(raw) {
      const parsed = parsePluginMessage(raw)
      if (parsed.ok) handle(parsed.value)
    },
  }
}

export { SIZE_LIMITS }

/** Clipboard through a hidden textarea and `execCommand` first (works in sandboxed iframes), `navigator.clipboard` second. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    area.style.pointerEvents = 'none'
    document.body.append(area)
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    area.select()
    let ok = false
    try {
      ok = typeof document.execCommand === 'function' && document.execCommand('copy')
    } catch {
      ok = false
    }
    area.remove()
    previous?.focus()
    if (ok) return true
  } catch {
    // fall through to the async clipboard
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // refused
  }
  return false
}
