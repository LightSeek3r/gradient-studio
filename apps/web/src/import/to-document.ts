import type { GradientDocument } from "../state/document";
import type { ImportedGradient } from "./adapter";

/**
 * An imported linear-gradient describes the whole look, so it replaces the
 * stops AND collapses the directions to the one angle it had, blend normal.
 */
export function importedToDocument(g: ImportedGradient): GradientDocument {
  return {
    ticks: g.stops.map((s, i) => ({ id: i + 1, color: s.color, position: s.position })),
    directions: [{ id: 1, angle: g.angle, weight: 100, enabled: true }],
    blend: "normal",
  };
}

/** "Imported 3 stops, 135°" */
export function importSummary(g: ImportedGradient): string {
  return `Imported ${g.stops.length} stops, ${g.angle}°`;
}
