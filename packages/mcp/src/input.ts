// Turns tool arguments into the list of gradients a tool works on, and builds
// the small located structures (line/column, stop descriptions) shared by the
// handlers. Pure; the only failure channel is the `message` of a `{ ok: false }`.

import {
  parseCssColor,
  parseGradient,
  resolveStops,
  toCSS,
  type GradientDocument,
  type ParsedGradient,
  type SkipCode,
  type Stop,
} from "@opal42/gradient";
import { MAX_CSS_CHARS, MAX_ECHO_CHARS, MAX_GRADIENTS } from "./limits";
import { excerpt } from "./validate";

export interface Gradient {
  /** 0-based position among the gradients found in the input. */
  index: number;
  kind: "linear" | "radial" | "conic";
  repeating: boolean;
  vendorPrefix?: string;
  /** Null exactly when `skipped` is set. */
  doc: GradientDocument | null;
  /** The parser's result; absent for structured `stops` input. */
  parsed?: ParsedGradient;
  /** Source text of the gradient function (css input) or its printed form (stops input). */
  text: string;
  skipped?: { code: SkipCode | string; reason: string };
}

export type Source =
  | { ok: true; gradients: Gradient[]; notExamined: number; css: string | null }
  | { ok: false; message: string };

export interface SourceArgs {
  css?: string;
  stops?: { color: string; position?: number }[];
  angle?: number;
  interpolation?: "srgb" | "oklab" | "oklch";
}

/** Rounds to 4 decimals and removes -0. */
export function r4(v: number): number {
  const x = Math.round(v * 1e4) / 1e4;
  return Object.is(x, -0) ? 0 : x;
}

export function echo(text: string): string {
  return text.length > MAX_ECHO_CHARS ? `${text.slice(0, MAX_ECHO_CHARS)}...` : text;
}

/** Document built from structured stops; a message when a colour is not usable. */
export function documentFromStops(args: SourceArgs): { ok: true; doc: GradientDocument } | { ok: false; message: string } {
  const stops: Stop[] = [];
  const input = args.stops ?? [];
  for (let i = 0; i < input.length; i++) {
    const s = input[i];
    const parsed = parseCssColor(s.color);
    if (!parsed) {
      return {
        ok: false,
        message: `stops[${i}].color: ${excerpt(s.color)} is not a supported CSS colour (hex, rgb(), hsl(), a named colour, oklab() or oklch(); no var(), calc() or color-mix())`,
      };
    }
    const stop: Stop = { color: parsed.color };
    if (parsed.alpha < 1) stop.alpha = parsed.alpha;
    if (s.position !== undefined) stop.position = s.position / 100;
    stops.push(stop);
  }
  const doc: GradientDocument = { kind: "linear", angle: args.angle ?? 180, stops };
  if (args.interpolation === "oklab" || args.interpolation === "oklch") doc.interpolation = { space: args.interpolation };
  return { ok: true, doc };
}

/**
 * The gradients to work on: every gradient function found in `css` (at most
 * `limit`), or the one gradient described by `stops`. Exactly one of the two
 * must be given.
 */
export function resolveSource(args: SourceArgs, limit = MAX_GRADIENTS): Source {
  const hasCss = args.css !== undefined;
  const hasStops = args.stops !== undefined;
  if (hasCss && hasStops) return { ok: false, message: "give either `css` or `stops`, not both" };
  if (!hasCss && !hasStops) return { ok: false, message: "give `css` (text containing gradients) or `stops` (a structured gradient)" };

  if (hasCss) {
    const css = args.css as string;
    const { gradients } = parseGradient(css, { maxInputLength: MAX_CSS_CHARS });
    const used = gradients.slice(0, limit);
    return {
      ok: true,
      css,
      notExamined: gradients.length - used.length,
      gradients: used.map((p, index) => {
        const g: Gradient = {
          index,
          kind: p.kind,
          repeating: p.repeating,
          doc: p.document,
          parsed: p,
          text: css.slice(p.range.start, p.range.end),
        };
        if (p.vendorPrefix) g.vendorPrefix = p.vendorPrefix;
        if (p.skipped) g.skipped = { code: p.skipped.code, reason: p.skipped.reason };
        return g;
      }),
    };
  }

  const built = documentFromStops(args);
  if (!built.ok) return built;
  return {
    ok: true,
    css: null,
    notExamined: 0,
    gradients: [{ index: 0, kind: "linear", repeating: false, doc: built.doc, text: toCSS(built.doc) ?? "" }],
  };
}

// ── Locations ─────────────────────────────────────────────────────────────────

export interface LineIndex {
  /** 1-based line and column of a UTF-16 offset. `\r\n`, `\n` and a lone `\r` each end a line. */
  at(offset: number): { line: number; col: number };
}

export function lineIndex(text: string): LineIndex {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) starts.push(i + 1);
    else if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) i++;
      starts.push(i + 1);
    }
  }
  return {
    at(offset) {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= offset) lo = mid;
        else hi = mid - 1;
      }
      return { line: lo + 1, col: offset - starts[lo] + 1 };
    },
  };
}

/** Stops of a document as reported in results: index, colour, resolved position in percent. */
export function describeStops(doc: GradientDocument, indices: readonly number[] | undefined): { index: number; color: string; positionPercent: number }[] {
  if (!indices || indices.length === 0) return [];
  const resolved = resolveStops(doc);
  const out: { index: number; color: string; positionPercent: number }[] = [];
  for (const i of indices) {
    const s = resolved[i];
    if (s) out.push({ index: i, color: s.color, positionPercent: r4(s.position * 100) });
  }
  return out;
}
