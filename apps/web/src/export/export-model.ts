// ── Export tabs: the pure model behind the export panel ───────────────────────
// What each tab shows for the gradient on screen. The CSS tab keeps the
// app's own multi-layer output; every other tab goes through the core
// `@opal42/gradient/export` subpath, which knows one linear gradient only. So
// those tabs export the "base" gradient (the same stops at the first enabled
// direction's angle) and say so when more than one direction is layered.

import type { GradientBlendMode, GradientDirection, GradientStyle, GradientTick } from "@opal42/gradient";
import { EXPORT_FORMATS, exportAll, type ExportKey } from "@opal42/gradient/export";
import type { GradientDocument } from "@opal42/gradient";
import { buildExportLines } from "./css-export";

export type { ExportKey };

/** A tab: the core format list, in display order. */
export const EXPORT_TABS = EXPORT_FORMATS;

export const DEFAULT_EXPORT_KEY: ExportKey = "css";

/** The directions that contribute to the CSS (`buildMultiGradientStyle` uses the same filter). */
export function activeDirections(directions: readonly GradientDirection[]): GradientDirection[] {
  return directions.filter((d) => d.enabled && d.weight > 0);
}

/** The angle the non-CSS tabs use: the first enabled direction, else the CSS default (180). */
export function baseAngle(directions: readonly GradientDirection[]): number {
  const first = activeDirections(directions)[0];
  return first ? first.angle : 180;
}

/** The single linear gradient the non-CSS tabs export: the stops (sorted, as the preview paints them) at the base angle. */
export function baseDocument(ticks: readonly GradientTick[], directions: readonly GradientDirection[]): GradientDocument {
  const sorted = [...ticks].sort((a, b) => a.position - b.position);
  return {
    kind: "linear",
    angle: baseAngle(directions),
    stops: sorted.map((t) => ({ color: t.color.toLowerCase(), position: t.position / 100 })),
  };
}

/**
 * The visible note for a tab that cannot express the whole look, or null when
 * the base gradient is the whole look (one enabled direction).
 */
export function scopeNote(directions: readonly GradientDirection[], blend: GradientBlendMode): string | null {
  const active = activeDirections(directions);
  if (active.length === 0) {
    return "No direction is enabled, so the CSS tab is a flat colour. This tab exports the stops at the CSS default angle, 180°.";
  }
  if (active.length === 1) return null;
  const mode = blend === "normal" ? "" : ` with the ${blend} blend mode`;
  return `This look layers ${active.length} directions${mode}. Only the CSS tab can express that. This tab exports the base gradient: the same stops at ${active[0].angle}°, the first enabled direction.`;
}

export interface ExportView {
  key: ExportKey;
  label: string;
  /** Display name of the snippet's language. */
  language: string;
  /** A native-toolkit target: untested on device. */
  native: boolean;
  /** The code, one entry per line. Empty when unsupported. */
  lines: string[];
  /** Remarks about this export (baking, box assumption, what is unverified). */
  notes: string[];
  /** Shown when the tab cannot express the whole look. */
  scope: string | null;
  /** Why the tab has no code, when it has none. */
  unsupported: string | null;
}

const OKLAB_NOTES = [
  "Two declarations. The first is a plain sRGB gradient pre-sampled along OKLAB, for browsers without support. The second uses the in oklab clause.",
  "A browser interpolates in OKLAB only when it supports the in clause; otherwise it keeps the first declaration. The preview above is the plain sRGB gradient.",
];

const CSS_NOTES = ["Standard CSS: browsers interpolate between stops in sRGB, not OKLAB."];

/** Everything the panel shows for every tab, computed once per gradient. */
export function buildExportViews(
  ticks: readonly GradientTick[],
  directions: readonly GradientDirection[],
  blend: GradientBlendMode,
  style: GradientStyle,
): Record<ExportKey, ExportView> {
  const all = exportAll(baseDocument(ticks, directions));
  const scope = scopeNote(directions, blend);
  const views = {} as Record<ExportKey, ExportView>;
  for (const f of EXPORT_TABS) {
    const base = { key: f.key, label: f.label, language: f.language as string, native: f.native };
    if (f.key === "css") {
      views.css = { ...base, lines: buildExportLines(style), notes: CSS_NOTES, scope: null, unsupported: null };
      continue;
    }
    const r = all[f.key];
    if (r.status !== "ok") {
      views[f.key] = { ...base, lines: [], notes: [], scope, unsupported: r.reason };
      continue;
    }
    const notes = f.key === "css-oklab" ? OKLAB_NOTES : r.notes.filter((n) => n !== "Untested on device.");
    views[f.key] = { ...base, lines: r.text.split("\n"), notes, scope, unsupported: null };
  }
  return views;
}

/** The tab a key press moves to (WAI-ARIA tabs, automatic activation), or null for other keys. */
export function nextExportKey(current: ExportKey, key: string): ExportKey | null {
  const keys = EXPORT_TABS.map((t) => t.key);
  const i = keys.indexOf(current);
  if (i === -1) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return keys[(i + 1) % keys.length];
    case "ArrowLeft":
    case "ArrowUp":
      return keys[(i - 1 + keys.length) % keys.length];
    case "Home":
      return keys[0];
    case "End":
      return keys[keys.length - 1];
    default:
      return null;
  }
}
