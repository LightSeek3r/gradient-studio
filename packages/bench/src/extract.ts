// Gradient extraction from arbitrary model output.
//
// The CSS work is done by core's `parseGradient` (a scanner that finds gradient
// functions in any text: CSS, SCSS, JS/JSX strings, HTML, Markdown). This file
// adds what a model answer needs around it:
//
//  * JSON: valid JSON (whole answer or a ```json fence) is parsed and every
//    string value is scanned, so escapes are decoded exactly. Otherwise, if the
//    text carries JSON-style escapes (\" \n \uXXXX), a decoded copy is scanned
//    and used when it finds at least as many parseable gradients as the raw text.
//  * Tailwind arbitrary values: bg-[linear-gradient(to_right,#fff,#000)],
//    bg-[image:...], [background-image:...], v4 bg-linear-[25deg,red_5%,blue],
//    with variant prefixes (dark:, md:). `_` becomes a space, `\_` stays.
//  * Tailwind utilities: bg-gradient-to-<dir> (v3) and bg-linear-to-<dir> /
//    bg-linear-<angle> (v4) with from-/via-/to- colour and position tokens.
//    Colours that are resolvable without a palette: arbitrary values
//    (from-[#ff0000]), white, black, transparent, current. Palette colours
//    (indigo-500) resolve only when `tailwindPalette` is supplied; otherwise the
//    gradient is reported as skipped (`tailwind-palette-colour`), never guessed.
//  * Variables: a CSS custom property (--x) or SCSS variable ($x) defined
//    exactly once in the same segment with a literal colour is substituted
//    into gradients that use it. Defined more than once (dark-mode override,
//    reassignment) or not a literal colour: left as is, so the gradient is
//    reported skipped by the parser (`var`, `preprocessor`, ...).
//
// Counting rules (documented in docs/bench.md): identical gradients in one
// answer count once; `linear-gradient()` / `linear-gradient(...)` / `<angle>`
// placeholders in prose are ignored; vendor-prefixed gradients are reported as
// the parser reports them (skipped), not merged with their unprefixed twin.

import { parseCssColor, parseGradient, toCSS, type GradientDocument } from "@opal42/gradient";
import { MAX_OUTPUT_CHARS } from "./constants";

export type GradientForm = "css" | "tailwind-arbitrary" | "tailwind-utility";

export interface ExtractedGradient {
  form: GradientForm;
  /** The text the parser saw (synthesised `linear-gradient(...)` for Tailwind utilities). */
  css: string;
  document: GradientDocument | null;
  skipped?: { code: string; reason: string };
  /** Parser warning codes (e.g. `corner-angle`, `color-hint-ignored`). */
  warnings: string[];
}

export interface Extraction {
  gradients: ExtractedGradient[];
  /** Gradients dropped because an identical one was already counted. */
  duplicatesDropped: number;
  /** Machine-readable remarks: `json`, `json-unescaped`, `truncated`, `placeholders-ignored:N`, `substituted:--x`. */
  notes: string[];
}

export interface ExtractOptions {
  /** Tailwind palette: class colour name ("indigo-500") to a CSS colour ("#6366f1"). */
  tailwindPalette?: Readonly<Record<string, string>>;
}

interface Found {
  at: number;
  g: ExtractedGradient;
}

type Parsed = ReturnType<typeof parseGradient>["gradients"][number];

// ── helpers ─────────────────────────────────────────────────────────────

function fromParsed(p: Parsed, css: string, form: GradientForm): ExtractedGradient {
  const g: ExtractedGradient = { form, css, document: p.document, warnings: p.warnings.map((w) => w.code) };
  if (p.skipped) g.skipped = { code: p.skipped.code, reason: p.skipped.reason };
  return g;
}

function skippedGradient(form: GradientForm, css: string, code: string, reason: string): ExtractedGradient {
  return { form, css, document: null, skipped: { code, reason }, warnings: [] };
}

/** Whitespace-collapsed, lower-case text: the identity of a skipped gradient. */
function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function blank(text: string, start: number, end: number): string {
  return text.slice(0, start) + text.slice(start, end).replace(/[^\n]/g, " ") + text.slice(end);
}

function isPlaceholder(css: string): boolean {
  const open = css.indexOf("(");
  const close = css.lastIndexOf(")");
  const args = (close > open ? css.slice(open + 1, close) : css.slice(open + 1)).trim();
  if (args === "" || /^(\.{2,}|…)$/.test(args)) return true;
  // <angle>, <color-stop-list> ... : documentation placeholders
  if (/^<[^<>]*>(\s*,\s*(<[^<>]*>|\.{2,}|…))*$/.test(args)) return true;
  return false;
}

// ── JSON ────────────────────────────────────────────────────────────────

function collectStrings(v: unknown, out: string[], depth = 0): void {
  if (out.length > 5000 || depth > 50) return;
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out, depth + 1);
  else if (v !== null && typeof v === "object") for (const x of Object.values(v)) collectStrings(x, out, depth + 1);
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function unescapeJsonLike(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|[nrt"\\/])/g, (_m, c: string) => {
    if (c.startsWith("u")) return String.fromCharCode(parseInt(c.slice(1), 16));
    switch (c) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      default:
        return c;
    }
  });
}

// ── variable substitution ───────────────────────────────────────────────

function substituteVariables(text: string, notes: string[]): string {
  const defs = new Map<string, { count: number; value: string }>();
  const note = (name: string, value: string) => {
    const d = defs.get(name);
    if (d) d.count++;
    else defs.set(name, { count: 1, value });
  };
  for (const m of text.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;{}\n]*)/g)) note(m[1]!, m[2]!.trim());
  for (const m of text.matchAll(/\$([A-Za-z_][\w-]*)\s*:\s*([^;\n]*)/g)) note("$" + m[1]!, m[2]!.replace(/!default|!global/g, "").trim());
  let out = text;
  for (const [name, d] of defs) {
    if (d.count !== 1 || d.value === "" || !parseCssColor(d.value)) continue;
    const before = out;
    if (name.startsWith("--")) {
      const esc = name.replace(/[-]/g, "\\-");
      out = out.replace(new RegExp(`var\\(\\s*${esc}\\s*(?:,[^()]*)?\\)`, "g"), d.value);
    } else {
      const esc = name.slice(1).replace(/[-]/g, "\\-");
      out = out.replace(new RegExp(`\\$${esc}(?![\\w-])`, "g"), d.value);
    }
    if (out !== before) notes.push(`substituted:${name}`);
  }
  return out;
}

// ── Tailwind ────────────────────────────────────────────────────────────

const DIRS: Record<string, string> = { t: "top", tr: "top right", r: "right", br: "bottom right", b: "bottom", bl: "bottom left", l: "left", tl: "top left" };

function twUnderscores(s: string): string {
  return s.replace(/\\_/g, "\uE000").replace(/_/g, " ").replace(/\uE000/g, "_");
}

const ARB_START = /(?<![\w-])((?:[\w-]+:)*)(?:bg-(linear-)?\[|\[background-image:)/g;

function scanTailwindArbitrary(text: string): { found: Found[]; rest: string } {
  const found: Found[] = [];
  let rest = text;
  for (const m of text.matchAll(ARB_START)) {
    const start = m.index!;
    const bracket = start + m[0].length;
    let depth = 1;
    let i = bracket;
    for (; i < text.length; i++) {
      const c = text[i]!;
      if (/[\s"'`<>]/.test(c)) break;
      if (c === "[") depth++;
      else if (c === "]" && --depth === 0) break;
    }
    if (depth !== 0) continue; // unterminated: leave it to the plain scanner
    let inner = twUnderscores(text.slice(bracket, i));
    inner = inner.replace(/^(?:image|url|bg-image):/, "");
    const linearArg = m[2] !== undefined;
    const css = linearArg ? `linear-gradient(${inner})` : inner;
    if (!/gradient\(/i.test(css)) continue;
    rest = blank(rest, start, i + 1);
    for (const p of parseGradient(css).gradients) {
      const sub = css.slice(p.range.start, p.range.end);
      if (p.skipped?.code !== "unbalanced" && isPlaceholder(sub)) continue;
      found.push({ at: start, g: fromParsed(p, sub, "tailwind-arbitrary") });
    }
  }
  return { found, rest };
}

interface TwGroup {
  dir?: string;
  mod?: string;
  kind?: "linear" | "radial" | "conic";
  colors: Partial<Record<"from" | "via" | "to", string>>;
  positions: Partial<Record<"from" | "via" | "to", string>>;
  unresolved: string[];
  raw: string[];
}

const DIR_TOKEN = /^((?:[\w-]+:)*)!?(-?)bg-(?:gradient-to-|linear-to-)(tr|tl|br|bl|t|r|b|l)(?:\/([a-z]+))?$/;
const ANGLE_TOKEN = /^((?:[\w-]+:)*)!?(-?)bg-linear-(\d+(?:\.\d+)?)(?:\/([a-z]+))?$/;
const OTHER_KIND_TOKEN = /^((?:[\w-]+:)*)!?bg-(radial|conic)(?:-[^\s]*)?(?:\/[a-z]+)?$/;
const STOP_TOKEN = /^((?:[\w-]+:)*)!?(from|via|to)-(.+)$/;

function interpolationOf(mod: string | undefined): string {
  if (!mod) return "";
  if (/^(srgb|oklab|oklch|hsl|hwb|lab|lch)$/.test(mod)) return ` in ${mod}`;
  if (/^(longer|shorter|increasing|decreasing)$/.test(mod)) return ` in oklch ${mod} hue`;
  return "";
}

function resolveTwColor(raw: string, palette: Readonly<Record<string, string>> | undefined): { css: string } | { unresolved: string } {
  let name = raw;
  let modPart: string | null = null;
  if (name.startsWith("[")) {
    const close = name.indexOf("]");
    if (close > 0 && name[close + 1] === "/") {
      modPart = name.slice(close + 2);
      name = name.slice(0, close + 1);
    }
  } else {
    const slash = name.lastIndexOf("/");
    if (slash > 0) {
      modPart = name.slice(slash + 1);
      name = name.slice(0, slash);
    }
  }
  let alpha: number | null = null;
  if (modPart !== null) {
    const pct = /^(\d+(?:\.\d+)?)$/.exec(modPart);
    const arb = /^\[(\d*\.?\d+)\]$/.exec(modPart);
    alpha = pct ? Number(pct[1]) / 100 : arb ? Number(arb[1]) : null;
    if (alpha === null || !(alpha >= 0 && alpha <= 1)) return { unresolved: raw };
  }
  let base: string | null = null;
  if (name.startsWith("[") && name.endsWith("]")) {
    base = twUnderscores(name.slice(1, -1)).replace(/^color:/, "");
  } else if (name === "white") base = "#ffffff";
  else if (name === "black") base = "#000000";
  else if (name === "transparent") base = "transparent";
  else if (name === "current") base = "currentColor";
  else if (palette && Object.prototype.hasOwnProperty.call(palette, name)) base = palette[name]!;
  if (base === null || base === "") return { unresolved: raw };
  if (alpha === null) return { css: base };
  const c = parseCssColor(base);
  if (!c) return { unresolved: raw };
  const n = parseInt(c.color.slice(1), 16);
  return { css: `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${alpha})` };
}

function groupTokens(tokens: string[], palette: Readonly<Record<string, string>> | undefined): { groups: Map<string, TwGroup>; ambiguous: boolean } {
  const groups = new Map<string, TwGroup>();
  let ambiguous = false;
  const get = (variant: string): TwGroup => {
    let g = groups.get(variant);
    if (!g) groups.set(variant, (g = { colors: {}, positions: {}, unresolved: [], raw: [] }));
    return g;
  };
  for (const t of tokens) {
    let m = DIR_TOKEN.exec(t);
    if (m) {
      const g = get(m[1]!);
      if (g.dir !== undefined || g.kind) ambiguous = true;
      g.raw.push(t);
      g.kind = "linear";
      g.dir = `to ${DIRS[m[3]!]}`;
      g.mod = m[4];
      continue;
    }
    m = ANGLE_TOKEN.exec(t);
    if (m) {
      const g = get(m[1]!);
      if (g.dir !== undefined || g.kind) ambiguous = true;
      g.raw.push(t);
      g.kind = "linear";
      g.dir = `${m[2]}${m[3]}deg`;
      g.mod = m[4];
      continue;
    }
    m = OTHER_KIND_TOKEN.exec(t);
    if (m) {
      const g = get(m[1]!);
      if (g.kind) ambiguous = true;
      g.raw.push(t);
      g.kind = m[2] as "radial" | "conic";
      continue;
    }
    m = STOP_TOKEN.exec(t);
    if (m) {
      const which = m[2] as "from" | "via" | "to";
      const value = m[3]!;
      // Only tokens that are plausibly Tailwind: skip things like "from-the-start".
      const pos = /^\[?(-?\d+(?:\.\d+)?%)\]?$/.exec(value) ?? /^\[percentage:(-?\d+(?:\.\d+)?%)\]$/.exec(value);
      const variant = m[1]!;
      if (pos) {
        get(variant).positions[which] = pos[1]!;
        get(variant).raw.push(t);
        continue;
      }
      if (/^\[(?:length|position):/.test(value) || /^\[?-?\d+(?:\.\d+)?(?:px|rem|em|vh|vw)\]?$/.test(value)) {
        get(variant).unresolved.push(`${which}-${value}`);
        get(variant).raw.push(t);
        continue;
      }
      if (value.startsWith("(")) {
        get(variant).unresolved.push(`${which}-${value}`);
        get(variant).raw.push(t);
        continue;
      }
      const looksColor = value.startsWith("[") || /^(white|black|transparent|current|inherit)$/.test(value) || /^[a-z]+(-[a-z]+)*-\d{2,3}(\/.+)?$/.test(value) || (palette !== undefined && Object.prototype.hasOwnProperty.call(palette, value.split("/")[0]!));
      if (!looksColor) continue;
      const r = resolveTwColor(value, palette);
      const g = get(variant);
      g.raw.push(t);
      if ("css" in r) g.colors[which] = r.css;
      else g.unresolved.push(`${which}-${value}`);
    }
  }
  return { groups, ambiguous };
}

function buildUtilityGradients(groups: Map<string, TwGroup>): ExtractedGradient[] {
  const out: ExtractedGradient[] = [];
  const base = groups.get("");
  for (const [variant, raw] of groups) {
    let g = raw;
    const hasStops = Object.keys(g.colors).length > 0 || g.unresolved.length > 0;
    if (variant !== "" && g.kind === undefined) {
      if (!base || base.kind === undefined || !hasStops) continue;
      g = {
        kind: base.kind,
        dir: base.dir,
        mod: base.mod,
        colors: { ...base.colors, ...g.colors },
        positions: { ...base.positions, ...g.positions },
        unresolved: [...g.unresolved],
        raw: [...base.raw, ...g.raw],
      };
    }
    if (g.kind === undefined) continue;
    const label = `${variant}${g.kind === "linear" ? "bg-linear" : "bg-" + g.kind}`;
    if (g.kind !== "linear") {
      out.push(skippedGradient("tailwind-utility", label, "unsupported-kind", `${g.kind} gradients are not scored`));
      continue;
    }
    if (!hasStops && Object.keys(g.colors).length === 0) continue;
    const css0 = g.raw.join(" ");
    if (g.unresolved.length) {
      const palette = g.unresolved.every((u) => /-[a-z]+(-[a-z]+)*-\d{2,3}/.test(u) || /-(inherit)$/.test(u));
      out.push(
        skippedGradient(
          "tailwind-utility",
          css0,
          palette ? "tailwind-palette-colour" : "tailwind-unresolved",
          palette ? `colour class(es) ${g.unresolved.join(", ")} need a Tailwind palette (pass tailwindPalette); not guessed` : `could not resolve ${g.unresolved.join(", ")}`,
        ),
      );
      continue;
    }
    if (!g.colors.from || !g.colors.to) {
      out.push(skippedGradient("tailwind-utility", css0, "tailwind-incomplete", "a Tailwind gradient needs both from-* and to-* colours; one-sided gradients fade from/to transparent and are not scored"));
      continue;
    }
    const stops = (["from", "via", "to"] as const)
      .filter((k) => g.colors[k] !== undefined)
      .map((k) => `${g.colors[k]}${g.positions[k] ? " " + g.positions[k] : ""}`);
    const head = `${g.dir ?? ""}${interpolationOf(g.mod)}`.trim();
    const css = `linear-gradient(${head ? head + ", " : ""}${stops.join(", ")})`;
    const parsed = parseGradient(css).gradients[0];
    if (parsed) out.push(fromParsed(parsed, css, "tailwind-utility"));
  }
  return out;
}

function scanTailwindUtilities(text: string, palette: Readonly<Record<string, string>> | undefined): Found[] {
  const found: Found[] = [];
  if (!/bg-(?:gradient-to-|linear-|radial|conic)/.test(text)) return found;
  let offset = 0;
  const handle = (piece: string, at: number) => {
    const tokens = piece.split(/\s+/).filter(Boolean);
    if (!tokens.some((t) => /bg-(gradient-to-|linear-|radial|conic)/.test(t))) return;
    const { groups, ambiguous } = groupTokens(tokens, palette);
    if (ambiguous && piece.includes("\n")) {
      let o = 0;
      for (const line of piece.split("\n")) {
        handle(line, at + o);
        o += line.length + 1;
      }
      return;
    }
    for (const g of buildUtilityGradients(groups)) found.push({ at, g });
  };
  for (const piece of text.split(/["'`]/)) {
    handle(piece, offset);
    offset += piece.length + 1;
  }
  return found;
}

// ── segment scan ────────────────────────────────────────────────────────

function scanSegment(seg: string, opts: ExtractOptions, notes: string[]): Found[] {
  const arb = scanTailwindArbitrary(seg);
  const substituted = substituteVariables(arb.rest, notes);
  const found: Found[] = [...arb.found];
  let placeholders = 0;
  for (const p of parseGradient(substituted).gradients) {
    const css = substituted.slice(p.range.start, p.range.end);
    if (p.skipped?.code !== "unbalanced" && isPlaceholder(css)) {
      placeholders++;
      continue;
    }
    found.push({ at: p.range.start, g: fromParsed(p, css, "css") });
  }
  if (placeholders) notes.push(`placeholders-ignored:${placeholders}`);
  found.push(...scanTailwindUtilities(arb.rest, opts.tailwindPalette));
  return found.sort((a, b) => a.at - b.at);
}

function identity(g: ExtractedGradient): string {
  if (g.document) {
    const css = toCSS({ ...g.document, interpolation: undefined });
    if (css) return "ok:" + css;
  }
  return `skip:${g.skipped?.code ?? "?"}:${squash(g.css)}`;
}

/** Pulls every gradient out of a model answer. Never throws. */
export function extractGradients(output: unknown, opts: ExtractOptions = {}): Extraction {
  const notes: string[] = [];
  try {
    return extractInner(typeof output === "string" ? output : "", opts, notes);
  } catch (e) {
    return { gradients: [], duplicatesDropped: 0, notes: [...notes, `extractor-error:${e instanceof Error ? e.message : String(e)}`] };
  }
}

function extractInner(input: string, opts: ExtractOptions, notes: string[]): Extraction {
  let text = input;
  if (text.length > MAX_OUTPUT_CHARS) {
    text = text.slice(0, MAX_OUTPUT_CHARS);
    notes.push("truncated");
  }
  const segments: string[] = [];
  const whole = /^\s*[[{]/.test(text) ? tryJson(text) : undefined;
  if (whole !== undefined && whole !== null && typeof whole === "object") {
    notes.push("json");
    collectStrings(whole, segments);
  } else {
    // ```json fences: parse them for exact decoding, scan the rest as text.
    text = text.replace(/(```[ \t]*(?:json|jsonc|json5)[^\n]*\n)([\s\S]*?)(```)/gi, (m: string, open: string, body: string, close: string) => {
      const v = tryJson(body);
      if (v === undefined || v === null || typeof v !== "object") return m;
      if (!notes.includes("json")) notes.push("json");
      collectStrings(v, segments);
      return open + body.replace(/[^\n]/g, " ") + close;
    });
    let main = text;
    if (/\\(?:u[0-9a-fA-F]{4}|["nrt\\/])/.test(text)) {
      const decoded = unescapeJsonLike(text);
      const count = (s: string) => scanSegment(s, opts, []).filter((f) => f.g.document !== null).length;
      if (count(decoded) >= count(text)) {
        main = decoded;
        notes.push("json-unescaped");
      }
    }
    segments.unshift(main);
  }
  const all: Found[] = [];
  for (const s of segments) all.push(...scanSegment(s, opts, notes));
  const seen = new Set<string>();
  const gradients: ExtractedGradient[] = [];
  let duplicatesDropped = 0;
  for (const f of all) {
    const key = identity(f.g);
    if (seen.has(key)) {
      duplicatesDropped++;
      continue;
    }
    seen.add(key);
    gradients.push(f.g);
  }
  return { gradients, duplicatesDropped, notes: [...new Set(notes)].sort() };
}
