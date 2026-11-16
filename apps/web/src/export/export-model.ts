// ── Export tabs: the pure model behind the export panel ───────────────────────
// What each tab shows for the gradient on screen. The CSS tab keeps the
// app's own multi-layer output; every other tab goes through the core
// `@opal42/gradient/export` subpath, which knows one linear gradient only. So
// those tabs export the "base" gradient (the same stops at the first enabled
// direction's angle) and say so when more than one direction is layered.

import type { GradientBlendMode, GradientDirection, GradientStyle, GradientTick } from "@opal42/gradient";
import { EXPORT_FORMATS, exportAll, type ExportKey } from "@opal42/gradient/export";
import type { GradientDocument } from "@opal42/gradient";
import { hasMessageKey, type Translate } from "../i18n/translator";
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
export function scopeNote(directions: readonly GradientDirection[], blend: GradientBlendMode, t: Translate): string | null {
  const active = activeDirections(directions);
  if (active.length === 0) return t("export.scope.none");
  if (active.length === 1) return null;
  return t("export.scope.layers", { count: active.length, blend, angle: active[0].angle });
}

/**
 * Core's export notes are English sentences. The ones this app can show are
 * matched here and re-said in the active language (their numbers kept); a
 * note this table does not know is shown as core wrote it.
 */
export function localiseCoreNote(note: string, t: Translate): string {
  const exact: [string, Parameters<Translate>[0]][] = [
    ["Start and end points assume a square box (aspect ratio 1:1); pass an aspect ratio for other boxes.", "export.note.squareBox"],
    ["Stops outside 0%-100% were clipped to the gradient line.", "export.note.clipped"],
    ["The arbitrary value is exact. Underscores stand for spaces, as Tailwind expects.", "export.note.tailwindArbitrary"],
    [
      "The native utilities are exact for two or three stops; the /srgb, /oklab or /oklch modifier matches the document.",
      "export.note.tailwindNative",
    ],
    [
      "The native from/via/to utilities express at most three stops, so only the arbitrary value and the theme forms are given.",
      "export.note.tailwindNoNative",
    ],
    [
      "Unverified against the normative DTCG text: the commonly implemented array of { color, position } stops.",
      "export.note.dtcgUnverified",
    ],
    ["DTCG gradients carry no angle; it is kept in $extensions.", "export.note.dtcgAngle"],
    [
      "Paste into a plugin as node.fills = [paint]. Figma has no OKLAB interpolation; use the bake option to approximate it.",
      "export.note.figmaPaste",
    ],
    ["The gradientTransform convention is derived, not verified against Figma.", "export.note.figmaTransform"],
  ];
  for (const [text, key] of exact) if (note === text) return t(key);
  const patterns: [RegExp, (m: RegExpExecArray) => string][] = [
    [
      /^Start and end points are for a box with aspect ratio (.+):1 \(width:height\)\.$/,
      (m) => t("export.note.aspectBox", { ratio: m[1] }),
    ],
    [
      /^Pre-sampled into (\d+) stops \((.+), alpha premultiplied\) so (.+) approximates the CSS rendering\.$/,
      (m) => t("export.note.presampled", { count: Number(m[1]), space: m[2], target: m[3] }),
    ],
    [
      /^The document interpolates in (.+); (.+) will interpolate in sRGB between these stops\. Use the bake option to approximate it\.$/,
      (m) => t("export.note.interpolates", { space: m[1], target: m[2] }),
    ],
    [
      /^The gradient geometry is exact for a shape with a (.+) x (.+) bounding box \(aspect ratio (.+)\)\.$/,
      (m) => t("export.note.svgGeometry", { width: m[1], height: m[2], ratio: m[3] }),
    ],
    [
      /^Offsets are pixels of a (.+) x (.+) box; the ShaderBrush variant adapts to any size\.$/,
      (m) => t("export.note.composeOffsets", { width: m[1], height: m[2] }),
    ],
  ];
  for (const [re, render] of patterns) {
    const m = re.exec(note);
    if (m) return render(m);
  }
  return note;
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


/** Everything the panel shows for every tab, computed once per gradient. */
export function buildExportViews(
  ticks: readonly GradientTick[],
  directions: readonly GradientDirection[],
  blend: GradientBlendMode,
  style: GradientStyle,
  t: Translate,
): Record<ExportKey, ExportView> {
  const all = exportAll(baseDocument(ticks, directions));
  const scope = scopeNote(directions, blend, t);
  const views = {} as Record<ExportKey, ExportView>;
  for (const f of EXPORT_TABS) {
    const tabKey = `export.tab.${f.key}`;
    const base = { key: f.key, label: hasMessageKey(tabKey) ? t(tabKey) : f.label, language: f.language as string, native: f.native };
    if (f.key === "css") {
      views.css = { ...base, lines: buildExportLines(style), notes: [t("export.note.css")], scope: null, unsupported: null };
      continue;
    }
    const r = all[f.key];
    if (r.status !== "ok") {
      views[f.key] = { ...base, lines: [], notes: [], scope, unsupported: localiseUnsupported(r, t) };
      continue;
    }
    const notes =
      f.key === "css-oklab"
        ? [t("export.note.oklab1"), t("export.note.oklab2")]
        : r.notes.filter((n) => n !== "Untested on device.").map((n) => localiseCoreNote(n, t));
    views[f.key] = { ...base, lines: r.text.split("\n"), notes, scope, unsupported: null };
  }
  return views;
}

const KNOWN_REASONS: Readonly<Record<string, Parameters<Translate>[0]>> = {
  "Not a gradient document.": "export.reason.notDocument",
  "The angle is not a finite number.": "export.reason.angle",
  "A gradient needs at least two stops.": "export.reason.twoStops",
  "A stop has an invalid colour or alpha.": "export.reason.badStop",
  "A stop position is not a finite number.": "export.reason.stopPosition",
  "The document has no CSS form.": "export.reason.noCss",
};

/** Why a tab has no code, in the active language: core's reason when known, else by its stable code, else as core wrote it. */
export function localiseUnsupported(r: { code: string; reason: string }, t: Translate): string {
  const known = Object.hasOwn(KNOWN_REASONS, r.reason) ? KNOWN_REASONS[r.reason] : undefined;
  if (known) return t(known);
  const byCode = `export.unsupported.${r.code}`;
  return hasMessageKey(byCode) ? t(byCode) : r.reason;
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
