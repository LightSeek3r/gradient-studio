// ── Built-in English text ──────────────────────────────────────────────────────
// A small table keyed by stable ids, so the element never depends on the web
// app's source (apps/web has its own, translated catalogue; this one is the
// element's own English default). Hosts can replace any entry, for another
// language or other words, through the `messages` property or attribute.
//
// Wording follows PLAN D5: the number is a smoothness score by our definition,
// not a quality verdict. The rule sentences describe what a rule measures; none
// of them says a gradient is good or bad.

export type Messages = Readonly<Record<string, string>>;

export const DEFAULT_MESSAGES: Messages = Object.freeze({
  "label.default": "Gradient",
  "group.ok": "{label}: smoothness score {score} out of 100",
  "group.skipped": "{label}: found, not scored",
  "group.empty": "{label}: no gradient",
  "group.invalid": "{label}: no gradient found",
  "score.name": "Smoothness score",
  "score.outOf": "out of 100",
  "score.none": "Not scored",
  "live.ok": "Smoothness score {score} out of 100. {count}.",
  "live.skipped": "Gradient not scored. {reason}",
  "live.empty": "No gradient to score.",
  "live.invalid": "{message}",
  "count.one": "1 finding",
  "count.other": "{n} findings",
  "issues.summary": "Findings ({n})",
  "issues.none": "No findings: no points were deducted.",
  "issue.points": "−{n} pt",
  "severity.error": "large deduction",
  "severity.warning": "medium deduction",
  "severity.info": "small deduction",
  "skipped.title": "Why there is no score",
  "skipped.intro": "This gradient was found, but the smoothness score does not cover it.",
  "fix.title": "Suggested fix",
  "fix.gain": "+{n} points ({before} to {after})",
  "fix.note": "A preview only. Nothing is changed.",
  "fix.none": "No targeted fix is available for these findings.",
  "fix.swatch": "Gradient swatch after the suggested fix",
  "empty": "No gradient to score.",
  "invalid.no-gradient": "No linear-gradient() was found in this text.",
  "invalid.index-out-of-range": "There is no gradient number {index} in this text ({count} found, counting from 0).",
  "invalid.internal": "This text could not be analysed.",
  "truncated": "The input is longer than 20 KB. Only the first 20 KB were read.",
  "multi": "Showing gradient {n} of {count} found in this text.",
  "swatch.label": "Gradient swatch from {first} to {last}, {count} colour stops",
  "preview.label": "Gradient preview from {first} to {last}",
  "preview.none": "Gradient preview unavailable",

  // One name and one sentence per finding code of scoring model v1.
  "rule.lightness/reversal.name": "lightness reversal",
  "rule.lightness/reversal.measures":
    "Counts stops that are darker, or lighter, than both of their neighbours, so the gradient brightens and dims instead of moving one way.",
  "rule.lightness/perceived-reversal.name": "apparent lightness wobble",
  "rule.lightness/perceived-reversal.measures":
    "Looks for a stop so vivid that it appears brighter than both neighbours, even though its measured lightness is in order.",
  "rule.lightness/low-contrast.name": "low contrast",
  "rule.lightness/low-contrast.measures":
    "Measures the largest colour difference between any two stops; when it is tiny the gradient reads as a flat fill.",
  "rule.lightness/abrupt-jump.name": "abrupt jump",
  "rule.lightness/abrupt-jump.measures":
    "Looks for a large colour change squeezed between two stops that sit 10% apart or less, which shows as an edge.",
  "rule.lightness/uneven-speed.name": "uneven speed",
  "rule.lightness/uneven-speed.measures":
    "Compares how fast the colour changes in each segment; a big spread means the gradient rushes in one place and stalls in another.",
  "rule.hue/wide-arc.name": "wide hue arc",
  "rule.hue/wide-arc.measures":
    "Measures the smallest arc of the colour wheel that holds every coloured stop; past 120° the colours in between tend to turn grey.",
  "rule.hue/narrow-arc.name": "single hue",
  "rule.hue/narrow-arc.measures":
    "Measures the same arc of the colour wheel; under 15° every stop has practically the same hue.",
  "rule.hue/direction-reversal.name": "hue changes direction",
  "rule.hue/direction-reversal.measures": "Follows the hue from stop to stop and notes where it turns back around the colour wheel.",
  "rule.chroma/saturation-range.name": "saturation range",
  "rule.chroma/saturation-range.measures":
    "Compares the most and the least saturated stop; a large difference reads as a spike or a washed-out end.",
  "rule.chroma/dead-zone.name": "grey among vivid colours",
  "rule.chroma/dead-zone.measures": "Looks for a nearly grey stop in a gradient that also has vivid stops, which leaves a colourless zone.",
  "rule.chroma/muddy-midpoint.name": "muddy midpoint",
  "rule.chroma/muddy-midpoint.measures":
    "Checks the colour a browser paints halfway between two stops (it mixes in sRGB) and how much saturation is lost there.",
  "rule.chroma/banding.name": "banding risk",
  "rule.chroma/banding.measures":
    "Counts the 8-bit colour steps available across a segment; too few over a long distance can show as visible bands.",
  "rule.rhythm/edge-gap.name": "stops short of the edges",
  "rule.rhythm/edge-gap.measures":
    "Adds up the part of the gradient before the first stop and after the last one, which is painted as flat colour.",
  "rule.rhythm/narrow-span.name": "narrow transition",
  "rule.rhythm/narrow-span.measures":
    "Measures the distance from the first stop to the last; the whole transition is packed into that span.",
  "rule.rhythm/uneven-gaps.name": "uneven spacing",
  "rule.rhythm/uneven-gaps.measures":
    "Compares the gaps between neighbouring stops; very different gaps make the gradient feel clustered.",
});

export interface Translate {
  (key: string, params?: Record<string, string | number>): string;
  /** True when the key has a built-in or host-supplied entry. */
  has(key: string): boolean;
}

/** Plain-object check; the only values a host may supply are strings. */
function stringEntries(custom: unknown): [string, string][] {
  if (typeof custom !== "object" || custom === null || Array.isArray(custom)) return [];
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(custom)) {
    if (typeof v === "string" && v.length <= 2000 && k.length <= 120) out.push([k, v]);
  }
  return out;
}

/** Parses the `messages` attribute (a JSON object of strings). Never throws; bad input gives `null`. */
export function parseMessagesJson(text: string | null): Record<string, string> | null {
  if (!text || text.length > 20_000) return null;
  try {
    const entries = stringEntries(JSON.parse(text));
    return entries.length ? Object.fromEntries(entries) : null;
  } catch {
    return null;
  }
}

/**
 * Builds a translate function over the defaults plus `custom` (strings only,
 * others ignored). `{name}` placeholders are filled from `params`; an unknown
 * key falls back to the key's last segment so nothing renders as `undefined`.
 */
export function createTranslate(custom?: unknown): Translate {
  const table = new Map<string, string>(Object.entries(DEFAULT_MESSAGES));
  for (const [k, v] of stringEntries(custom)) table.set(k, v);
  const t = ((key: string, params?: Record<string, string | number>) => {
    const template = table.get(key);
    if (template === undefined) return key.split(/[./]/).pop() ?? key;
    return template.replace(/\{(\w+)\}/g, (m, name: string) => (params && Object.hasOwn(params, name) ? String(params[name]) : m));
  }) as Translate;
  t.has = (key) => table.has(key);
  return t;
}
