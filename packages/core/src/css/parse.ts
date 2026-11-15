// ── CSS gradient scanner and parser (PLAN D7, spec/parser.md) ──────────────────
// `parseGradient` finds every gradient function in arbitrary text and turns
// the linear ones it fully understands into `GradientDocument`s. Everything
// else is reported as a structured skip. It is a scanner, not a CSS parser:
// one forward pass with a bounded stack, so no input can make it quadratic.

import type {
  GradientDocument,
  GradientKind,
  HueInterpolation,
  Interpolation,
  ParsedGradient,
  ParseOptions,
  ParseResult,
  ParseWarning,
  SkipCode,
  SourceRange,
  Stop,
} from "../api/types";
import { angleToDegrees, dynamicFunctionCode, parseColorToken } from "./color";
import { isIdentChar, skipBraces, skipString, tokenize, type Token } from "./tokens";

const MAX_DEPTH = 64;
const MAX_NAME = 40;
const DEFAULT_MAX_STOPS = 32;
const DEFAULT_MAX_LENGTH = 100_000;
const DEFAULT_MAX_INPUT = 2_000_000;

const NAME = /^(-webkit-|-moz-|-o-|-ms-)?(repeating-)?(linear|radial|conic)-gradient$/;

interface Head {
  start: number;
  kind: GradientKind;
  repeating: boolean;
  vendorPrefix?: string;
  /** `-webkit-gradient(` */
  ancient: boolean;
}

interface Frame {
  head: Head | null;
  open: number;
  commas: number[];
  nested: boolean;
  tooDeep: boolean;
}

interface Found {
  head: Head;
  open: number;
  /** Index just past `)`, or -1 when the function never closes. */
  end: number;
  commas: number[];
  nested: boolean;
  tooDeep: boolean;
}

/** The gradient function whose `(` is at `open`, or null. */
function headAt(text: string, open: number): Head | null {
  let s = open;
  const floor = Math.max(0, open - MAX_NAME);
  while (s > floor && isIdentChar(text.charCodeAt(s - 1))) s--;
  if (s === open) return null;
  if (s > 0) {
    const before = text.charCodeAt(s - 1);
    // Still inside a longer identifier, or a preprocessor name ($x, @x, .mixin).
    if (isIdentChar(before) || before === 36 || before === 64 || before === 46) return null;
  }
  const name = text.slice(s, open).toLowerCase();
  if (name === "-webkit-gradient") {
    return { start: s, kind: "linear", repeating: false, vendorPrefix: "-webkit-", ancient: true };
  }
  const m = NAME.exec(name);
  if (!m) return null;
  const head: Head = { start: s, kind: m[3] as GradientKind, repeating: m[2] !== undefined, ancient: false };
  if (m[1]) head.vendorPrefix = m[1];
  return head;
}

function isUrlAt(text: string, open: number): boolean {
  if (open < 3) return false;
  if (text.slice(open - 3, open).toLowerCase() !== "url") return false;
  return open === 3 || !isIdentChar(text.charCodeAt(open - 4));
}

/** One forward pass: every gradient function with its top-level commas. */
function scan(text: string, limit: number): Found[] {
  const found: Found[] = [];
  const stack: Frame[] = [];
  let overflow = 0;
  let open = 0; // gradient frames currently on the stack
  let quote = 0;
  let i = 0;

  const flush = (): void => {
    for (const f of stack) {
      if (f.head) found.push({ head: f.head, open: f.open, end: -1, commas: f.commas, nested: f.nested, tooDeep: f.tooDeep });
    }
    stack.length = 0;
    overflow = 0;
    open = 0;
  };

  while (i < limit) {
    const c = text.charCodeAt(i);
    switch (c) {
      case 92: // backslash
        i += 2;
        continue;
      case 47: {
        // slash
        const next = text.charCodeAt(i + 1);
        if (next === 42 && (quote === 0 || open > 0)) {
          const close = text.indexOf("*/", i + 2);
          i = close === -1 ? limit : close + 2;
          continue;
        }
        if (next === 47 && quote === 0 && (i === 0 || text.charCodeAt(i - 1) !== 58)) {
          const nl = text.indexOf("\n", i);
          i = nl === -1 ? limit : nl;
          continue;
        }
        break;
      }
      case 34:
      case 39: // quotes
        if (open > 0) {
          if (c === quote) {
            flush();
            quote = 0;
          } else {
            i = skipString(text, i, limit);
            continue;
          }
        } else if (quote === 0) quote = c;
        else if (quote === c) quote = 0;
        break;
      case 96: // backtick
        if (open > 0) flush();
        break;
      case 10:
        if (open === 0) quote = 0;
        break;
      case 40: {
        // (
        if (isUrlAt(text, i)) {
          let j = i + 1;
          while (j < limit && (text.charCodeAt(j) === 32 || text.charCodeAt(j) === 9)) j++;
          const q = text.charCodeAt(j);
          if (q !== 34 && q !== 39) {
            const close = text.indexOf(")", i);
            i = close === -1 ? limit : close + 1;
            continue;
          }
        }
        if (stack.length >= MAX_DEPTH) {
          overflow++;
          if (open > 0) for (const f of stack) f.tooDeep = true;
          break;
        }
        const head = headAt(text, i);
        if (head) {
          if (open > 0) for (const f of stack) if (f.head) f.nested = true;
          open++;
        }
        stack.push({ head, open: i, commas: [], nested: false, tooDeep: false });
        break;
      }
      case 41: // )
        if (overflow > 0) overflow--;
        else {
          const f = stack.pop();
          if (f && f.head) {
            open--;
            found.push({ head: f.head, open: f.open, end: i + 1, commas: f.commas, nested: f.nested, tooDeep: f.tooDeep });
          }
        }
        break;
      case 44: // ,
        if (overflow === 0 && open > 0) {
          const top = stack[stack.length - 1];
          if (top.head) top.commas.push(i);
        }
        break;
      case 123: {
        // {
        const prev = i > 0 ? text.charCodeAt(i - 1) : 0;
        if (open > 0 && (prev === 36 || prev === 35 || prev === 64)) {
          i = skipBraces(text, i, limit);
          continue;
        }
        if (stack.length > 0) flush();
        break;
      }
      case 59:
      case 125: // ; }
        if (stack.length > 0) flush();
        break;
    }
    i++;
  }
  flush();
  return found;
}

// ── Argument parsing ──────────────────────────────────────────────────────────

interface Skip {
  code: SkipCode;
  reason: string;
}

const RADIAL_CONIC_PRELUDE =
  "|circle|ellipse|closest-side|closest-corner|farthest-side|farthest-corner|at|from|in|to|center|top|bottom|left|right|";

const ANGLE_UNITS = "|deg|grad|rad|turn|";
const linearKind = (kind: GradientKind): boolean => kind === "linear";

/** Is the first argument a direction/shape prelude rather than a colour stop? */
function isPrelude(tokens: Token[], kind: GradientKind): boolean {
  const first = tokens[0];
  if (!first) return false;
  if (first.type === "ident") {
    if (first.value === "to" || first.value === "in") return true;
    return kind !== "linear" && RADIAL_CONIC_PRELUDE.includes(`|${first.value}|`);
  }
  const second = tokens[1];
  if (first.type === "fn") {
    return dynamicFunctionCode(first.name) === "calc" && (!second || (second.type === "ident" && second.value === "in"));
  }
  if (first.type !== "num") return false;
  if (linearKind(kind) && ANGLE_UNITS.includes(`|${first.unit}|`)) return true;
  if (tokens.length === 1) return kind !== "linear" || first.unit !== "%";
  if (second.type === "ident") return second.value === "in" || (kind !== "linear" && RADIAL_CONIC_PRELUDE.includes(`|${second.value}|`));
  return kind !== "linear" && second.type === "num";
}

const SIDES: Record<string, number> = { top: 0, right: 90, bottom: 180, left: 270 };
const HUES = "|shorter|longer|increasing|decreasing|";
const UNSUPPORTED_SPACES =
  "|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|lab|lch|hsl|hwb|xyz|xyz-d50|xyz-d65|display-p3-linear|";

interface Prelude {
  angle: number;
  angleRange?: SourceRange;
  interpolation?: Interpolation;
  warning?: ParseWarning;
}

function parseLinearPrelude(tokens: Token[]): Prelude | Skip {
  const out: Prelude = { angle: 180 };
  let i = 0;
  let sawAngle = false;
  let sawIn = false;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.type === "fn") {
      const code = dynamicFunctionCode(t.name);
      return { code: code ?? "syntax", reason: `${t.name}() in the gradient direction cannot be resolved statically` };
    }
    if (t.type === "interp") return { code: "preprocessor", reason: "preprocessor variable or template expression in the gradient direction" };
    if (t.type === "num" && !sawAngle) {
      const deg = t.unit === "" ? (t.value === 0 ? 0 : null) : angleToDegrees(t.value, t.unit);
      if (deg === null || !Number.isFinite(deg)) return { code: "syntax", reason: "the gradient direction is not an angle" };
      out.angle = deg === 0 ? 0 : deg;
      out.angleRange = { start: t.start, end: t.end };
      sawAngle = true;
      i++;
    } else if (t.type === "ident" && t.value === "to" && !sawAngle) {
      const a = tokens[i + 1];
      const b = tokens[i + 2];
      if (!a || a.type !== "ident" || !Object.hasOwn(SIDES, a.value)) return { code: "syntax", reason: "'to' must be followed by a side" };
      if (b && b.type === "ident" && Object.hasOwn(SIDES, b.value)) {
        const vertical = (s: string): boolean => s === "top" || s === "bottom";
        if (vertical(a.value) === vertical(b.value)) return { code: "syntax", reason: `'to ${a.value} ${b.value}' is not a corner` };
        const v = vertical(a.value) ? a.value : b.value;
        const h = vertical(a.value) ? b.value : a.value;
        out.angle = v === "top" ? (h === "right" ? 45 : 315) : h === "right" ? 135 : 225;
        out.angleRange = { start: t.start, end: b.end };
        out.warning = {
          code: "corner-angle",
          message: `'to ${a.value} ${b.value}' depends on the box's aspect ratio; ${out.angle}deg assumes a square box`,
          range: out.angleRange,
        };
        i += 3;
      } else {
        out.angle = SIDES[a.value];
        out.angleRange = { start: t.start, end: a.end };
        i += 2;
      }
      sawAngle = true;
    } else if (t.type === "ident" && t.value === "in" && !sawIn) {
      const s = tokens[i + 1];
      if (!s || s.type !== "ident") return { code: "syntax", reason: "'in' must be followed by a colour space" };
      if (s.value !== "srgb" && s.value !== "oklab" && s.value !== "oklch") {
        return UNSUPPORTED_SPACES.includes(`|${s.value}|`)
          ? { code: "interpolation-space", reason: `interpolation in ${s.value} is not supported` }
          : { code: "syntax", reason: `'${s.value}' is not a colour space` };
      }
      out.interpolation = { space: s.value };
      i += 2;
      const h = tokens[i];
      if (h && h.type === "ident" && HUES.includes(`|${h.value}|`)) {
        const kw = tokens[i + 1];
        if (!kw || kw.type !== "ident" || kw.value !== "hue" || s.value !== "oklch") {
          return { code: "syntax", reason: "malformed hue interpolation method" };
        }
        out.interpolation.hue = h.value as HueInterpolation;
        i += 2;
      }
      sawIn = true;
    } else {
      return { code: "syntax", reason: "malformed gradient direction" };
    }
  }
  return out;
}

const LENGTH_UNITS =
  "|px|em|rem|ex|ch|cap|ic|lh|rlh|vw|vh|vi|vb|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|cqw|cqh|cqi|cqb|cqmin|cqmax|cm|mm|q|in|pt|pc|";

function parsePosition(t: Extract<Token, { type: "num" }>): number | Skip {
  if (!Number.isFinite(t.value)) return { code: "syntax", reason: "malformed number" };
  if (t.unit === "%") return t.value / 100;
  if (t.unit === "") {
    return t.value === 0 ? 0 : { code: "syntax", reason: `stop position ${t.value} has no unit` };
  }
  if (LENGTH_UNITS.includes(`|${t.unit}|`)) {
    return { code: "length-position", reason: `stop position in ${t.unit} depends on the box size; only % positions are supported` };
  }
  return { code: "syntax", reason: `'${t.unit}' is not a position unit` };
}

/** Trimmed source range of a token list. */
function span(tokens: Token[]): SourceRange {
  return { start: tokens[0].start, end: tokens[tokens.length - 1].end };
}

function skippedResult(f: Found, end: number, skip: Skip, stopRanges: SourceRange[] = []): ParsedGradient {
  const g: ParsedGradient = {
    range: { start: f.head.start, end },
    kind: f.head.kind,
    repeating: f.head.repeating,
    document: null,
    stopRanges,
    skipped: skip,
    warnings: [],
  };
  if (f.head.vendorPrefix) g.vendorPrefix = f.head.vendorPrefix;
  return g;
}

function build(text: string, f: Found, maxStops: number, maxLength: number): ParsedGradient {
  const name = text.slice(f.head.start, f.open);
  if (f.end === -1) {
    return skippedResult(f, f.open + 1, { code: "unbalanced", reason: `${name}( is never closed` });
  }
  if (f.head.ancient) {
    const first = tokenize(text, f.open + 1, Math.min(f.end - 1, f.open + 65))[0];
    if (first && first.type === "ident" && first.value === "radial") f.head.kind = "radial";
    return skippedResult(f, f.end, { code: "legacy-syntax", reason: "-webkit-gradient() is the pre-standard syntax" });
  }
  if (f.head.vendorPrefix) {
    return skippedResult(f, f.end, {
      code: "legacy-syntax",
      reason: `${f.head.vendorPrefix}${f.head.kind}-gradient() uses the legacy angle and keyword conventions`,
    });
  }
  if (f.tooDeep) return skippedResult(f, f.end, { code: "too-deep", reason: `parentheses nested deeper than ${MAX_DEPTH}` });
  if (f.end - f.head.start > maxLength) {
    return skippedResult(f, f.end, { code: "too-long", reason: `gradient is longer than ${maxLength} characters` });
  }
  if (f.nested) return skippedResult(f, f.end, { code: "syntax", reason: "a gradient cannot contain another gradient" });

  // Split on the top-level commas the scanner recorded.
  const args: Token[][] = [];
  let from = f.open + 1;
  for (let k = 0; k <= f.commas.length; k++) {
    const to = k < f.commas.length ? f.commas[k] : f.end - 1;
    args.push(tokenize(text, from, to));
    from = to + 1;
  }

  const linear = f.head.kind === "linear";
  const state: { skip: Skip | null } = { skip: null };
  const fail = (s: Skip): void => {
    state.skip ??= s;
  };
  const warnings: ParseWarning[] = [];
  let prelude: Prelude = { angle: 180 };
  let first = 0;

  if (isPrelude(args[0], f.head.kind)) {
    first = 1;
    if (linear) {
      const p = parseLinearPrelude(args[0]);
      if ("code" in p) fail(p);
      else {
        prelude = p;
        if (p.warning) warnings.push(p.warning);
      }
    }
  }
  if (!linear) {
    fail({ code: "unsupported-kind", reason: `${f.head.kind} gradients are found but not interpreted` });
  }

  const stops: Stop[] = [];
  const stopRanges: SourceRange[] = [];
  const argRanges: SourceRange[] = [];
  let colourStops = 0;
  let lastWasHint = true; // a hint may not come first

  for (let k = first; k < args.length; k++) {
    const tokens = args[k];
    if (tokens.length === 0) {
      fail({ code: "syntax", reason: "empty argument" });
      continue;
    }
    const range = span(tokens);
    const nums = tokens.filter((t) => t.type === "num");
    // A colour hint: a lone position between two stops.
    if (tokens.length === 1 && nums.length === 1) {
      if (lastWasHint || k === args.length - 1) fail({ code: "syntax", reason: "a colour hint must sit between two colour stops" });
      else if (linear) {
        const p = parsePosition(nums[0]);
        if (typeof p !== "number") fail(p);
        else warnings.push({ code: "color-hint-ignored", message: "colour hint (interpolation midpoint) is ignored", range });
      }
      lastWasHint = true;
      continue;
    }
    lastWasHint = false;
    colourStops++;
    argRanges.push(range);
    if (!linear) continue;

    // <color> && <position>{0,2}
    const head = tokens[0].type !== "num";
    const colour = head ? tokens[0] : tokens[tokens.length - 1];
    const rest = head ? tokens.slice(1) : tokens.slice(0, -1);
    if (tokens.length > 3) {
      // Name the cause when it is a dynamic function, else it is plain bad syntax.
      const dyn = tokens.find((t) => t.type === "fn" && dynamicFunctionCode(t.name) !== null);
      fail(
        dyn && dyn.type === "fn"
          ? { code: dynamicFunctionCode(dyn.name) as SkipCode, reason: `${dyn.name}() cannot be resolved statically` }
          : { code: "syntax", reason: "a colour stop is a colour and at most two positions" },
      );
      continue;
    }
    const parsed = parseColorToken(text, colour);
    if (!parsed.ok) {
      fail({ code: parsed.code, reason: parsed.reason });
      continue;
    }
    if (parsed.gamutMapped) {
      warnings.push({
        code: "gamut-mapped",
        message: `${text.slice(colour.start, colour.end)} is outside sRGB and was gamut-mapped to ${parsed.color}`,
        range: { start: colour.start, end: colour.end },
      });
    }
    const positions: number[] = [];
    let bad = false;
    for (const t of rest) {
      if (t.type === "num") {
        const p = parsePosition(t);
        if (typeof p === "number") {
          positions.push(p);
          continue;
        }
        fail(p);
      } else if (t.type === "fn" && dynamicFunctionCode(t.name)) {
        fail({ code: dynamicFunctionCode(t.name) as SkipCode, reason: `${t.name}() in a stop position cannot be resolved statically` });
      } else if (t.type === "interp") {
        fail({ code: "preprocessor", reason: "preprocessor variable or template expression in a stop position" });
      } else {
        fail({ code: "syntax", reason: "a colour stop is a colour and at most two positions" });
      }
      bad = true;
    }
    if (bad) continue;
    if (positions.some((p) => p < 0 || p > 1)) {
      warnings.push({ code: "position-out-of-range", message: "stop position outside 0%-100%", range });
    }
    for (let p = 0; p < Math.max(1, positions.length); p++) {
      const stop: Stop = { color: parsed.color };
      if (parsed.alpha < 1) stop.alpha = parsed.alpha;
      if (positions.length > 0) stop.position = positions[p];
      stops.push(stop);
      stopRanges.push(range);
    }
  }

  if (lastWasHint && colourStops > 0 && linear) fail({ code: "syntax", reason: "a colour hint must sit between two colour stops" });
  if (colourStops === 0) fail({ code: "syntax", reason: "no colour stops" });
  if (stops.length > maxStops) {
    fail({ code: "too-many-stops", reason: `${stops.length} stops; at most ${maxStops} are supported` });
  }

  if (state.skip) return skippedResult(f, f.end, state.skip, argRanges);

  const document: GradientDocument = { kind: "linear", angle: prelude.angle, stops };
  if (f.head.repeating) document.repeating = true;
  if (prelude.interpolation) document.interpolation = prelude.interpolation;
  const g: ParsedGradient = {
    range: { start: f.head.start, end: f.end },
    kind: "linear",
    repeating: f.head.repeating,
    document,
    stopRanges,
    warnings,
  };
  if (prelude.angleRange) g.angleRange = prelude.angleRange;
  return g;
}

/**
 * Find and parse every CSS gradient function in `css` (any text: CSS, SCSS,
 * JS/TS, HTML, Markdown). Never throws; linear in the input length.
 */
export function parseGradient(css: string, opts: ParseOptions = {}): ParseResult {
  if (typeof css !== "string") return { gradients: [] };
  const pos = (v: unknown, d: number): number => (typeof v === "number" && v >= 0 ? Math.floor(v) : d);
  const maxStops = pos(opts?.maxStops, DEFAULT_MAX_STOPS);
  const maxLength = pos(opts?.maxLength, DEFAULT_MAX_LENGTH);
  const maxInput = pos(opts?.maxInputLength, DEFAULT_MAX_INPUT);
  const limit = Math.min(css.length, maxInput);

  const gradients = scan(css, limit).map((f) => build(css, f, maxStops, maxLength));
  gradients.sort((a, b) => a.range.start - b.range.start);
  const result: ParseResult = { gradients };
  if (limit < css.length) result.truncated = true;
  return result;
}
