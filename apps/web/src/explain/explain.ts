// ── Plain-language text per finding code ──────────────────────────────────────
// The single source of the words the UI uses for a rule of scoring model v1
// (spec/scoring-v1.md): its short name in the points ledger and one sentence
// on what it measures. tests/explain.test.ts fails when a code of the model
// has no entry here (or an entry names a code the model does not have).
//
// Wording follows PLAN D5: these describe what the smoothness score measures,
// by our definition. They are not verdicts on a gradient's quality.

export interface RuleText {
  /** Short lower-case name used in the ledger: "100 − 12 lightness reversal". */
  name: string;
  /** One plain sentence: what the rule measures. */
  measures: string;
}

export const RULE_TEXT: Readonly<Record<string, RuleText>> = {
  "lightness/reversal": {
    name: "lightness reversal",
    measures:
      "Counts stops that are darker, or lighter, than both of their neighbours, so the gradient brightens and dims instead of moving one way.",
  },
  "lightness/perceived-reversal": {
    name: "apparent lightness wobble",
    measures:
      "Looks for a stop so vivid that it appears brighter than both neighbours, even though its measured lightness is in order.",
  },
  "lightness/low-contrast": {
    name: "low contrast",
    measures: "Measures the largest colour difference between any two stops; when it is tiny the gradient reads as a flat fill.",
  },
  "lightness/abrupt-jump": {
    name: "abrupt jump",
    measures: "Looks for a large colour change squeezed between two stops that sit 10% apart or less, which shows as an edge.",
  },
  "lightness/uneven-speed": {
    name: "uneven speed",
    measures:
      "Compares how fast the colour changes in each segment; a big spread means the gradient rushes in one place and stalls in another.",
  },
  "hue/wide-arc": {
    name: "wide hue arc",
    measures:
      "Measures the smallest arc of the colour wheel that holds every coloured stop; past 120° the colours in between tend to turn grey.",
  },
  "hue/narrow-arc": {
    name: "single hue",
    measures: "Measures the same arc of the colour wheel; under 15° every stop has practically the same hue.",
  },
  "hue/direction-reversal": {
    name: "hue changes direction",
    measures: "Follows the hue from stop to stop and notes where it turns back around the colour wheel.",
  },
  "chroma/saturation-range": {
    name: "saturation range",
    measures: "Compares the most and the least saturated stop; a large difference reads as a spike or a washed-out end.",
  },
  "chroma/dead-zone": {
    name: "grey among vivid colours",
    measures: "Looks for a nearly grey stop in a gradient that also has vivid stops, which leaves a colourless zone.",
  },
  "chroma/muddy-midpoint": {
    name: "muddy midpoint",
    measures:
      "Checks the colour a browser paints halfway between two stops (it mixes in sRGB) and how much saturation is lost there.",
  },
  "chroma/banding": {
    name: "banding risk",
    measures:
      "Counts the 8-bit colour steps available across a segment; too few over a long distance can show as visible bands.",
  },
  "rhythm/edge-gap": {
    name: "stops short of the edges",
    measures: "Adds up the part of the gradient before the first stop and after the last one, which is painted as flat colour.",
  },
  "rhythm/narrow-span": {
    name: "narrow transition",
    measures: "Measures the distance from the first stop to the last; the whole transition is packed into that span.",
  },
  "rhythm/uneven-gaps": {
    name: "uneven spacing",
    measures: "Compares the gaps between neighbouring stops; very different gaps make the gradient feel clustered.",
  },
};

const FALLBACK: RuleText = { name: "deduction", measures: "A deduction of the smoothness score." };

/** The text for a code; an unknown code gets a neutral fallback built from the code itself. */
export function ruleText(code: string): RuleText {
  const known = Object.prototype.hasOwnProperty.call(RULE_TEXT, code) ? RULE_TEXT[code] : undefined;
  if (known) return known;
  const tail = typeof code === "string" ? code.split("/").pop()?.replace(/-/g, " ") : "";
  return tail ? { ...FALLBACK, name: tail } : FALLBACK;
}

/** Display names and budgets of the four dimensions, in ledger order. */
export const DIMENSIONS = [
  { key: "lightness", label: "Lightness flow" },
  { key: "hue", label: "Hue arc" },
  { key: "chroma", label: "Chroma balance" },
  { key: "rhythm", label: "Stop rhythm" },
] as const;

export type DimensionKey = (typeof DIMENSIONS)[number]["key"];

/** Spoken size of a deduction (severity follows the penalty: 12+, 6-10, 5 or fewer). */
export const SEVERITY_LABEL: Readonly<Record<"error" | "warning" | "info", string>> = {
  error: "large deduction",
  warning: "medium deduction",
  info: "small deduction",
};
