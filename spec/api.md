# Core API (Phase 1)

The document API of `@opal42/gradient` (working name), exported from
`packages/core/src/index.ts` next to the legacy engine functions. It adds no
scoring logic: `score` and `refine` call the frozen v1 engine
([`scoring-v1.md`](scoring-v1.md)); the vectors in `spec/vectors/` are
unchanged.

All functions are pure, deterministic, free of DOM/Node globals, and **never
throw on bad input**. A failure is a value: `null`, `[]`, `unscorable`,
`skipped` or `declined`. Never `NaN`, never a placeholder colour.

## Units

| Quantity | Unit |
|---|---|
| Stop position | 0-1 along the gradient line |
| Angle | CSS degrees: 0 = to top, 90 = to right, 180 = to bottom (default) |
| Alpha | 0-1; absent means 1 |
| Colour | lower-case `#rrggbb` (sRGB) |
| Issue segment | 0-1 |
| Source range | half-open UTF-16 code-unit offsets |

Percentages and 0-255 channels exist only inside CSS text. (The legacy engine
functions keep their own units: positions 0-100.)

## Types

```ts
interface Stop { color: string; alpha?: number; position?: number; id?: string }

interface GradientDocument {
  kind: "linear";
  angle: number;
  stops: Stop[];                 // CSS source order = paint order
  repeating?: boolean;
  interpolation?: { space: "srgb" | "oklab" | "oklch"; hue?: "shorter" | "longer" | "increasing" | "decreasing" };
}

interface Issue {
  code: string;                  // v1 finding code, e.g. "lightness/reversal"
  severity: "error" | "warning" | "info";
  dimension: "lightness" | "chroma" | "hue" | "spacing";
  pointsLost: number;
  stopIndices?: number[];        // into document.stops
  segment?: { start: number; end: number };
  range?: { start: number; end: number };   // set by scoreParsed only
  message: string;
}

type ScoreResult =
  | { status: "ok"; score: number; dimensions: Record<Issue["dimension"], number>;
      issues: Issue[]; scoringModel: "v1"; analysis: { hasHardStops: boolean } }
  | { status: "unscorable"; code: string; reason: string };
```

`dimension: "spacing"` is what v1 finding codes call `rhythm` (the codes keep
their `rhythm/…` prefix). Parser types are in [`parser.md`](parser.md).

## Functions

### `parseGradient(css, opts?) → ParseResult`

See [`parser.md`](parser.md).

### `resolveStops(doc) → ResolvedStop[]`

Fills in missing positions exactly as CSS does: a missing first position is 0
and a missing last one is 1; a position lower than an earlier one is raised to
the largest earlier position; runs of missing positions are spaced evenly
between their neighbours. Order is kept. A non-finite position counts as
missing. Returns `[]` for something that is not a document.

### `score(doc, opts?) → ScoreResult`

Resolves positions, converts to the engine's units and calls `scoreGradient`.
`opts.scoringModel` may only be `"v1"`.

Unscorable (never a number) with these codes:

| Code | When |
|---|---|
| `invalid-document` | Not an object with a `stops` array of objects. |
| `unsupported-kind` | `kind` is not `"linear"`. |
| `unsupported-model` | A scoring model other than v1 was asked for. |
| `repeating` | `repeating: true`. |
| `too-few-stops` | Fewer than two stops. |
| `invalid-color` | A colour that is not `#rrggbb`. |
| `invalid-alpha` | An alpha that is not a number in 0-1. |
| `alpha` | Any stop with alpha below 1. v1 judges opaque stops only. |
| `invalid-position` | A position that is present but not a finite number. |
| `position-range` | A resolved position outside 0-1. |

Notes:

- Because resolved positions never decrease, issue `stopIndices` are indices
  into `doc.stops`. Stops are **not sorted**: an out-of-order position is
  raised as CSS does, so the result depends on stop order exactly as the
  rendering does.
- Positions are rounded to 10 decimals of a percent before reaching the engine,
  so a document parsed from `30%` scores exactly like the engine's `30`.
- `doc.interpolation` and `doc.angle` do not affect a v1 score. v1 measures the
  stops, not the rendered path.
- **Hard stops.** v1 numbers are not adjusted for stripes. `analysis.hasHardStops`
  is true when two neighbouring stops share a position but not a colour, so
  callers (lint rules, the UI) can decide to skip or relabel such gradients.

### `scoreParsed(parsed, opts?) → ScoreResult`

Scores one `ParsedGradient`. A skipped gradient is unscorable with the parser's
skip code and reason. Each issue gets `range`: from the start of its first
offending stop to the end of its last one, or the whole gradient when the issue
names no stops.

### `refine(doc) → { document, refined, before, after, declined? }`

Wraps `refineGradient`. Guarantees: the score never goes down, hard stops stay
together, achromatic stops stay achromatic. The refined document has explicit
positions, keeps `angle`, `interpolation` and stop `id`s. When it declines
(`declined.code`: `unscorable`, `single-position`, `would-lower-score`) the
input document itself is returned and `after` equals `before`.

### `proposeFixes(doc | ticks) → Fix[]`

Targeted alternatives to the all-or-nothing `refine`: at most **one fix per
finding**, in the order of the findings.

```ts
interface Fix<T = GradientDocument> {
  code: string;            // the finding it removes, e.g. "lightness/reversal"
  label: string;           // "Make stop 2 lighter" (stop numbers are 1-based, in position order)
  kind: "lightness" | "hue" | "chroma" | "position" | "mixed";
  gain: number;            // after.score − before.score, always > 0
  before: ScoreResult;
  after: ScoreResult;
  document: T;             // the input with the fix applied
  changedStops: number[];  // indices into the input's stops
}
```

Accepts a `GradientDocument` or the engine's `GradientTick[]` (positions 0–100,
any array order); `document` has the shape that was passed in. For ticks,
`before`/`after` describe the position-sorted stops.

**How.** For each finding a fixed list of candidate edits is generated on the
stops the finding names (`stops`, plus the stops lying on its `segment`):
lightness, hue, chroma or position of one stop, of all the named stops
together, and the one-click refinement restricted to those stops. Every
candidate is re-scored by the v1 engine. Among the candidates that satisfy the
contract, the one with the smallest change (OKLAB ΔE plus position shift) that
recovers at least the finding's `pointsLost` wins (or, when none recovers that
much, the most any candidate recovers). There is no scoring logic in
`proposeFixes`; a finding with no acceptable candidate has no fix.

**Contract** (checked over every input of `spec/vectors/v1-score.json`):

- the total score strictly increases; a fix with `gain ≤ 0` is never returned;
- the targeted finding is gone from `after`;
- no finding becomes more severe, and a finding that was not there before is
  never more severe than the one that was fixed;
- only stops the finding names are edited; untouched stops are the input's own
  objects; stop count, order and `id`s do not change;
- hard stops stay hard: a stop within `V1_MODEL.refine.hardStopGap` of a
  neighbour is never moved, and a moved stop never lands that close to one;
- achromatic stops (`C ≤ V1_MODEL.refine.achromaticAtMost`) stay achromatic;
- pure and deterministic; never throws. Unscorable or malformed input and
  gradients without findings give `[]`.

Notes: `gain` can differ from the finding's `pointsLost` (the edit may remove
or add another finding, and a clamped dimension absorbs penalties — a finding
in a dimension that stays at 0 has no fix). Removing a finding outright can
need a large edit (e.g. a hue arc above 180° must come down to 120°). A
document with automatic positions only gets colour fixes, since moving one
stop would move the stops spaced from it. New positions are whole percents.

### `toCSS(doc, opts?) → string | null`

`linear-gradient(<angle>deg[ in <space>[ <hue> hue]], <stops>)`, or
`repeating-linear-gradient(…)`. Opaque stops print as `#rrggbb`, translucent
ones as `rgb(r g b / a)`. Positions print as percentages with at most 4
decimals and are omitted when absent. Stops print in document order.
`in srgb` is the CSS default and is never printed; `shorter hue` likewise.
`opts.interpolation` overrides the document's. Returns `null` for an invalid
document. `parseGradient(toCSS(doc))` gives back `doc` (to the printed
precision).

No sRGB fallback is added (PLAN D9). For that:

### `toCSSWithFallback(doc, property = "background", steps = 16) → string | null`

Two declarations: a plain sRGB gradient pre-sampled along the target
interpolation (`bakeStops`), then the native `in oklab`/`in oklch` gradient.
The target is the document's interpolation, or OKLAB when it has none; a
document that asks for sRGB yields a single declaration. An unsafe property
name falls back to `background`.

### `sampleGradient(doc, t, opts?) → { color, alpha } | null`

The colour at `t` (0-1). Interpolates in **OKLAB by default** (not in the
document's own space; pass `opts.interpolation` for `srgb` or `oklch` with a
hue method), alpha-premultiplied as CSS Color 4 specifies (hue is not
premultiplied; an achromatic stop takes the other stop's hue in OKLCH), and
gamut-mapped by chroma reduction. Outside the stops the end colours extend; at
a hard stop the later stop wins.

### `bakeStops(doc, n, opts?) → Stop[]`

About `n` stops that reproduce the OKLAB (or `opts.interpolation`) rendering in
a renderer that only interpolates in sRGB (Figma, SVG, native toolkits). Every
original stop is kept exactly, so the end points and hard stops survive; the
`n − stops.length` extra samples are shared between segments in proportion to
their length. `n` is capped at 4096. Returns `[]` for an invalid document.

### `complement(color) → string | null`

The complement (`complementHex`) of any colour the parser supports, as
`#rrggbb`. Alpha is ignored. `null` when the text is not one supported colour.

### `parseCssColor(css) → { color, alpha } | null`

The strict colour parser the gradient parser uses (unlike the lenient
`parseAnyColor` for paste fields).

## Not in this API yet

Scoring model v2 (interpolation-aware), radial and conic documents, colour
hints, `{ l, c, h }` colour inputs (PLAN §3.4 sketch), CLI.
