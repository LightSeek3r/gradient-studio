// Token-level analysis shared by the transforms, the formats and the minScore
// check. Everything here is pure: the same token gives the same result.

import { refine, score, toCSS, type GradientDocument, type Issue } from "@opal42/gradient";
import { isLocked, readGradient, type ReadOk, type ReadSkip, type StopSource } from "./read";

/** The parts of a Style Dictionary token this package looks at. */
export interface TokenLike {
  path?: string[];
  name?: string;
  attributes?: Record<string, unknown>;
  [key: string]: unknown;
}

/** The parts of the Style Dictionary options this package looks at. */
export interface SdOptionsLike {
  usesDtcg?: boolean;
  log?: { verbosity?: string };
  [key: string]: unknown;
}

export interface Finding {
  code: string;
  severity: string;
  pointsLost: number;
  stops: number[];
}

/** What `opal42/gradient-score` stores in `token.attributes.opal42`. */
export interface GradientAttributes {
  /** Smoothness score by our definition (scoring model v1), integer 0-100; null when not scored. */
  score: number | null;
  scoringModel: "v1";
  findings: Finding[];
  /** `scored`, `unscorable` (read, but outside the model's domain) or `skipped` (could not be read). */
  status: "scored" | "unscorable" | "skipped";
  /** Present (true) when two neighbouring stops share a position but not a colour: v1 numbers are not adjusted for stripes. */
  hardStops?: true;
  /** Why a token was not scored. */
  code?: string;
  reason?: string;
}

export type Analysis =
  | { status: "scored"; score: number; findings: Finding[]; hasHardStops: boolean; read: ReadOk }
  | { status: "unscorable"; code: string; reason: string; read: ReadOk }
  | { status: "skipped"; code: string; reason: string };

export interface AnalyzeOptions {
  /** Angle for tokens that carry none (the DTCG gradient has no angle). */
  angle?: number;
}

export function valueOf(token: TokenLike, options?: SdOptionsLike): unknown {
  return options?.usesDtcg ? token.$value : token.value;
}

export function typeOf(token: TokenLike, options?: SdOptionsLike): unknown {
  return options?.usesDtcg ? token.$type : token.type;
}

export function extensionsOf(token: TokenLike): unknown {
  return token.$extensions ?? token.extensions;
}

const CSS_GRADIENT = /(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;

/** A gradient token: type `gradient`, or a legacy string value that holds a CSS gradient function. */
export function isGradientToken(token: TokenLike, options?: SdOptionsLike): boolean {
  if (typeOf(token, options) === "gradient") return true;
  const v = valueOf(token, options);
  return typeof v === "string" && CSS_GRADIENT.test(v);
}

export function tokenPath(token: TokenLike): string {
  return Array.isArray(token.path) ? token.path.join(".") : String(token.name ?? "");
}

const findingsOf = (issues: Issue[]): Finding[] =>
  issues.map((i) => ({ code: i.code, severity: i.severity, pointsLost: i.pointsLost, stops: i.stopIndices ?? [] }));

export function analyzeValue(value: unknown, extensions: unknown, opts: AnalyzeOptions = {}): Analysis {
  const read = readGradient(value, { extensions, ...(opts.angle !== undefined ? { angle: opts.angle } : {}) });
  if (read.status === "skipped") return read;
  const result = score(read.document);
  if (result.status !== "ok") return { status: "unscorable", code: result.code, reason: result.reason, read };
  return { status: "scored", score: result.score, findings: findingsOf(result.issues), hasHardStops: result.analysis.hasHardStops, read };
}

export function analyzeToken(token: TokenLike, options?: SdOptionsLike, opts: AnalyzeOptions = {}): Analysis {
  return analyzeValue(valueOf(token, options), extensionsOf(token), opts);
}

export function toAttributes(a: Analysis): GradientAttributes {
  if (a.status === "scored") return { score: a.score, scoringModel: "v1", findings: a.findings, status: "scored", ...(a.hasHardStops ? { hardStops: true as const } : {}) };
  return { score: null, scoringModel: "v1", findings: [], status: a.status, code: a.code, reason: a.reason };
}

export interface RefineReport {
  before: number;
  after: number;
  changedStops: number[];
}

export type RefineOutcome =
  | { applied: true; value: unknown; report: RefineReport }
  | { applied: false; code: string; reason: string };

const round = (n: number, p: number) => Math.round(n * p) / p;

function dtcgColor(hex: string, alpha: number) {
  const c = (i: number) => round(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255, 1e6);
  return { colorSpace: "srgb", components: [c(0), c(1), c(2)], alpha, hex };
}

function rewriteArray(sources: StopSource[], doc: GradientDocument): unknown[] {
  return doc.stops.map((s, i) => {
    const src = sources[i] as StopSource;
    const base = { ...src.original };
    const changed = s.color !== src.hex;
    const color = changed ? (src.style === "string" ? s.color : dtcgColor(s.color, 1)) : base.color;
    const position = s.position === undefined ? base.position : round(s.position, 1e5);
    return { ...base, color, ...(position === undefined ? {} : { position }) };
  });
}

/**
 * The refined value of a token, or why it is left alone. Refines only when
 * every condition holds: not locked, readable, scorable, no alpha, no hard
 * stops (all part of "scorable" and the model's own analysis), the core
 * `refine` improved the score strictly, and the result can be written back in
 * the token's own shape without losing information.
 */
export function refineToken(token: TokenLike, options?: SdOptionsLike, opts: AnalyzeOptions = {}): RefineOutcome {
  const no = (code: string, reason: string): RefineOutcome => ({ applied: false, code, reason });
  const ext = extensionsOf(token);
  if (isLocked(ext)) return no("locked", "$extensions.opal42.lock is true");
  const value = valueOf(token, options);
  const a = analyzeValue(value, ext, opts);
  if (a.status === "skipped") return no(a.code, a.reason);
  if (a.status === "unscorable") return no(a.code, a.reason);
  if (a.hasHardStops) return no("hard-stops", "hard stops are never refined");
  const { read } = a;
  if (read.warnings.includes("color-hint-ignored") || read.warnings.includes("corner-angle")) {
    return no("not-rewritable", "the CSS string has colour hints or a corner direction that a rewrite would change");
  }
  const r = refine(read.document);
  if (!r.refined || r.before.status !== "ok" || r.after.status !== "ok" || !(r.after.score > r.before.score)) {
    return no("no-improvement", "no strictly better refinement exists");
  }
  if (r.document.stops.length !== read.document.stops.length) return no("not-rewritable", "the refinement changed the number of stops");
  let newValue: unknown;
  if (read.shape === "dtcg-array" && read.stops && Array.isArray(value)) {
    newValue = rewriteArray(read.stops, r.document);
  } else {
    const css = toCSS(r.document);
    if (css === null) return no("not-rewritable", "the refined gradient could not be printed");
    newValue = css;
  }
  const changedStops: number[] = [];
  r.document.stops.forEach((s, i) => {
    const o = read.document.stops[i];
    if (!o || s.color !== o.color || s.position !== o.position) changedStops.push(i);
  });
  return { applied: true, value: newValue, report: { before: r.before.score, after: r.after.score, changedStops } };
}

/** The CSS gradient string for a token's current value, or why there is none. */
export function cssOf(token: TokenLike, options?: SdOptionsLike, opts: AnalyzeOptions = {}): { css: string } | ReadSkip {
  const read = readGradient(valueOf(token, options), { extensions: extensionsOf(token), ...(opts.angle !== undefined ? { angle: opts.angle } : {}) });
  if (read.status === "skipped") return read;
  const css = toCSS(read.document);
  if (css === null) return { status: "skipped", code: "invalid-document", reason: "the gradient could not be printed as CSS" };
  return { css };
}
