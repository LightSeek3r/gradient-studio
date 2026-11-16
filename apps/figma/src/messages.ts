// ── The typed message protocol between the plugin sandbox and its UI iframe ───
//
// Pure: no `figma`, no DOM. Both directions are validated before use.
//
//   UI -> sandbox   `UiMessage`      checked by `parseUiMessage` (the sandbox
//                                    never trusts the iframe: ids and choices
//                                    only, never paint data to write)
//   sandbox -> UI   `PluginMessage`  checked by `parsePluginMessage`
//
// Figma's transport wraps UI-side posts as `{ pluginMessage: msg }`; that
// envelope is handled by the two thin adapters in `ui.ts` and `sandbox.ts`.

/** Formats offered by "Copy as ..."; kept equal to core's `EXPORT_FORMATS` by a test. */
export const COPY_FORMATS = [
  { key: 'css', label: 'CSS' },
  { key: 'css-oklab', label: 'CSS (OKLAB)' },
  { key: 'tailwind', label: 'Tailwind' },
  { key: 'scss', label: 'SCSS' },
  { key: 'css-variables', label: 'CSS variables' },
  { key: 'svg', label: 'SVG' },
  { key: 'swiftui', label: 'SwiftUI' },
  { key: 'compose', label: 'Compose' },
  { key: 'flutter', label: 'Flutter' },
  { key: 'godot', label: 'Godot' },
  { key: 'android', label: 'Android' },
  { key: 'dtcg', label: 'DTCG tokens' },
  { key: 'figma', label: 'Figma paint (JSON)' },
] as const

export type CopyFormatKey = (typeof COPY_FORMATS)[number]['key']

export const BAKE_MIN = 2
export const BAKE_MAX = 16
export const BAKE_DEFAULT = 8

export const SIZE_LIMITS = { minWidth: 280, maxWidth: 720, minHeight: 320, maxHeight: 900 } as const
export const DEFAULT_SIZE = { width: 320, height: 480 } as const

export const MAX_CSS_LENGTH = 20000

// ── Shared shapes ─────────────────────────────────────────────────────────────

/** Which paint of which layer: stable across a rescan as long as the layer and the paint exist. */
export interface GradientRef {
  nodeId: string
  target: 'fills' | 'strokes'
  index: number
}

export type ApplyAction = { kind: 'refine'; bake: number } | { kind: 'fix'; index: number; label: string }

export type UiMessage =
  | { type: 'ready' }
  | { type: 'rescan' }
  | { type: 'select'; nodeId: string }
  | { type: 'apply'; ref: GradientRef; action: ApplyAction }
  | { type: 'undo' }
  | { type: 'export'; requestId: number; ref: GradientRef; format: CopyFormatKey }
  | { type: 'create-from-css'; css: string; bake: number }
  | { type: 'resize'; width: number; height: number }

export type Severity = 'error' | 'warning' | 'info'

export interface IssueView {
  code: string
  severity: Severity
  /** Points this finding takes off the score (before the per-dimension floor at 0). */
  points: number
  /** Short plain name ("lightness reversal"). */
  name: string
  /** One sentence on what the rule measures. */
  measures: string
  /** The core's located message. */
  message: string
  /** Stop numbers (1-based) the finding names. */
  stops: number[]
}

export interface FixView {
  index: number
  label: string
  gain: number
  scoreAfter: number
}

export interface DimensionView {
  key: 'lightness' | 'hue' | 'chroma' | 'spacing'
  label: string
  kept: number
  max: number
}

export interface GradientView {
  ref: GradientRef
  nodeName: string
  nodeType: string
  paintType: string
  hidden: boolean
  status: 'scored' | 'not-scored'
  score: number | null
  dimensions: DimensionView[]
  issues: IssueView[]
  /** Why a gradient is not scored (null when it is). */
  reason: { code: string; text: string } | null
  /** A CSS `linear-gradient(...)` for the swatch, or null (non-linear paints). */
  swatch: string | null
  stopCount: number
  /** CSS angle the paint encodes, when it is a linear paint that could be read. */
  angle: number | null
  /** True when a stop is translucent (the swatch gets a checkerboard). */
  translucent: boolean
  /** The paint's own opacity (0-1); it is kept as it is on every write. */
  paintOpacity: number
  /** `custom`: the handles were moved/skewed; writes keep the layer's own transform. */
  geometry: 'standard' | 'custom' | null
  fixes: FixView[]
  refine: { scoreAfter: number; gain: number } | null
  /** Layer cautions: component instance, locked, paint style, variables. */
  warnings: string[]
  /** True when "Copy as ..." can produce something. */
  exportable: boolean
}

export interface AnalysisPayload {
  selectionCount: number
  scannedLayers: number
  gradients: GradientView[]
  /** Fills/strokes that are not gradients (solid, image, ...): counted, not listed. */
  otherPaints: number
  truncated: 'layers' | 'gradients' | null
  colorProfile: string
  notes: string[]
}

export type PluginMessage =
  | { type: 'analysis'; analysis: AnalysisPayload }
  | { type: 'apply-result'; ok: boolean; message: string; undoAvailable: boolean }
  | { type: 'undo-result'; ok: boolean; message: string; undoAvailable: boolean }
  | { type: 'export-result'; requestId: number; ok: boolean; format: CopyFormatKey; text: string; language: string; notes: string[]; message: string }
  | { type: 'create-result'; ok: boolean; message: string; created: number; skipped: string[] }
  | { type: 'error'; message: string }

// ── Validation ────────────────────────────────────────────────────────────────

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

type Obj = Record<string, unknown>

function isPlainObject(v: unknown): v is Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

const hasOnly = (o: Obj, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k))

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const isNum = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max

/** Figma node ids look like `12:34` or `I12:34;56:78`; nothing else is accepted. */
export const NODE_ID = /^[A-Za-z0-9:;_.-]{1,200}$/

const FORMAT_KEYS: readonly string[] = COPY_FORMATS.map((f) => f.key)

export function isCopyFormat(v: unknown): v is CopyFormatKey {
  return typeof v === 'string' && FORMAT_KEYS.includes(v)
}

function parseRef(v: unknown): GradientRef | null {
  if (!isPlainObject(v) || !hasOnly(v, ['nodeId', 'target', 'index'])) return null
  if (typeof v.nodeId !== 'string' || !NODE_ID.test(v.nodeId)) return null
  if (v.target !== 'fills' && v.target !== 'strokes') return null
  if (!isInt(v.index, 0, 999)) return null
  return { nodeId: v.nodeId, target: v.target, index: v.index }
}

function parseAction(v: unknown): ApplyAction | null {
  if (!isPlainObject(v)) return null
  if (v.kind === 'refine') {
    if (!hasOnly(v, ['kind', 'bake']) || !isInt(v.bake, BAKE_MIN, BAKE_MAX)) return null
    return { kind: 'refine', bake: v.bake }
  }
  if (v.kind === 'fix') {
    if (!hasOnly(v, ['kind', 'index', 'label']) || !isInt(v.index, 0, 99) || !isStr(v.label, 200)) return null
    return { kind: 'fix', index: v.index, label: v.label }
  }
  return null
}

/** Check a message that arrived from the UI iframe. Never throws. */
export function parseUiMessage(raw: unknown): Parsed<UiMessage> {
  try {
    if (!isPlainObject(raw)) return fail('The message is not an object.')
    switch (raw.type) {
      case 'ready':
      case 'rescan':
      case 'undo':
        return hasOnly(raw, ['type']) ? { ok: true, value: { type: raw.type } } : fail(`Unexpected fields in ${raw.type}.`)
      case 'select':
        if (!hasOnly(raw, ['type', 'nodeId']) || typeof raw.nodeId !== 'string' || !NODE_ID.test(raw.nodeId)) return fail('Bad select message.')
        return { ok: true, value: { type: 'select', nodeId: raw.nodeId } }
      case 'apply': {
        if (!hasOnly(raw, ['type', 'ref', 'action'])) return fail('Unexpected fields in apply.')
        const ref = parseRef(raw.ref)
        const action = parseAction(raw.action)
        if (!ref) return fail('Bad layer reference in apply.')
        if (!action) return fail('Bad action in apply.')
        return { ok: true, value: { type: 'apply', ref, action } }
      }
      case 'export': {
        if (!hasOnly(raw, ['type', 'requestId', 'ref', 'format'])) return fail('Unexpected fields in export.')
        const ref = parseRef(raw.ref)
        if (!ref) return fail('Bad layer reference in export.')
        if (!isInt(raw.requestId, 0, 2 ** 31)) return fail('Bad request id in export.')
        if (!isCopyFormat(raw.format)) return fail('Unknown export format.')
        return { ok: true, value: { type: 'export', requestId: raw.requestId, ref, format: raw.format } }
      }
      case 'create-from-css':
        if (!hasOnly(raw, ['type', 'css', 'bake'])) return fail('Unexpected fields in create-from-css.')
        if (!isStr(raw.css, MAX_CSS_LENGTH)) return fail('The CSS is not text or is too long.')
        if (!isInt(raw.bake, BAKE_MIN, BAKE_MAX)) return fail('The bake count is not a whole number from 2 to 16.')
        return { ok: true, value: { type: 'create-from-css', css: raw.css, bake: raw.bake } }
      case 'resize':
        if (!hasOnly(raw, ['type', 'width', 'height'])) return fail('Unexpected fields in resize.')
        if (!isNum(raw.width, 1, 10000) || !isNum(raw.height, 1, 10000)) return fail('Bad size.')
        return { ok: true, value: { type: 'resize', width: clampSize(raw.width, 'Width'), height: clampSize(raw.height, 'Height') } }
      default:
        return fail('Unknown message type.')
    }
  } catch {
    return fail('The message could not be read.')
  }
}

/** The plugin window size kept inside its limits (a whole number of pixels). */
export function clampSize(value: number, axis: 'Width' | 'Height'): number {
  const [lo, hi] = axis === 'Width' ? [SIZE_LIMITS.minWidth, SIZE_LIMITS.maxWidth] : [SIZE_LIMITS.minHeight, SIZE_LIMITS.maxHeight]
  return Math.round(Math.min(hi, Math.max(lo, value)))
}

// -- sandbox -> UI --

const SEVERITIES: readonly string[] = ['error', 'warning', 'info']
const DIMENSION_KEYS: readonly string[] = ['lightness', 'hue', 'chroma', 'spacing']

/** Swatches are our own `toCSS` output; anything else is refused before it reaches `style`. */
const SWATCH = /^linear-gradient\([#0-9a-z.,%\s()/-]*\)$/i
const SWATCH_FORBIDDEN = /url|image|src|expression|var\(|env\(|attr\(/i

function strArray(v: unknown, maxLen: number, maxItem: number): v is string[] {
  return Array.isArray(v) && v.length <= maxLen && v.every((s) => isStr(s, maxItem))
}

function parseIssue(v: unknown): IssueView | null {
  if (!isPlainObject(v)) return null
  if (!isStr(v.code, 80) || !SEVERITIES.includes(v.severity as string) || !isNum(v.points, 0, 1000)) return null
  if (!isStr(v.name, 120) || !isStr(v.measures, 600) || !isStr(v.message, 600)) return null
  if (!Array.isArray(v.stops) || v.stops.length > 64 || !v.stops.every((n) => isInt(n, 1, 1000))) return null
  return { code: v.code, severity: v.severity as Severity, points: v.points, name: v.name, measures: v.measures, message: v.message, stops: v.stops as number[] }
}

function parseGradientView(v: unknown): GradientView | null {
  if (!isPlainObject(v)) return null
  const ref = parseRef(v.ref)
  if (!ref) return null
  if (!isStr(v.nodeName, 300) || !isStr(v.nodeType, 60) || !isStr(v.paintType, 60)) return null
  if (typeof v.hidden !== 'boolean' || typeof v.translucent !== 'boolean' || typeof v.exportable !== 'boolean') return null
  if (v.status !== 'scored' && v.status !== 'not-scored') return null
  if (v.score !== null && !isInt(v.score, 0, 100)) return null
  if (!isInt(v.stopCount, 0, 1000) || !isNum(v.paintOpacity, 0, 1)) return null
  if (v.angle !== null && !isNum(v.angle, -1e6, 1e6)) return null
  if (v.geometry !== null && v.geometry !== 'standard' && v.geometry !== 'custom') return null
  if (v.swatch !== null && !(isStr(v.swatch, 4000) && SWATCH.test(v.swatch) && !SWATCH_FORBIDDEN.test(v.swatch))) return null
  if (!strArray(v.warnings, 10, 400)) return null
  if (!Array.isArray(v.issues) || v.issues.length > 40) return null
  const issues = v.issues.map(parseIssue)
  if (issues.some((i) => i === null)) return null
  if (!Array.isArray(v.dimensions) || v.dimensions.length > 4) return null
  for (const d of v.dimensions) {
    if (!isPlainObject(d) || !DIMENSION_KEYS.includes(d.key as string) || !isStr(d.label, 60) || !isNum(d.kept, 0, 1000) || !isNum(d.max, 0, 1000)) return null
  }
  let reason: GradientView['reason'] = null
  if (v.reason !== null) {
    if (!isPlainObject(v.reason) || !isStr(v.reason.code, 60) || !isStr(v.reason.text, 600)) return null
    reason = { code: v.reason.code, text: v.reason.text }
  }
  if (!Array.isArray(v.fixes) || v.fixes.length > 40) return null
  for (const f of v.fixes) {
    if (!isPlainObject(f) || !isInt(f.index, 0, 99) || !isStr(f.label, 200) || !isNum(f.gain, 0, 100) || !isInt(f.scoreAfter, 0, 100)) return null
  }
  let refine: GradientView['refine'] = null
  if (v.refine !== null) {
    if (!isPlainObject(v.refine) || !isInt(v.refine.scoreAfter, 0, 100) || !isNum(v.refine.gain, 0, 100)) return null
    refine = { scoreAfter: v.refine.scoreAfter, gain: v.refine.gain }
  }
  return {
    ref,
    nodeName: v.nodeName,
    nodeType: v.nodeType,
    paintType: v.paintType,
    hidden: v.hidden,
    status: v.status,
    score: v.score as number | null,
    dimensions: v.dimensions as DimensionView[],
    issues: issues as IssueView[],
    reason,
    swatch: v.swatch as string | null,
    stopCount: v.stopCount,
    angle: v.angle as number | null,
    translucent: v.translucent,
    paintOpacity: v.paintOpacity,
    geometry: v.geometry as GradientView['geometry'],
    fixes: v.fixes as FixView[],
    refine,
    warnings: v.warnings,
    exportable: v.exportable,
  }
}

function parseAnalysis(v: unknown): AnalysisPayload | null {
  if (!isPlainObject(v)) return null
  if (!isInt(v.selectionCount, 0, 1e6) || !isInt(v.scannedLayers, 0, 1e7) || !isInt(v.otherPaints, 0, 1e7)) return null
  if (v.truncated !== null && v.truncated !== 'layers' && v.truncated !== 'gradients') return null
  if (!isStr(v.colorProfile, 40) || !strArray(v.notes, 20, 600)) return null
  if (!Array.isArray(v.gradients) || v.gradients.length > 200) return null
  const gradients = v.gradients.map(parseGradientView)
  if (gradients.some((g) => g === null)) return null
  return {
    selectionCount: v.selectionCount,
    scannedLayers: v.scannedLayers,
    gradients: gradients as GradientView[],
    otherPaints: v.otherPaints,
    truncated: v.truncated as AnalysisPayload['truncated'],
    colorProfile: v.colorProfile,
    notes: v.notes,
  }
}

/** Check a message that arrived from the sandbox. Never throws. */
export function parsePluginMessage(raw: unknown): Parsed<PluginMessage> {
  try {
    if (!isPlainObject(raw)) return fail('The message is not an object.')
    switch (raw.type) {
      case 'analysis': {
        const analysis = parseAnalysis(raw.analysis)
        return analysis ? { ok: true, value: { type: 'analysis', analysis } } : fail('Bad analysis.')
      }
      case 'apply-result':
      case 'undo-result':
        if (typeof raw.ok !== 'boolean' || !isStr(raw.message, 600) || typeof raw.undoAvailable !== 'boolean') return fail(`Bad ${raw.type}.`)
        return { ok: true, value: { type: raw.type, ok: raw.ok, message: raw.message, undoAvailable: raw.undoAvailable } }
      case 'export-result':
        if (!isInt(raw.requestId, 0, 2 ** 31) || typeof raw.ok !== 'boolean' || !isCopyFormat(raw.format)) return fail('Bad export-result.')
        if (!isStr(raw.text, 200000) || !isStr(raw.language, 40) || !strArray(raw.notes, 20, 600) || !isStr(raw.message, 600)) return fail('Bad export-result.')
        return {
          ok: true,
          value: { type: 'export-result', requestId: raw.requestId, ok: raw.ok, format: raw.format, text: raw.text, language: raw.language, notes: raw.notes, message: raw.message },
        }
      case 'create-result':
        if (typeof raw.ok !== 'boolean' || !isStr(raw.message, 600) || !isInt(raw.created, 0, 1000) || !strArray(raw.skipped, 50, 600)) return fail('Bad create-result.')
        return { ok: true, value: { type: 'create-result', ok: raw.ok, message: raw.message, created: raw.created, skipped: raw.skipped } }
      case 'error':
        return isStr(raw.message, 600) ? { ok: true, value: { type: 'error', message: raw.message } } : fail('Bad error message.')
      default:
        return fail('Unknown message type.')
    }
  } catch {
    return fail('The message could not be read.')
  }
}
