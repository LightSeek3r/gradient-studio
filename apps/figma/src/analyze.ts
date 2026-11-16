// ── Selection analysis and apply planning: pure, no `figma` ──────────────────
//
// Works on structural `HostLike` layers (the sandbox passes real nodes, the
// tests plain objects). Scoring, fixes, refinement and exports are core's;
// nothing here judges a gradient. Wording follows PLAN D5: a "smoothness
// score" that describes what the metric measures, never a pass/fail verdict.

import { proposeFixes, refine, score, toCSS, V1_MODEL, type GradientDocument } from '@opal42/gradient'
import { exportAll } from '@opal42/gradient/export'
import { DIMENSIONS, ruleText } from '../../web/src/explain/explain'
import type { AnalysisPayload, ApplyAction, CopyFormatKey, DimensionView, FixView, GradientRef, GradientView, IssueView } from './messages'
import { aspectOfBox, buildPaint, isGradientPaint, readPaint, sameStops, type PaintLike, type PlainGradientPaint } from './paint-adapter'

/** The parts of a Figma scene node this module reads. `figma.mixed` is a symbol, so it is just "not an array". */
export interface HostLike {
  id: string
  name: string
  type: string
  locked?: boolean
  visible?: boolean
  width?: number
  height?: number
  fills?: unknown
  strokes?: unknown
  fillStyleId?: unknown
  strokeStyleId?: unknown
  children?: readonly HostLike[]
  parent?: HostLike | null
}

export const LIMITS = { layers: 1500, gradients: 40 } as const

export interface Target {
  ref: GradientRef
  host: HostLike
  paint: PaintLike
  insideInstance: boolean
}

export interface Collected {
  targets: Target[]
  scannedLayers: number
  otherPaints: number
  mixedLayers: number
  truncated: AnalysisPayload['truncated']
}

function paintsOf(host: HostLike, target: 'fills' | 'strokes'): readonly unknown[] | null {
  try {
    const value = host[target]
    return Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function safeGet(host: HostLike, key: 'fills' | 'strokes'): unknown {
  try {
    return host[key]
  } catch {
    return undefined
  }
}

function hasAncestor(host: HostLike, test: (n: HostLike) => boolean): boolean {
  let n: HostLike | null | undefined = host.parent
  for (let depth = 0; n && depth < 500; depth++, n = n.parent) {
    if (test(n)) return true
  }
  return false
}

/**
 * The gradient paints of the selected layers and of everything inside them
 * (pre-order, selection order), bounded by `LIMITS`. Every GRADIENT_* paint is
 * a target (non-linear ones are listed as "not scored"); other paints are only
 * counted.
 */
export function collectTargets(roots: readonly HostLike[], limits: { layers: number; gradients: number } = LIMITS): Collected {
  const out: Collected = { targets: [], scannedLayers: 0, otherPaints: 0, mixedLayers: 0, truncated: null }
  const seen = new Set<string>()

  const visit = (host: HostLike, insideInstance: boolean): boolean => {
    if (seen.has(host.id)) return true
    seen.add(host.id)
    if (out.scannedLayers >= limits.layers) {
      out.truncated = 'layers'
      return false
    }
    out.scannedLayers++
    for (const target of ['fills', 'strokes'] as const) {
      const paints = paintsOf(host, target)
      if (paints === null) {
        if (target === 'fills' && typeof safeGet(host, 'fills') === 'symbol') out.mixedLayers++
        continue
      }
      for (let index = 0; index < paints.length; index++) {
        const paint = paints[index]
        if (!isGradientPaint(paint)) {
          out.otherPaints++
          continue
        }
        if (out.targets.length >= limits.gradients) {
          out.truncated = 'gradients'
          return false
        }
        out.targets.push({ ref: { nodeId: host.id, target, index }, host, paint, insideInstance })
      }
    }
    const kids = host.children
    if (Array.isArray(kids)) {
      const inside = insideInstance || host.type === 'INSTANCE'
      for (const child of kids) if (!visit(child, inside)) return false
    }
    return true
  }

  for (const root of roots) {
    const inside = hasAncestor(root, (n) => n.type === 'INSTANCE')
    if (!visit(root, inside)) break
  }
  return out
}

// ── Words ─────────────────────────────────────────────────────────────────────

const NOT_SCORED_PREFIX = 'Not scored: '

/** Plain-language reason for a core "unscorable" code (or an adapter skip). */
export function reasonText(code: string, fallback: string): string {
  switch (code) {
    case 'alpha':
      return `${NOT_SCORED_PREFIX}a stop is transparent. The smoothness score judges opaque stops only.`
    case 'hard-stops':
      return `${NOT_SCORED_PREFIX}two neighbouring stops share a position, which makes a hard edge. The score does not judge stripes.`
    case 'too-few-stops':
      return `${NOT_SCORED_PREFIX}a gradient needs at least two stops.`
    case 'variables':
      return `${NOT_SCORED_PREFIX}a stop colour is bound to a variable. Applying a change would unbind it, so this gradient is left alone.`
    default:
      return `${NOT_SCORED_PREFIX}${fallback}`
  }
}

/** Cautions shown beside the actions of a layer. */
export function layerWarnings(host: HostLike, target: 'fills' | 'strokes', insideInstance: boolean): string[] {
  const out: string[] = []
  if (host.type === 'INSTANCE' || insideInstance) {
    out.push('Component instance: a change here is applied to this instance and may become an override of its main component.')
  } else if (host.type === 'COMPONENT') {
    out.push('Main component: instances that do not override this paint change with it.')
  }
  if (host.locked === true || hasAncestor(host, (n) => n.locked === true)) {
    out.push('Locked layer: the plugin API can still edit it, but you locked it for a reason. Unlock it first if unsure.')
  }
  const style = target === 'fills' ? host.fillStyleId : host.strokeStyleId
  if (typeof style === 'string' && style !== '') {
    out.push('Uses a paint style: the style itself is not changed, and whether Figma keeps the layer linked to it after a write is not verified.')
  }
  return out
}

// ── Scoring one paint ─────────────────────────────────────────────────────────

interface Actions {
  result: Extract<ReturnType<typeof score>, { status: 'ok' }>
  fixes: { label: string; gain: number; scoreAfter: number; document: GradientDocument }[]
  refined: { document: GradientDocument; scoreAfter: number; gain: number } | null
}

const memo = new Map<string, Actions | { code: string; reason: string }>()
const MEMO_MAX = 300

/**
 * Score + the verified fixes + the whole-gradient refinement for a document,
 * or why not. Pure, so results are memoised by the document (the selection
 * changes often and `proposeFixes` re-scores many candidates).
 */
export function computeActions(doc: GradientDocument): Actions | { code: string; reason: string } {
  const key = JSON.stringify([doc.angle, doc.stops.map((s) => [s.color, s.alpha, s.position])])
  const hit = memo.get(key)
  if (hit) return hit
  const fresh = computeActionsUncached(doc)
  if (memo.size >= MEMO_MAX) memo.clear()
  memo.set(key, fresh)
  return fresh
}

function computeActionsUncached(doc: GradientDocument): Actions | { code: string; reason: string } {
  const result = score(doc)
  if (result.status !== 'ok') return { code: result.code, reason: result.reason }
  if (result.analysis.hasHardStops) return { code: 'hard-stops', reason: 'hard stops' }
  const fixes: Actions['fixes'] = []
  for (const f of proposeFixes(doc)) {
    if (f.before.status !== 'ok' || f.after.status !== 'ok' || f.gain <= 0) continue
    fixes.push({ label: f.label, gain: f.gain, scoreAfter: f.after.score, document: f.document })
  }
  const r = refine(doc)
  const refined =
    r.refined && r.before.status === 'ok' && r.after.status === 'ok' && r.after.score > r.before.score
      ? { document: r.document, scoreAfter: r.after.score, gain: r.after.score - r.before.score }
      : null
  return { result, fixes, refined }
}

const isActions = (v: Actions | { code: string }): v is Actions => 'result' in v

function dimensionViews(dims: Record<'lightness' | 'hue' | 'chroma' | 'spacing', number>): DimensionView[] {
  const weights = V1_MODEL.weights as Record<string, number>
  return DIMENSIONS.map(({ key, label }) => {
    const k = key === 'rhythm' ? 'spacing' : key
    return { key: k, label, kept: dims[k], max: weights[key] }
  })
}

function issueViews(actions: Actions): IssueView[] {
  return actions.result.issues.map((i) => {
    const t = ruleText(i.code)
    return {
      code: i.code,
      severity: i.severity,
      points: i.pointsLost,
      name: t.name,
      measures: t.measures,
      message: i.message,
      stops: (i.stopIndices ?? []).map((n) => n + 1),
    }
  })
}

const CAPTION_NODE = 300

/** The view of one gradient paint of a layer. Never throws. */
export function describeTarget(t: Target): GradientView {
  const { host, paint, ref } = t
  const aspect = aspectOfBox(host.width, host.height)
  const reading = readPaint(paint, aspect)
  const base = {
    ref,
    nodeName: String(host.name ?? '').slice(0, CAPTION_NODE),
    nodeType: String(host.type ?? '').slice(0, 60),
    paintType: String(paint.type ?? '').slice(0, 60),
    hidden: paint.visible === false || host.visible === false,
    warnings: layerWarnings(host, ref.target, t.insideInstance),
    stopCount: Array.isArray(paint.gradientStops) ? paint.gradientStops.length : 0,
  }
  const notScored = (code: string, text: string): GradientView => ({
    ...base,
    status: 'not-scored',
    score: null,
    dimensions: [],
    issues: [],
    reason: { code, text },
    swatch: null,
    angle: null,
    translucent: false,
    paintOpacity: typeof paint.opacity === 'number' ? paint.opacity : 1,
    geometry: null,
    fixes: [],
    refine: null,
    exportable: false,
  })

  if (reading.status !== 'ok') {
    const code = reading.status === 'skipped' ? reading.code : 'invalid'
    return notScored(code, reasonText(code, reading.status === 'skipped' ? reading.reason : 'This paint is not a gradient.'))
  }

  const css = toCSS(reading.renderDocument)
  const common = {
    ...base,
    swatch: css,
    angle: Math.round(reading.document.angle * 100) / 100,
    translucent: reading.translucent || reading.paintOpacity < 1,
    paintOpacity: reading.paintOpacity,
    geometry: reading.geometry,
    exportable: css !== null,
  }
  const actions = computeActions(reading.document)
  if (!isActions(actions)) {
    return {
      ...common,
      status: 'not-scored',
      score: null,
      dimensions: [],
      issues: [],
      reason: { code: actions.code, text: reasonText(actions.code, actions.reason) },
      fixes: [],
      refine: null,
    }
  }
  const fixes: FixView[] = actions.fixes.map((f, index) => ({ index, label: f.label, gain: f.gain, scoreAfter: f.scoreAfter }))
  return {
    ...common,
    status: 'scored',
    score: actions.result.score,
    dimensions: dimensionViews(actions.result.dimensions),
    issues: issueViews(actions),
    reason: null,
    fixes,
    refine: actions.refined ? { scoreAfter: actions.refined.scoreAfter, gain: actions.refined.gain } : null,
  }
}

export interface AnalyzeContext {
  colorProfile: string
}

/** The whole analysis message for a selection. */
export function analyzeSelection(roots: readonly HostLike[], ctx: AnalyzeContext, limits?: { layers: number; gradients: number }): AnalysisPayload {
  const found = collectTargets(roots, limits)
  const notes: string[] = []
  if (found.truncated === 'layers') notes.push(`Only the first ${found.scannedLayers} layers were scanned. Select a smaller part of the file.`)
  if (found.truncated === 'gradients') notes.push(`Only the first ${found.targets.length} gradients are listed. Select a smaller part of the file.`)
  if (found.mixedLayers > 0) notes.push(`${found.mixedLayers} layer${found.mixedLayers === 1 ? ' has' : 's have'} mixed fills (for example text with several colours) and ${found.mixedLayers === 1 ? 'was' : 'were'} skipped.`)
  if (ctx.colorProfile === 'DISPLAY_P3') {
    notes.push('This file uses the Display P3 colour profile. Stop channels are read as they are and scored as sRGB; how Figma converts them is not verified.')
  }
  return {
    selectionCount: roots.length,
    scannedLayers: found.scannedLayers,
    gradients: found.targets.map(describeTarget),
    otherPaints: found.otherPaints,
    truncated: found.truncated,
    colorProfile: ctx.colorProfile.slice(0, 40),
    notes,
  }
}

// ── Apply planning ────────────────────────────────────────────────────────────

export type ApplyPlan =
  | { status: 'write'; paint: PlainGradientPaint; summary: string }
  | { status: 'noop'; reason: string }
  | { status: 'blocked'; reason: string }

/**
 * What to write for `action` on the live `paint` of a layer with the given box.
 * Recomputed from the paint itself: the UI only names an action, it never
 * supplies colours. No write when the result equals what is already there.
 */
export function planApply(paint: PaintLike, host: Pick<HostLike, 'width' | 'height'>, action: ApplyAction): ApplyPlan {
  const aspect = aspectOfBox(host.width, host.height)
  const reading = readPaint(paint, aspect)
  if (reading.status !== 'ok') {
    return { status: 'blocked', reason: reading.status === 'skipped' ? reasonText(reading.code, reading.reason) : 'This paint is not a linear gradient.' }
  }
  const actions = computeActions(reading.document)
  if (!isActions(actions)) return { status: 'blocked', reason: reasonText(actions.code, actions.reason) }

  let document: GradientDocument
  let bake: number
  let summary: string
  if (action.kind === 'refine') {
    if (!actions.refined) return { status: 'noop', reason: 'Refinement would not raise the score of this gradient, so nothing was changed.' }
    document = actions.refined.document
    bake = action.bake
    summary = `Applied refined gradient: smoothness ${actions.result.score} to ${actions.refined.scoreAfter}, about ${action.bake} stops.`
  } else {
    const fix = actions.fixes[action.index]
    if (!fix || fix.label !== action.label) {
      return { status: 'blocked', reason: 'That fix no longer matches the gradient (it changed since the last scan). Rescanned; choose again.' }
    }
    document = fix.document
    bake = 0
    summary = `Applied fix "${fix.label}": smoothness ${actions.result.score} to ${fix.scoreAfter}.`
  }
  const built = buildPaint(paint, document, aspect, bake)
  if (built.status !== 'ok') return { status: 'blocked', reason: built.reason }
  if (sameStops(built.paint.gradientStops, paint.gradientStops)) {
    return { status: 'noop', reason: 'The gradient already has these stops, so nothing was changed.' }
  }
  return { status: 'write', paint: built.paint, summary }
}

// ── Export ────────────────────────────────────────────────────────────────────

export type ExportPlan =
  | { status: 'ok'; text: string; language: string; notes: string[] }
  | { status: 'unsupported'; reason: string }

/** "Copy as ...": the format for the gradient as it is shown in Figma (paint opacity included), in the layer's box. */
export function exportPaint(paint: PaintLike, host: Pick<HostLike, 'width' | 'height'>, format: CopyFormatKey): ExportPlan {
  const aspect = aspectOfBox(host.width, host.height)
  const reading = readPaint(paint, aspect)
  if (reading.status !== 'ok') {
    return { status: 'unsupported', reason: reading.status === 'skipped' ? reading.reason : 'This paint is not a linear gradient.' }
  }
  const out = exportAll(reading.renderDocument, { aspect, name: 'figma-gradient', prefix: 'gradient', id: 'figma-gradient' })[format]
  if (!out) return { status: 'unsupported', reason: 'Unknown format.' }
  if (out.status !== 'ok') return { status: 'unsupported', reason: out.reason }
  const notes = [...out.notes]
  if (reading.paintOpacity < 1) notes.unshift(`The paint opacity (${Math.round(reading.paintOpacity * 100)}%) is multiplied into the stop alphas.`)
  return { status: 'ok', text: out.text, language: out.language, notes }
}
