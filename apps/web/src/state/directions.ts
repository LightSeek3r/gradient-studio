// ── Direction-list operations (pure) ──────────────────────────────────────────

import { MAX_DIRECTIONS, type GradientDirection } from "@opal42/gradient";
import { nextId, normaliseAngle } from "./document";

/**
 * The angle in the middle of the widest circular gap between `angles`, so a
 * new spoke reads as distinct. With no angles, 135. Ties go to the first gap
 * in ascending-angle order.
 */
export function widestGapAngle(angles: readonly number[]): number {
  if (angles.length === 0) return 135;
  const sorted = [...angles].map(normaliseAngle).sort((a, b) => a - b);
  let best = sorted[0];
  let widest = -1;
  for (let i = 0; i < sorted.length; i++) {
    const next = i === sorted.length - 1 ? sorted[0] + 360 : sorted[i + 1];
    const gap = next - sorted[i];
    if (gap > widest) {
      widest = gap;
      best = sorted[i] + gap / 2;
    }
  }
  return normaliseAngle(best);
}

/**
 * Change the number of directions to `count` (clamped 1..MAX_DIRECTIONS)
 * WITHOUT disturbing the layers that stay: they keep angle, weight and
 * enabled. Removed layers come off the end. Added layers are enabled, weight
 * 100, each aimed into the widest remaining gap. If trimming leaves no
 * enabled layer, the first is re-enabled (an all-muted list renders nothing).
 * Returns the input array itself when nothing changes.
 */
export function setDirectionCount(
  directions: readonly GradientDirection[],
  count: number,
): GradientDirection[] {
  const n = Math.max(1, Math.min(MAX_DIRECTIONS, Math.round(count)));
  if (n === directions.length) return directions as GradientDirection[];

  let next: GradientDirection[];
  if (n < directions.length) {
    next = directions.slice(0, n);
  } else {
    next = [...directions];
    while (next.length < n) {
      next.push({
        id: nextId(next),
        angle: widestGapAngle(next.map((d) => d.angle)),
        weight: 100,
        enabled: true,
      });
    }
  }
  if (!next.some((d) => d.enabled)) next[0] = { ...next[0], enabled: true };
  return next;
}
