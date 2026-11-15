// Public surface of @opal42/gradient (working name). Re-exports everything the
// three modules export. Names exported by more than one module (V1_MODEL,
// ScoreMeasurements: gradient-engine re-exports them from scoring-model-v1)
// resolve to the same binding, so there is no clash.
export * from "./gradient-engine";
export * from "./color-formats";
export * from "./scoring-model-v1";

// Phase 1 document API (spec/api.md) and CSS gradient parser (spec/parser.md).
// Units: positions 0-1, angles in CSS degrees, alpha 0-1, colours `#rrggbb`.
export type * from "./api/types";
export { bakeStops, resolveStops, sampleGradient } from "./api/document";
export { refine, score, scoreParsed } from "./api/score";
export { complement, toCSS, toCSSWithFallback } from "./api/css";
export { parseCssColor } from "./css/color";
export { parseGradient } from "./css/parse";
