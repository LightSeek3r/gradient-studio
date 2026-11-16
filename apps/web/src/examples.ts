// ── One example gradient per rule ─────────────────────────────────────────────
// A small gradient that triggers each finding code of scoring model v1. They
// are the "Examples" list in the app and what an issue permalink
// (`#issue=<code>`, docs/URL-FORMAT.md) loads, so they double as the rule
// documentation. tests/examples.test.ts fails when a code of the model has no
// example, or an example does not trigger its code.

import type { GradientTick } from "@opal42/gradient";
import { defaultDocument, type GradientDocument } from "./state/document";

export interface RuleExample {
  code: string;
  /** `[colour, position 0-100]`, in position order. */
  stops: readonly (readonly [string, number])[];
}

export const EXAMPLES: readonly RuleExample[] = [
  { code: "lightness/reversal", stops: [["#fde68a", 0], ["#b45309", 50], ["#fdba74", 100]] },
  { code: "lightness/perceived-reversal", stops: [["#808080", 0], ["#ff0066", 50], ["#9a9a9a", 100]] },
  { code: "lightness/low-contrast", stops: [["#336699", 0], ["#3f72a8", 100]] },
  { code: "lightness/abrupt-jump", stops: [["#0f172a", 0], ["#e2e8f0", 6], ["#94a3b8", 100]] },
  { code: "lightness/uneven-speed", stops: [["#1e3a8a", 0], ["#93c5fd", 50], ["#bfdbfe", 100]] },
  { code: "hue/wide-arc", stops: [["#ff0000", 0], ["#00ff80", 100]] },
  { code: "hue/narrow-arc", stops: [["#3b82f6", 0], ["#2563eb", 100]] },
  { code: "hue/direction-reversal", stops: [["#84345f", 0], ["#bd6254", 50], ["#ef8d9d", 100]] },
  { code: "chroma/saturation-range", stops: [["#808080", 0], ["#ff0000", 100]] },
  { code: "chroma/dead-zone", stops: [["#ff0000", 0], ["#808080", 50], ["#00ff00", 100]] },
  { code: "chroma/muddy-midpoint", stops: [["#00ff00", 0], ["#ff00ff", 100]] },
  { code: "chroma/banding", stops: [["#112233", 0], ["#1a2b3b", 100]] },
  { code: "rhythm/edge-gap", stops: [["#4845a5", 12], ["#f398eb", 88]] },
  { code: "rhythm/narrow-span", stops: [["#4845a5", 32], ["#f398eb", 67]] },
  { code: "rhythm/uneven-gaps", stops: [["#3c3990", 0], ["#5f4aa8", 20], ["#f09be8", 100]] },
];

export function findExample(code: unknown): RuleExample | null {
  if (typeof code !== "string") return null;
  return EXAMPLES.find((e) => e.code === code) ?? null;
}

export function exampleTicks(example: RuleExample): GradientTick[] {
  return example.stops.map(([color, position], i) => ({ id: i + 1, color, position }));
}

/** The example as an editor document: its stops, one 90° direction (left to right, like the stop bar). */
export function exampleDocument(example: RuleExample): GradientDocument {
  return {
    ...defaultDocument(),
    ticks: exampleTicks(example),
    directions: [{ id: 1, angle: 90, weight: 100, enabled: true }],
    blend: "normal",
  };
}
