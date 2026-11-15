// ── Gradient document ─────────────────────────────────────────────────────────
// The editor's whole saved state: what undo/redo, the URL hash and autosave
// operate on. UI-only state (selection, the suggestion being compared, open
// dialogs) deliberately lives outside it.
//
// This is the APP's editing document (stops projected along up to seven
// directions with a blend mode). It is not the single-angle core
// `GradientDocument` sketched in PLAN §3.4; a converter can bridge the two
// once that type exists in core.

import {
  MAX_DIRECTIONS,
  type GradientBlendMode,
  type GradientDirection,
  type GradientTick,
} from "@opal42/gradient";

export interface GradientDocument {
  ticks: GradientTick[];
  directions: GradientDirection[];
  blend: GradientBlendMode;
}

/** Hard ceiling on colour stops. */
export const MAX_STOPS = 10;
/** A gradient needs two stops. */
export const MIN_STOPS = 2;
export { MAX_DIRECTIONS };

/** Every blend mode the app offers (and the URL codec accepts). */
export const BLEND_MODES: readonly GradientBlendMode[] = [
  "normal",
  "screen",
  "multiply",
  "overlay",
  "soft-light",
  "hard-light",
  "lighten",
  "darken",
  "difference",
];

export function isBlendMode(value: unknown): value is GradientBlendMode {
  return typeof value === "string" && (BLEND_MODES as readonly string[]).includes(value);
}

/** The document a first visit starts from. */
export function defaultDocument(): GradientDocument {
  return {
    ticks: [
      { id: 1, color: "#101b45", position: 0 }, // space navy
      { id: 2, color: "#3f1d63", position: 50 }, // royal purple
      { id: 3, color: "#9333ea", position: 100 }, // nebula violet
    ],
    directions: [{ id: 1, angle: 135, weight: 100, enabled: true }],
    blend: "normal",
  };
}

/** The next free id: one more than the largest in use (deterministic). */
export function nextId(items: readonly { id: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

/** Stable position sort (array order breaks ties, as CSS paints them). */
export function sortTicks(ticks: readonly GradientTick[]): GradientTick[] {
  return [...ticks].sort((a, b) => a.position - b.position);
}

/** Round to at most two decimals (positions are 0-100 percent). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function clampPosition(n: number): number {
  return round2(Math.min(100, Math.max(0, n)));
}

/** Any angle in degrees -> an integer in [0, 360). */
export function normaliseAngle(angle: number): number {
  return ((Math.round(angle) % 360) + 360) % 360;
}

export function clampWeight(n: number): number {
  return Math.min(100, Math.max(1, Math.round(n)));
}

/**
 * Same document with ids renumbered 1..n: stops in position order, directions
 * in list order. Used whenever a document arrives from outside (URL, storage,
 * import), so the ids are a deterministic function of the content.
 */
export function withSequentialIds(doc: GradientDocument): GradientDocument {
  return {
    ticks: sortTicks(doc.ticks).map((t, i) => ({ id: i + 1, color: t.color, position: t.position })),
    directions: doc.directions.map((d, i) => ({
      id: i + 1,
      angle: d.angle,
      weight: d.weight,
      enabled: d.enabled,
    })),
    blend: doc.blend,
  };
}

/** Structural equality on what the document renders (ids ignored, stops by position). */
export function sameDocument(a: GradientDocument, b: GradientDocument): boolean {
  if (a.blend !== b.blend) return false;
  if (a.directions.length !== b.directions.length || a.ticks.length !== b.ticks.length) return false;
  const ta = sortTicks(a.ticks);
  const tb = sortTicks(b.ticks);
  return (
    ta.every((t, i) => t.color === tb[i].color && t.position === tb[i].position) &&
    a.directions.every((d, i) => {
      const e = b.directions[i];
      return d.angle === e.angle && d.weight === e.weight && d.enabled === e.enabled;
    })
  );
}
