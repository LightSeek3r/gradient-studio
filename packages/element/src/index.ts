// @opal42/element: custom elements for the smoothness score of a CSS gradient.
// Importing this entry has no side effects and touches no DOM (SSR-safe). Call
// `defineElements()` or import `@opal42/element/define`.
export { defineElements, PREVIEW_TAG, SCORE_TAG, type DefineOptions, type DefineResult } from "./register";
export {
  DEFAULT_DEBOUNCE_MS,
  Opal42GradientPreviewElement,
  Opal42GradientScoreElement,
  type ErrorEventDetail,
  type ScoreEventDetail,
} from "./elements";
export {
  analyzeCss,
  isSafeGradient,
  MAX_INPUT_LENGTH,
  refineCss,
  swatchBackgrounds,
  type AnalyzeOptions,
  type ElementFinding,
  type ElementFix,
  type ElementResult,
  type ElementStatus,
} from "./analyze";
export { createTranslate, DEFAULT_MESSAGES, type Messages, type Translate } from "./messages";
