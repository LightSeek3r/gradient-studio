// Public surface of @opal42/gradient (working name). Re-exports everything the
// three modules export (the engine's by name, see below). Names exported by more than one module (V1_MODEL,
// ScoreMeasurements: gradient-engine re-exports them from scoring-model-v1)
// resolve to the same binding, so there is no clash.
// The engine's public names are listed one by one (not `export *`) so that the
// internals the fix search shares with the scorer (PreparedScore, ScoreMemo,
// ...) stay out of the public API.
export {
  srgbToLinear,
  linearToSrgb,
  hexToRgb,
  rgbToHex,
  rgbToOklab,
  oklabToLinearRgb,
  oklabToRgb,
  hexToOklch,
  oklchToHex,
  oklabToLch,
  lchToOklab,
  isValidStopColor,
  unscorableReason,
  scoreGradient,
  refineGradient,
  suggestGradient,
  buildGradientCSS,
  MAX_DIRECTIONS,
  buildMultiGradientStyle,
  spreadDirectionAngles,
  interpolateGradient,
  colorAtPosition,
} from "./gradient-engine";
export type {
  RGB,
  OklabColor,
  LchColor,
  GradientTick,
  ScoreDetails,
  Finding,
  GradientScore,
  RefineResult,
  GradientDirection,
  GradientBlendMode,
  GradientStyle,
  FindingDimension,
} from "./gradient-engine";
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
export { proposeFixes, type Fix, type FixKind } from "./api/fixes";
