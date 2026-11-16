// Tool handlers. Transport-independent: no MCP SDK, no Node, no I/O, no state.
// The stdio server (server.ts) and a future Worker both call `callTool`.
//
// Every handler is a pure function of its arguments and never throws:
// `callTool` validates against the published schema, runs the handler, and
// turns every failure into an `isError` result with a clear message.
//
// Wording: the number is a "smoothness score" under scoring model v1, defined
// by spec/scoring-v1.md. It is not a quality verdict and there is no threshold.

import {
  V1_MODEL,
  bakeStops,
  complement,
  hexToRgb,
  parseCssColor,
  proposeFixes,
  refine,
  resolveStops,
  rgbToOklab,
  score,
  scoreParsed,
  toCSS,
  type GradientDocument,
  type Issue,
  type ScoreResult,
} from "@opal42/gradient";
import { DEFAULT_PREVIEW_HEIGHT, DEFAULT_PREVIEW_WIDTH } from "./limits";
import { describeStops, echo, lineIndex, r4, resolveSource, type Gradient, type LineIndex, type SourceArgs } from "./input";
import {
  COMPLEMENT_INPUT,
  COMPLEMENT_OUTPUT,
  PREVIEW_INPUT,
  PREVIEW_OUTPUT,
  REFINE_INPUT,
  REFINE_OUTPUT,
  SCORE_INPUT,
  SCORE_OUTPUT,
} from "./schemas";
import { base64Ascii, renderSvg, type SvgStop } from "./svg";
import { excerpt, htmlSafe, validate, type JsonSchema } from "./validate";

export type { JsonSchema } from "./validate";
export { MAX_CSS_CHARS, MAX_GRADIENTS, MAX_STOPS } from "./limits";

// ── Result shapes ─────────────────────────────────────────────────────────────

export type ContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  content: ContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  annotations: {
    title: string;
    readOnlyHint: true;
    destructiveHint: false;
    idempotentHint: true;
    openWorldHint: false;
  };
}

export const SCORING_MODEL = "v1";
export const SERVER_NAME = "opal42-mcp";

/** Shown in every score result and in the server instructions. */
export const SCORE_NOTE =
  "Smoothness score under scoring model v1 (0-100), by the published definition in spec/scoring-v1.md. It is not a quality verdict and has no pass threshold; judge the coded issues against the intent of the design.";

export const SERVER_INSTRUCTIONS =
  "Tools for CSS gradients. score_gradient reports a smoothness score (0-100, scoring model v1, by a published definition; not a quality verdict) with coded, located issues. " +
  "refine_gradient proposes a one-click refinement and targeted per-issue fixes; it can change colours substantially, so check largestColorShift and keep the brand colours when they matter. " +
  "complement returns a colour's complement; render_preview draws a gradient as SVG. All tools are stateless and local: no network, no storage.";

// ── Helpers ───────────────────────────────────────────────────────────────────

const text = (t: string): ContentBlock => ({ type: "text", text: t });

function errorResult(message: string): ToolResult {
  return { content: [text(`Error: ${message}`)], isError: true };
}

function jsonResult(value: Record<string, unknown>): ToolResult {
  return { content: [text(htmlSafe(JSON.stringify(value)))], structuredContent: value };
}

type Dims = Record<"lightness" | "chroma" | "hue" | "spacing", number>;

/** Points kept per dimension, with the dimension's budget. */
function dimensionsOut(d: Dims): Record<string, { points: number; of: number }> {
  const w = V1_MODEL.weights;
  return {
    lightness: { points: d.lightness, of: w.lightness },
    chroma: { points: d.chroma, of: w.chroma },
    hue: { points: d.hue, of: w.hue },
    spacing: { points: d.spacing, of: w.rhythm },
  };
}

function header(g: Gradient, css: string | null, lines: LineIndex | null): Record<string, unknown> {
  const h: Record<string, unknown> = { index: g.index, kind: g.kind };
  if (g.repeating) h.repeating = true;
  if (g.vendorPrefix) h.vendorPrefix = g.vendorPrefix;
  h.css = echo(g.text);
  if (g.parsed && css !== null && lines) {
    h.range = { start: g.parsed.range.start, end: g.parsed.range.end };
    h.loc = lines.at(g.parsed.range.start);
  }
  return h;
}

function warningsOut(g: Gradient, lines: LineIndex | null): Record<string, unknown>[] {
  return (g.parsed?.warnings ?? []).map((w) => {
    const o: Record<string, unknown> = { code: w.code, message: w.message };
    if (w.range && lines) {
      o.range = { start: w.range.start, end: w.range.end };
      o.loc = lines.at(w.range.start);
    }
    return o;
  });
}

function issueOut(issue: Issue, doc: GradientDocument, lines: LineIndex | null): Record<string, unknown> {
  const o: Record<string, unknown> = {
    code: issue.code,
    severity: issue.severity,
    dimension: issue.dimension,
    pointsLost: issue.pointsLost,
    message: issue.message,
  };
  const stops = describeStops(doc, issue.stopIndices);
  if (stops.length > 0) o.stops = stops;
  if (issue.segment) o.segmentPercent = { start: r4(issue.segment.start * 100), end: r4(issue.segment.end * 100) };
  if (issue.range && lines) {
    o.range = { start: issue.range.start, end: issue.range.end };
    o.loc = lines.at(issue.range.start);
  }
  return o;
}

function scoreOf(g: Gradient): ScoreResult {
  if (g.skipped || !g.doc) {
    return { status: "unscorable", code: (g.skipped?.code ?? "invalid-document") as never, reason: g.skipped?.reason ?? "no gradient document" };
  }
  return g.parsed ? scoreParsed(g.parsed) : score(g.doc);
}

function skippedEntry(base: Record<string, unknown>, code: string, reason: string): Record<string, unknown> {
  return { ...base, status: "skipped", skipped: { code, reason } };
}

// ── score_gradient ────────────────────────────────────────────────────────────

function scoreEntry(g: Gradient, css: string | null, lines: LineIndex | null): Record<string, unknown> {
  const base = header(g, css, lines);
  const res = scoreOf(g);
  if (res.status !== "ok" || !g.doc) {
    const reason = res.status === "ok" ? "no gradient document" : res.reason;
    const entry = skippedEntry(base, res.status === "ok" ? "invalid-document" : res.code, reason);
    const w = warningsOut(g, lines);
    if (w.length > 0) entry.warnings = w;
    return entry;
  }
  return {
    ...base,
    status: "scored",
    score: res.score,
    dimensions: dimensionsOut(res.dimensions),
    issues: res.issues.map((i) => issueOut(i, g.doc as GradientDocument, lines)),
    hasHardStops: res.analysis.hasHardStops,
    warnings: warningsOut(g, lines),
  };
}

function runScore(args: SourceArgs): ToolResult {
  const src = resolveSource(args);
  if (!src.ok) return errorResult(src.message);
  const lines = src.css !== null ? lineIndex(src.css) : null;
  const gradients = src.gradients.map((g) => scoreEntry(g, src.css, lines));
  const scores = gradients.filter((g) => g.status === "scored").map((g) => g.score as number);
  const out: Record<string, unknown> = {
    scoringModel: SCORING_MODEL,
    note: SCORE_NOTE,
    gradientCount: gradients.length,
  };
  if (src.notExamined > 0) out.gradientsNotExamined = src.notExamined;
  out.gradients = gradients;
  out.summary = {
    scored: scores.length,
    skipped: gradients.length - scores.length,
    scoreMin: scores.length > 0 ? Math.min(...scores) : null,
    scoreMax: scores.length > 0 ? Math.max(...scores) : null,
  };
  if (gradients.length === 0) out.message = "No linear-gradient(), radial-gradient() or conic-gradient() function was found in the css.";
  return jsonResult(out);
}

// ── refine_gradient ───────────────────────────────────────────────────────────

const deltaE = (a: string, b: string): number => {
  const x = rgbToOklab(hexToRgb(a));
  const y = rgbToOklab(hexToRgb(b));
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
};

type Scored = Extract<ScoreResult, { status: "ok" }>;

const scoreBlock = (r: Scored) => ({ score: r.score, dimensions: dimensionsOut(r.dimensions) });

function refineEntry(g: Gradient, css: string | null, lines: LineIndex | null): Record<string, unknown> {
  const base = header(g, css, lines);
  const before = scoreOf(g);
  if (before.status !== "ok" || !g.doc) {
    const reason = before.status === "ok" ? "no gradient document" : before.reason;
    return skippedEntry(base, before.status === "ok" ? "invalid-document" : before.code, reason);
  }
  const doc = g.doc;
  const declined = (code: string, reason: string): Record<string, unknown> => ({
    ...base,
    status: "scored",
    before: scoreBlock(before),
    refined: false,
    declined: { code, reason },
    fixes: [],
  });

  // Same rules as the CLI's --fix: intent that the stop list cannot express is left alone.
  if (g.parsed?.warnings.some((w) => w.code === "color-hint-ignored")) {
    return declined("color-hints", "the gradient has colour hints (transition midpoints), which the document model drops; refining would lose them");
  }
  if (before.analysis.hasHardStops) {
    return declined("hard-stops", "the gradient has hard stops (stripes or hard edges); they are usually intentional, so it is left alone");
  }

  const tagged: GradientDocument = { ...doc, stops: doc.stops.map((s, i) => ({ ...s, id: String(i) })) };
  const outcome = refine(tagged);
  const fixes = proposeFixes(tagged).map((f) => ({
    code: f.code,
    label: f.label,
    kind: f.kind,
    gain: f.gain,
    scoreBefore: f.before.status === "ok" ? f.before.score : before.score,
    scoreAfter: f.after.status === "ok" ? f.after.score : before.score,
    changedStops: f.changedStops,
    css: toCSS(f.document) ?? "",
  }));

  if (!outcome.refined) {
    const d = outcome.declined;
    return { ...declined(d?.code ?? "would-lower-score", d?.reason ?? "the refinement would not raise the score"), fixes };
  }
  if (outcome.after.status !== "ok" || outcome.after.score <= before.score) {
    return { ...declined("no-gain", "the refinement does not raise the score"), fixes };
  }

  const resolved = resolveStops(doc);
  const refinedById = new Map(outcome.document.stops.map((s) => [s.id, s]));
  const changes: Record<string, unknown>[] = [];
  let largest = 0;
  for (let i = 0; i < doc.stops.length; i++) {
    const next = refinedById.get(String(i));
    if (!next) continue;
    const from = resolved[i];
    const nextPos = next.position ?? from.position;
    const colorChanged = next.color !== from.color;
    const posChanged = Math.abs(nextPos - from.position) > 1e-9;
    if (!colorChanged && !posChanged) continue;
    const shift = colorChanged ? r4(deltaE(from.color, next.color)) : 0;
    if (shift > largest) largest = shift;
    changes.push({
      stopIndex: i,
      from: { color: from.color, positionPercent: r4(from.position * 100) },
      to: { color: next.color, positionPercent: r4(nextPos * 100) },
      colorShift: shift,
    });
  }
  const refinedResolved = resolveStops(outcome.document);
  return {
    ...base,
    status: "scored",
    before: scoreBlock(before),
    refined: true,
    after: scoreBlock(outcome.after),
    refinedCss: toCSS(outcome.document) ?? "",
    refinedStops: refinedResolved.map((s) => ({ color: s.color, positionPercent: r4(s.position * 100) })),
    changes,
    largestColorShift: r4(largest),
    remainingIssues: outcome.after.issues.map((i) => ({ code: i.code, severity: i.severity, pointsLost: i.pointsLost, message: i.message })),
    fixes,
  };
}

const REFINE_NOTE =
  "Refinement can change colours and positions substantially (colorShift is an OKLAB distance: about 0.02 is barely visible, above about 0.1 is a clearly different colour). Check changes against the design intent before using refinedCss; targeted fixes change fewer stops. " +
  SCORE_NOTE;

function runRefine(args: SourceArgs): ToolResult {
  const src = resolveSource(args);
  if (!src.ok) return errorResult(src.message);
  const lines = src.css !== null ? lineIndex(src.css) : null;
  const gradients = src.gradients.map((g) => refineEntry(g, src.css, lines));
  const out: Record<string, unknown> = {
    scoringModel: SCORING_MODEL,
    note: REFINE_NOTE,
    gradientCount: gradients.length,
  };
  if (src.notExamined > 0) out.gradientsNotExamined = src.notExamined;
  out.gradients = gradients;
  out.summary = {
    refined: gradients.filter((g) => g.refined === true).length,
    declined: gradients.filter((g) => g.status === "scored" && g.refined === false).length,
    skipped: gradients.filter((g) => g.status === "skipped").length,
  };
  if (gradients.length === 0) out.message = "No linear-gradient(), radial-gradient() or conic-gradient() function was found in the css.";
  return jsonResult(out);
}

// ── complement ────────────────────────────────────────────────────────────────

function runComplement(args: { color: string }): ToolResult {
  const parsed = parseCssColor(args.color);
  if (!parsed) {
    return errorResult(`color: ${excerpt(args.color)} is not a supported CSS colour (hex, rgb(), hsl(), a named colour, oklab() or oklch())`);
  }
  const result = complement(parsed.color);
  if (result === null) return errorResult(`color: could not compute the complement of ${excerpt(args.color)}`);
  const out: Record<string, unknown> = { input: echo(args.color), color: parsed.color, complement: result };
  if (parsed.alpha < 1) out.alphaIgnored = true;
  return jsonResult(out);
}

// ── render_preview ────────────────────────────────────────────────────────────

const BAKED_STOPS = 24;

function runPreview(args: SourceArgs & { index?: number; width?: number; height?: number }): ToolResult {
  const src = resolveSource(args, Number.MAX_SAFE_INTEGER);
  if (!src.ok) return errorResult(src.message);
  if (src.gradients.length === 0) return errorResult("no gradient function was found in the css");
  const index = args.index ?? 0;
  const g = src.gradients[index];
  if (!g) return errorResult(`index: ${index} is out of range (${src.gradients.length} gradient(s) found)`);
  if (g.skipped || !g.doc) {
    return errorResult(`gradient ${index} cannot be drawn: ${g.skipped?.code ?? "invalid-document"}: ${g.skipped?.reason ?? "no gradient document"}`);
  }
  const doc = g.doc;
  if (doc.repeating) return errorResult(`gradient ${index} is a repeating gradient; the preview draws plain linear gradients only`);

  const resolved = resolveStops(doc);
  if (resolved.some((s) => s.position < 0 || s.position > 1)) {
    return errorResult(`gradient ${index} has stop positions outside 0-100%, which the preview does not draw`);
  }
  const space = doc.interpolation?.space ?? "srgb";
  // SVG gradients interpolate in sRGB only. For `in oklab` / `in oklch` the
  // stops are pre-sampled along that space so the picture matches the CSS.
  const drawn = space === "srgb" ? resolved : resolveStops({ ...doc, stops: bakeStops(doc, BAKED_STOPS, { interpolation: doc.interpolation }) });
  if (drawn.length === 0) return errorResult("the gradient could not be sampled");

  const width = args.width ?? DEFAULT_PREVIEW_WIDTH;
  const height = args.height ?? DEFAULT_PREVIEW_HEIGHT;
  const svgStops: SvgStop[] = drawn.map((s) => ({ color: s.color, offset: s.position, alpha: s.alpha }));
  const svg = renderSvg({ width, height, angle: doc.angle, stops: svgStops });

  const res = score(doc);
  const out: Record<string, unknown> = {
    mimeType: "image/svg+xml",
    width,
    height,
    angle: r4(doc.angle),
    interpolation: space,
    stops: resolved.map((s) => {
      const o: Record<string, unknown> = { color: s.color, positionPercent: r4(s.position * 100) };
      if (s.alpha !== undefined && s.alpha < 1) o.alpha = r4(s.alpha);
      return o;
    }),
    smoothnessScore: res.status === "ok" ? res.score : null,
    note:
      "The image block is an SVG; some clients cannot render SVG images, so the SVG source is also returned as text. Stops are drawn on a transparent background.",
  };
  const warnings = warningsOut(g, src.css !== null ? lineIndex(src.css) : null);
  if (warnings.length > 0) out.warnings = warnings;
  return {
    content: [{ type: "image", data: base64Ascii(svg), mimeType: "image/svg+xml" }, text(svg)],
    structuredContent: out,
  };
}

// ── Registry ──────────────────────────────────────────────────────────────────

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const TOOLS: readonly ToolDefinition[] = Object.freeze([
  {
    name: "score_gradient",
    title: "Score CSS gradients",
    description:
      "Score linear CSS gradients for smoothness under scoring model v1 (0-100; a published definition, not a quality verdict, no pass threshold). " +
      "Give `css` (any text containing gradient functions, up to 20 KB and 32 gradients) or structured `stops`. " +
      "Per gradient: the score, points kept per dimension (lightness, chroma, hue, spacing), coded issues (e.g. lightness/reversal, hue/wide-arc, chroma/muddy-midpoint) with the stops and source range they concern, parser warnings, or the reason it was skipped (var(), alpha, radial, ...). Read-only and local.",
    inputSchema: SCORE_INPUT,
    outputSchema: SCORE_OUTPUT,
    annotations: { title: "Score CSS gradients", ...READ_ONLY },
  },
  {
    name: "refine_gradient",
    title: "Refine CSS gradients",
    description:
      "Propose a one-click refinement of linear CSS gradients and targeted fixes (at most one per issue). Returns refined CSS with before/after scores and the per-stop changes (including colorShift, an OKLAB distance), or the reason it declined (hard stops, colour hints, no gain). " +
      "Refinement can change colours a lot; check the changes against the design intent. Does not edit anything: returns text only. Same input as score_gradient.",
    inputSchema: REFINE_INPUT,
    outputSchema: REFINE_OUTPUT,
    annotations: { title: "Refine CSS gradients", ...READ_ONLY },
  },
  {
    name: "complement",
    title: "Complementary colour",
    description: "Return the complementary colour (hue rotated by 180 degrees in OKLCH) of a CSS colour as #rrggbb. Alpha is ignored.",
    inputSchema: COMPLEMENT_INPUT,
    outputSchema: COMPLEMENT_OUTPUT,
    annotations: { title: "Complementary colour", ...READ_ONLY },
  },
  {
    name: "render_preview",
    title: "Render a gradient preview",
    description:
      "Draw one linear gradient as an SVG image (`css` or `stops`). Only validated #rrggbb colours and numbers reach the SVG. Returns an image block (image/svg+xml) and the SVG source as text. `in oklab`/`in oklch` gradients are pre-sampled so the picture matches the CSS.",
    inputSchema: PREVIEW_INPUT,
    outputSchema: PREVIEW_OUTPUT,
    annotations: { title: "Render a gradient preview", ...READ_ONLY },
  },
]);

type Runner = (args: never) => ToolResult;

const RUNNERS: Readonly<Record<string, Runner>> = Object.freeze({
  score_gradient: runScore as Runner,
  refine_gradient: runRefine as Runner,
  complement: runComplement as Runner,
  render_preview: runPreview as Runner,
});

/**
 * Run one tool. Never throws: unknown tool names, invalid arguments and every
 * internal failure come back as `{ isError: true }` results.
 */
export function callTool(name: unknown, args: unknown): ToolResult {
  try {
    if (typeof name !== "string" || !Object.hasOwn(RUNNERS, name)) {
      return errorResult(`unknown tool ${typeof name === "string" ? excerpt(name) : "(not a string)"}; available: ${TOOLS.map((t) => t.name).join(", ")}`);
    }
    const tool = TOOLS.find((t) => t.name === name) as ToolDefinition;
    const input = args === undefined || args === null ? {} : args;
    const problem = validate(tool.inputSchema, input);
    if (problem) return errorResult(`invalid arguments for ${name}: ${problem}`);
    return (RUNNERS[name] as (a: unknown) => ToolResult)(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown failure";
    return errorResult(`internal error in ${typeof name === "string" ? name : "tool"}: ${msg.slice(0, 200)}`);
  }
}
