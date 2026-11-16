// The report model. The JSON output is exactly this, serialised (see docs/cli.md).

import type { RangeLoc } from "./lines";

export const SCHEMA_VERSION = 1;
export const SCORING_MODEL = "v1";

export interface RangeJson {
  start: number;
  end: number;
}

export interface IssueReport {
  code: string;
  severity: "error" | "warning" | "info";
  dimension: "lightness" | "chroma" | "hue" | "spacing";
  pointsLost: number;
  message: string;
  /** Indices into the gradient's stops. */
  stopIndices?: number[];
  range: RangeJson;
  loc: RangeLoc;
}

export interface WarningReport {
  code: string;
  message: string;
  range?: RangeJson;
  loc?: RangeLoc;
}

export interface FixReport {
  /** True once the file was written; false for --dry-run and for refine without --write. */
  applied: boolean;
  scoreBefore: number;
  scoreAfter: number;
  /** The gradient text as found. */
  original: string;
  /** The gradient text after the rewrite. */
  replacement: string;
}

export interface GradientReport {
  range: RangeJson;
  loc: RangeLoc;
  kind: "linear" | "radial" | "conic";
  repeating: boolean;
  vendorPrefix?: string;
  /** "ok" = scored. "skipped" = outside the v1 domain or not understood; see `skipped`. */
  status: "ok" | "skipped";
  score: number | null;
  dimensions: { lightness: number; hue: number; chroma: number; spacing: number } | null;
  analysis?: { hasHardStops: boolean };
  issues: IssueReport[];
  warnings: WarningReport[];
  skipped?: { code: string; reason: string };
  fix?: FixReport;
}

export interface FileReport {
  /** Relative to the working directory, `/`-separated; `<stdin>` for standard input. */
  path: string;
  /** "scanned" = read and analysed; "skipped" = deliberately not read (see `skipped`); "error" = could not be read or written. */
  status: "scanned" | "skipped" | "error";
  gradients: GradientReport[];
  /** Gradients found beyond --max-gradients and not examined. */
  gradientsNotExamined?: number;
  skipped?: { code: "too-large" | "binary" | "not-utf8" | "ignored"; reason: string };
  error?: { code: string; message: string };
  /** True when --fix / --write changed the file. */
  rewritten?: boolean;
}

export interface Summary {
  filesScanned: number;
  filesSkipped: number;
  filesWithErrors: number;
  gradients: number;
  scored: number;
  skipped: number;
  /** Count of skipped gradients per skip code. */
  skippedByCode: Record<string, number>;
  /** Scored gradients below --min-score (after fixes). 0 without --min-score. */
  belowMinScore: number;
  minScore: number | null;
  failOnUnscorable: boolean;
  scoreMin: number | null;
  scoreMax: number | null;
  scoreMean: number | null;
  fixable: number;
  fixed: number;
  exitCode: 0 | 1 | 2 | 3;
}

export interface Report {
  schemaVersion: number;
  tool: { name: "opal42"; version: string };
  scoringModel: typeof SCORING_MODEL;
  command: "score" | "refine";
  files: FileReport[];
  summary: Summary;
}

// ── parse (debug) ─────────────────────────────────────────────────────────────

export interface Located {
  range: RangeJson;
  loc: RangeLoc;
  /** The source text of the range. */
  text: string;
}

export interface ParsedGradientReport {
  range: RangeJson;
  loc: RangeLoc;
  kind: "linear" | "radial" | "conic";
  repeating: boolean;
  vendorPrefix?: string;
  /** The gradient document (positions 0-1, angle in CSS degrees), or null when skipped. */
  document: unknown;
  stopRanges: Located[];
  angleRange?: Located;
  skipped?: { code: string; reason: string };
  warnings: WarningReport[];
}

export interface ParseFileReport {
  path: string;
  status: "scanned" | "skipped" | "error";
  gradients: ParsedGradientReport[];
  gradientsNotExamined?: number;
  skipped?: { code: "too-large" | "binary" | "not-utf8" | "ignored"; reason: string };
  error?: { code: string; message: string };
}

export interface ParseReport {
  schemaVersion: number;
  tool: { name: "opal42"; version: string };
  command: "parse";
  files: ParseFileReport[];
  summary: {
    filesScanned: number;
    filesSkipped: number;
    filesWithErrors: number;
    gradients: number;
    skipped: number;
    exitCode: 0 | 1 | 2 | 3;
  };
}
