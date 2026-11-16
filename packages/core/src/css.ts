// Subpath entry `@opal42/gradient/css`: the gradient parser and the strict CSS
// colour parser, without the scoring engine.
export { parseGradient } from "./css/parse";
export { parseCssColor } from "./css/color";
export type {
  GradientDocument,
  GradientKind,
  HueInterpolation,
  Interpolation,
  InterpolationSpace,
  ParseOptions,
  ParseResult,
  ParseWarning,
  ParseWarningCode,
  ParsedGradient,
  SkipCode,
  SourceRange,
  Stop,
} from "./api/types";
