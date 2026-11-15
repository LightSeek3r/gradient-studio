// ── Public API types (PLAN §3.4) ───────────────────────────────────────────────
// Units policy: positions 0-1, angles in CSS degrees (0 = to top, clockwise),
// alpha 0-1, colours as lower-case `#rrggbb` strings. Percentages and 0-255
// channels exist only inside CSS text. Failures are values (`null`,
// `unscorable`, `skipped`), never sentinels and never exceptions.

/** One colour stop of a gradient document. */
export interface Stop {
  /** Opaque sRGB colour, `#rrggbb`. */
  color: string;
  /** Opacity 0-1. Absent means 1 (opaque). */
  alpha?: number;
  /** Position along the gradient line, 0-1. Absent means "auto" (see `resolveStops`). */
  position?: number;
  /** Caller-owned identity, carried through `refine`. */
  id?: string;
}

/** A stop whose position has been resolved by the CSS rules. */
export interface ResolvedStop extends Stop {
  position: number;
}

export type InterpolationSpace = "srgb" | "oklab" | "oklch";
export type HueInterpolation = "shorter" | "longer" | "increasing" | "decreasing";

export interface Interpolation {
  space: InterpolationSpace;
  /** Only meaningful for `oklch`. Absent means `shorter`. */
  hue?: HueInterpolation;
}

export interface GradientDocument {
  kind: "linear";
  /** CSS degrees: 0 = to top, 90 = to right, 180 = to bottom (the CSS default). */
  angle: number;
  /** In CSS source order (which is paint order). */
  stops: Stop[];
  repeating?: boolean;
  /** Absent means the CSS default (gamma-encoded sRGB). */
  interpolation?: Interpolation;
}

/** Half-open `[start, end)` range of UTF-16 code-unit offsets into the source text. */
export interface SourceRange {
  start: number;
  end: number;
}

export type IssueSeverity = "error" | "warning" | "info";
export type IssueDimension = "lightness" | "chroma" | "hue" | "spacing";

/** One deduction of the score: coded, located, with the points it cost. */
export interface Issue {
  /** Stable `dimension/rule` code from spec/scoring-v1.md, e.g. `lightness/reversal`. */
  code: string;
  severity: IssueSeverity;
  /** `spacing` is the dimension the v1 codes call `rhythm`. */
  dimension: IssueDimension;
  /** The rule's nominal penalty (before the per-dimension clamp at 0). */
  pointsLost: number;
  /** Indices into `document.stops` (ascending). */
  stopIndices?: number[];
  /** The affected span of the gradient line, positions 0-1. */
  segment?: { start: number; end: number };
  /** Source range of the offending stops; only set by `scoreParsed`. */
  range?: SourceRange;
  message: string;
}

export type UnscorableCode =
  | "invalid-document"
  | "unsupported-kind"
  | "unsupported-model"
  | "repeating"
  | "too-few-stops"
  | "invalid-color"
  | "invalid-alpha"
  | "alpha"
  | "invalid-position"
  | "position-range"
  | "engine"
  | SkipCode;

export interface ScoreAnalysis {
  /** Two neighbouring stops share a position but not a colour (stripes / hard edges). */
  hasHardStops: boolean;
}

export type ScoreResult =
  | {
      status: "ok";
      /** Integer 0-100. */
      score: number;
      /** Points kept per dimension (budgets 30/30/20/20 in v1). */
      dimensions: Record<IssueDimension, number>;
      issues: Issue[];
      scoringModel: "v1";
      analysis: ScoreAnalysis;
    }
  | { status: "unscorable"; code: UnscorableCode; reason: string };

export interface ScoreOptions {
  scoringModel?: "v1";
}

/** Why the parser found a gradient but produced no document. */
export type SkipCode =
  | "legacy-syntax"
  | "unsupported-kind"
  | "var"
  | "calc"
  | "env"
  | "currentColor"
  | "color-mix"
  | "relative-color"
  | "lab-lch"
  | "color-function"
  | "system-color"
  | "unknown-color"
  | "length-position"
  | "too-many-stops"
  | "interpolation-space"
  | "preprocessor"
  | "syntax"
  | "unbalanced"
  | "too-long"
  | "too-deep";

export type ParseWarningCode =
  | "color-hint-ignored"
  | "corner-angle"
  | "position-out-of-range"
  | "gamut-mapped";

export interface ParseWarning {
  code: ParseWarningCode;
  message: string;
  range?: SourceRange;
}

export type GradientKind = "linear" | "radial" | "conic";

export interface ParsedGradient {
  /** The whole function, from the first character of its name to the closing `)`. */
  range: SourceRange;
  kind: GradientKind;
  repeating: boolean;
  /** `-webkit-`, `-moz-`, `-o-` or `-ms-` when the function name carries one. */
  vendorPrefix?: string;
  /** Null whenever `skipped` is set. */
  document: GradientDocument | null;
  /**
   * With a document: `stopRanges[i]` is the source of `document.stops[i]` (the
   * two stops of a double-position stop share one range). Without: one range
   * per colour-stop argument, best effort.
   */
  stopRanges: SourceRange[];
  /** The `<angle>` or `to <side>` text, when present. */
  angleRange?: SourceRange;
  skipped?: { code: SkipCode; reason: string };
  warnings: ParseWarning[];
}

export interface ParseResult {
  /** Every gradient function found, ordered by `range.start`. */
  gradients: ParsedGradient[];
  /** True when the input was longer than `maxInputLength` and only a prefix was scanned. */
  truncated?: boolean;
}

export interface ParseOptions {
  /** Stops allowed in one document (default 32). */
  maxStops?: number;
  /** Longest gradient function parsed, in UTF-16 units (default 100 000). */
  maxLength?: number;
  /** Longest input scanned, in UTF-16 units (default 2 000 000). */
  maxInputLength?: number;
}

export interface RefineOutcome {
  /** The refined document, or the input itself when declined. */
  document: GradientDocument;
  refined: boolean;
  before: ScoreResult;
  after: ScoreResult;
  declined?: { code: "unscorable" | "single-position" | "would-lower-score"; reason: string };
}

export interface ToCSSOptions {
  /** Overrides `document.interpolation`. */
  interpolation?: Interpolation;
}

export interface SampleOptions {
  /** Space to interpolate in. Default: OKLAB (not the document's own space). */
  interpolation?: Interpolation;
}

export interface SampledColor {
  color: string;
  alpha: number;
}
