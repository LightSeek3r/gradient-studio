// ── Document reducer (pure) ───────────────────────────────────────────────────
// Every edit to the document is one of these actions. The reducer returns the
// SAME object when an action changes nothing, so history records no no-ops.

import {
  colorAtPosition,
  isValidStopColor,
  MAX_DIRECTIONS,
  spreadDirectionAngles,
  type GradientBlendMode,
  type GradientTick,
} from "@opal42/gradient";
import {
  clampPosition,
  clampWeight,
  defaultDocument,
  isBlendMode,
  MAX_STOPS,
  MIN_STOPS,
  nextId,
  normaliseAngle,
  sameDocument,
  sortTicks,
  withSequentialIds,
  type GradientDocument,
} from "./document";
import { setDirectionCount, widestGapAngle } from "./directions";

export type DocumentAction =
  | { type: "setStopColor"; id: number; color: string }
  | { type: "setStopPosition"; id: number; position: number }
  /** Move a stop by `delta` percent (keyboard), clamped to 0..100. */
  | { type: "moveStop"; id: number; delta: number }
  /** Add a stop; without `position`, in the middle of the widest gap. The
   *  colour defaults to what the gradient shows there. New id = max id + 1. */
  | { type: "addStop"; position?: number; color?: string }
  | { type: "removeStop"; id: number }
  | { type: "setAngle"; id: number; angle: number }
  | { type: "setWeight"; id: number; weight: number }
  | { type: "setEnabled"; id: number; enabled: boolean }
  | { type: "addDirection" }
  | { type: "removeDirection"; id: number }
  /** The "Spread: N" presets: change the count, preserving existing layers. */
  | { type: "setDirectionCount"; count: number }
  /** Re-aim all layers evenly from the first one's angle. */
  | { type: "spreadDirections" }
  | { type: "setBlend"; blend: GradientBlendMode }
  /** Replace stop colours/positions by id (ids not listed are kept). */
  | { type: "applySuggestion"; ticks: GradientTick[] }
  | { type: "import"; document: GradientDocument }
  | { type: "reset" };

/** Where "+ Add stop" puts a stop: the middle of the widest gap. */
export function widestGapPosition(ticks: readonly GradientTick[]): number {
  const sorted = sortTicks(ticks).map((t) => t.position);
  let best = 50;
  let widest = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1] - sorted[i];
    if (gap > widest) {
      widest = gap;
      best = Math.round((sorted[i] + sorted[i + 1]) / 2);
    }
  }
  return best;
}

function patchTick(
  doc: GradientDocument,
  id: number,
  patch: (t: GradientTick) => GradientTick,
): GradientDocument {
  let changed = false;
  const ticks = doc.ticks.map((t) => {
    if (t.id !== id) return t;
    const next = patch(t);
    if (next.color !== t.color || next.position !== t.position) changed = true;
    return next;
  });
  return changed ? { ...doc, ticks } : doc;
}

function patchDirection(
  doc: GradientDocument,
  id: number,
  patch: Partial<{ angle: number; weight: number; enabled: boolean }>,
): GradientDocument {
  let changed = false;
  const directions = doc.directions.map((d) => {
    if (d.id !== id) return d;
    const next = { ...d, ...patch };
    if (next.angle !== d.angle || next.weight !== d.weight || next.enabled !== d.enabled) changed = true;
    return next;
  });
  return changed ? { ...doc, directions } : doc;
}

export function documentReducer(doc: GradientDocument, action: DocumentAction): GradientDocument {
  switch (action.type) {
    case "setStopColor": {
      const color = action.color.toLowerCase();
      if (!isValidStopColor(color)) return doc;
      return patchTick(doc, action.id, (t) => ({ ...t, color }));
    }
    case "setStopPosition": {
      if (!Number.isFinite(action.position)) return doc;
      const position = clampPosition(action.position);
      return patchTick(doc, action.id, (t) => ({ ...t, position }));
    }
    case "moveStop": {
      if (!Number.isFinite(action.delta)) return doc;
      return patchTick(doc, action.id, (t) => ({ ...t, position: clampPosition(t.position + action.delta) }));
    }
    case "addStop": {
      if (doc.ticks.length >= MAX_STOPS) return doc;
      const position = clampPosition(action.position ?? widestGapPosition(doc.ticks));
      const color =
        action.color && isValidStopColor(action.color.toLowerCase())
          ? action.color.toLowerCase()
          : colorAtPosition(doc.ticks, position);
      return { ...doc, ticks: [...doc.ticks, { id: nextId(doc.ticks), color, position }] };
    }
    case "removeStop": {
      if (doc.ticks.length <= MIN_STOPS || !doc.ticks.some((t) => t.id === action.id)) return doc;
      return { ...doc, ticks: doc.ticks.filter((t) => t.id !== action.id) };
    }
    case "setAngle":
      if (!Number.isFinite(action.angle)) return doc;
      return patchDirection(doc, action.id, { angle: normaliseAngle(action.angle) });
    case "setWeight":
      if (!Number.isFinite(action.weight)) return doc;
      return patchDirection(doc, action.id, { weight: clampWeight(action.weight) });
    case "setEnabled": {
      // Never mute the last active direction - there would be nothing to render.
      const target = doc.directions.find((d) => d.id === action.id);
      if (!target) return doc;
      if (!action.enabled && target.enabled && doc.directions.filter((d) => d.enabled).length === 1) {
        return doc;
      }
      return patchDirection(doc, action.id, { enabled: action.enabled });
    }
    case "addDirection": {
      if (doc.directions.length >= MAX_DIRECTIONS) return doc;
      const angle = widestGapAngle(doc.directions.map((d) => d.angle));
      return {
        ...doc,
        directions: [...doc.directions, { id: nextId(doc.directions), angle, weight: 60, enabled: true }],
      };
    }
    case "removeDirection": {
      if (doc.directions.length <= 1 || !doc.directions.some((d) => d.id === action.id)) return doc;
      const directions = doc.directions.filter((d) => d.id !== action.id);
      if (!directions.some((d) => d.enabled)) directions[0] = { ...directions[0], enabled: true };
      return { ...doc, directions };
    }
    case "setDirectionCount": {
      const directions = setDirectionCount(doc.directions, action.count);
      return directions === doc.directions ? doc : { ...doc, directions };
    }
    case "spreadDirections": {
      const angles = spreadDirectionAngles(doc.directions.length, doc.directions[0]?.angle ?? 135);
      const directions = doc.directions.map((d, i) => ({ ...d, angle: angles[i] }));
      return directions.every((d, i) => d.angle === doc.directions[i].angle) ? doc : { ...doc, directions };
    }
    case "setBlend":
      if (!isBlendMode(action.blend) || action.blend === doc.blend) return doc;
      return { ...doc, blend: action.blend };
    case "applySuggestion": {
      const byId = new Map(action.ticks.map((t) => [t.id, t]));
      let changed = false;
      const ticks = doc.ticks.map((t) => {
        const s = byId.get(t.id);
        if (!s || !isValidStopColor(s.color) || !Number.isFinite(s.position)) return t;
        const next = { id: t.id, color: s.color, position: clampPosition(s.position) };
        if (next.color !== t.color || next.position !== t.position) changed = true;
        return next;
      });
      return changed ? { ...doc, ticks } : doc;
    }
    case "import": {
      const next = withSequentialIds(action.document);
      return sameDocument(doc, next) ? doc : next;
    }
    case "reset": {
      const next = defaultDocument();
      return sameDocument(doc, next) ? doc : next;
    }
  }
}
