// The tool input and output schemas, written once. They are advertised in
// `tools/list`, enforced by `validate` in the handlers, and tested against
// each other. Plain JSON Schema (draft 2020-12 compatible subset), no zod.

import { MAX_ANGLE, MAX_COLOR_CHARS, MAX_CSS_CHARS, MAX_PREVIEW_SIZE, MAX_STOPS, MIN_PREVIEW_SIZE } from "./limits";
import type { JsonSchema } from "./validate";

const colorProp = {
  type: "string",
  minLength: 1,
  maxLength: MAX_COLOR_CHARS,
  description:
    "A CSS colour: #rgb, #rrggbb, rgb(), hsl(), a named colour, oklab() or oklch(). Not var(), calc(), color-mix() or currentColor.",
} as const satisfies JsonSchema;

const cssProp = {
  type: "string",
  minLength: 1,
  maxLength: MAX_CSS_CHARS,
  description:
    "Text containing one or more CSS gradient functions (a whole declaration, a rule or just linear-gradient(...)). Every gradient in it is examined, at most 32. Use this or `stops`, not both.",
} as const satisfies JsonSchema;

const stopsProp = {
  type: "array",
  minItems: 2,
  maxItems: MAX_STOPS,
  description:
    "A single linear gradient given as structured stops, in paint order. Use this or `css`, not both. Needs at least 2 stops.",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["color"],
    properties: {
      color: colorProp,
      position: {
        type: "number",
        minimum: 0,
        maximum: 100,
        description: "Position along the gradient line in percent (0-100). Omit for CSS's automatic spacing.",
      },
    },
  },
} as const satisfies JsonSchema;

const angleProp = {
  type: "number",
  minimum: -MAX_ANGLE,
  maximum: MAX_ANGLE,
  description: "CSS angle in degrees for `stops` (0 = to top, 90 = to right, 180 = to bottom). Default 180. Ignored with `css`.",
} as const satisfies JsonSchema;

const interpolationProp = {
  type: "string",
  enum: ["srgb", "oklab", "oklch"],
  description:
    "Colour space of the `in <space>` clause for `stops` (default srgb, the CSS default). It changes the CSS that is printed and the preview, not the v1 score. Ignored with `css`.",
} as const satisfies JsonSchema;

const objectOutput = { type: "object" } as const satisfies JsonSchema;

export const SCORE_INPUT = {
  type: "object",
  additionalProperties: false,
  properties: { css: cssProp, stops: stopsProp, angle: angleProp, interpolation: interpolationProp },
} as const satisfies JsonSchema;

export const REFINE_INPUT = SCORE_INPUT;

export const COMPLEMENT_INPUT = {
  type: "object",
  additionalProperties: false,
  required: ["color"],
  properties: { color: colorProp },
} as const satisfies JsonSchema;

export const PREVIEW_INPUT = {
  type: "object",
  additionalProperties: false,
  properties: {
    css: cssProp,
    stops: stopsProp,
    angle: angleProp,
    interpolation: interpolationProp,
    index: {
      type: "integer",
      minimum: 0,
      maximum: 1000,
      description: "With `css` holding several gradients: which one to draw (0-based, in source order). Default 0.",
    },
    width: {
      type: "integer",
      minimum: MIN_PREVIEW_SIZE,
      maximum: MAX_PREVIEW_SIZE,
      description: "Image width in pixels. Default 480.",
    },
    height: {
      type: "integer",
      minimum: MIN_PREVIEW_SIZE,
      maximum: MAX_PREVIEW_SIZE,
      description: "Image height in pixels. Default 270.",
    },
  },
} as const satisfies JsonSchema;

// Output schemas stay loose on purpose: they name the top-level keys clients
// can rely on without freezing every nested shape.
export const SCORE_OUTPUT = {
  ...objectOutput,
  required: ["scoringModel", "note", "gradientCount", "gradients", "summary"],
  properties: {
    scoringModel: { type: "string", enum: ["v1"] },
    note: { type: "string" },
    gradientCount: { type: "integer" },
    gradientsNotExamined: { type: "integer" },
    gradients: { type: "array" },
    summary: { type: "object" },
  },
} as const satisfies JsonSchema;

export const REFINE_OUTPUT = {
  ...objectOutput,
  required: ["scoringModel", "note", "gradientCount", "gradients"],
  properties: {
    scoringModel: { type: "string", enum: ["v1"] },
    note: { type: "string" },
    gradientCount: { type: "integer" },
    gradientsNotExamined: { type: "integer" },
    gradients: { type: "array" },
  },
} as const satisfies JsonSchema;

export const COMPLEMENT_OUTPUT = {
  ...objectOutput,
  required: ["input", "color", "complement"],
  properties: {
    input: { type: "string" },
    color: { type: "string" },
    complement: { type: "string" },
    alphaIgnored: { type: "boolean" },
  },
} as const satisfies JsonSchema;

export const PREVIEW_OUTPUT = {
  ...objectOutput,
  required: ["mimeType", "width", "height", "angle", "stops"],
  properties: {
    mimeType: { type: "string", enum: ["image/svg+xml"] },
    width: { type: "integer" },
    height: { type: "integer" },
    angle: { type: "number" },
    stops: { type: "array" },
  },
} as const satisfies JsonSchema;
