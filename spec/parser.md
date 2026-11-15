# CSS gradient parser

`parseGradient(css, opts?)` in `packages/core/src/css/`. Status: Phase 1
(PLAN D7). It is a **scanner, not a CSS parser**: it finds gradient functions in
any text and turns the linear ones it fully understands into a
[`GradientDocument`](api.md). Everything else is reported as a structured skip.

Guarantees:

- **Never throws**, for any input of any type.
- **Never a wrong colour.** A stop is either the colour CSS would compute, or the
  gradient is skipped with a code. Nothing is guessed.
- **Linear time.** One forward pass with a stack bounded at 64 frames; every
  later step is linear in the length of the gradient it works on.
- **Deterministic and pure.** No DOM, no globals, no state between calls.

## Result

```ts
parseGradient(css: string, opts?: { maxStops?: number; maxLength?: number; maxInputLength?: number }): {
  gradients: ParsedGradient[];   // ordered by range.start
  truncated?: true;              // input was longer than maxInputLength (default 2,000,000)
}

interface ParsedGradient {
  range: { start: number; end: number };   // whole function, name to ")"
  kind: "linear" | "radial" | "conic";
  repeating: boolean;
  vendorPrefix?: "-webkit-" | "-moz-" | "-o-" | "-ms-";
  document: GradientDocument | null;        // null exactly when `skipped` is set
  stopRanges: { start: number; end: number }[];
  angleRange?: { start: number; end: number };
  skipped?: { code: SkipCode; reason: string };
  warnings: { code: string; message: string; range? }[];
}
```

### Range semantics

- Offsets are **UTF-16 code units** into the string passed in (what
  `String.prototype.slice`, editors and LSP use). Ranges are half-open:
  `css.slice(range.start, range.end)` is the text.
- `range` runs from the first character of the function name (including a
  vendor prefix) to its closing parenthesis. For an `unbalanced` gradient it
  covers the name and the opening parenthesis only.
- `stopRanges`: with a document, `stopRanges[i]` is the source of
  `document.stops[i]`, trimmed of surrounding whitespace and comments. A
  double-position stop (`red 10% 20%`) becomes two document stops that share
  one range. Without a document it holds one range per colour-stop argument,
  best effort (empty for `legacy-syntax`, `unbalanced`, `too-long`, `too-deep`
  and nested gradients). Colour hints and the direction argument are never in
  `stopRanges`.
- `angleRange` is the `<angle>` or `to <side>` text, without any `in <space>`
  clause.

## Scanning

A gradient is `(repeating-)?(linear|radial|conic)-gradient(`, optionally
vendor-prefixed, or `-webkit-gradient(`, matched case-insensitively. The name
must start at an identifier boundary and must not follow `$`, `@` or `.`
(`my-linear-gradient(`, `$linear-gradient(`, `.linear-gradient(` are not
gradients). No whitespace is allowed before `(`.

The scanner understands just enough context to work in CSS, SCSS/Less, JS/TS,
HTML and Markdown:

| Text | Behaviour |
|---|---|
| `/* … */` | Skipped. Not recognised inside a `"…"`/`'…'` string, unless that string is inside a gradient. |
| `// …` to end of line | Skipped, unless preceded by `:` (URL schemes) or inside a quoted string. |
| `url(…)` unquoted | Skipped to its `)`. Its content is never scanned. |
| `"…"`, `'…'` | Gradients **inside** strings are found (JS strings, HTML attributes). A string ends at its quote or at a newline. Inside a gradient, a string in the other quote style is skipped whole. |
| `` ` `` | Not a string for the scanner (template literals hold CSS, with comments). It ends an open gradient. |
| `\x` | The escaped character is ignored. |
| `;`, `{`, `}`, the enclosing quote, `` ` ``, end of text | End every open gradient as `unbalanced`. Scanning continues after it. |
| `${…}`, `#{…}`, `@{…}` inside a gradient | Kept as one opaque token (→ `preprocessor`). |

Nested functions are balanced with one stack. Beyond 64 open parentheses no
new gradient is looked for, and a gradient that itself contains more than 64
levels is skipped as `too-deep`. Each gradient function is its own
`ParsedGradient`: the layers of a `background` shorthand are separate results,
and stray `url()`, positions, sizes and colours between them are ignored.

## Grammar subset (linear)

```
linear-gradient( [ <direction> || <interpolation> ]? , <stop-list> )
<direction>     = <angle> | 0 | to <side> | to <side> <side>
<angle>         = <number>(deg | grad | rad | turn)
<side>          = top | right | bottom | left
<interpolation> = in (srgb | oklab | oklch) [ (shorter | longer | increasing | decreasing) hue ]?   -- hue: oklch only
<stop-list>     = <stop> [ , <hint>? , <stop> ]*
<stop>          = <color> && <position>{0,2}
<hint>          = <position>
<position>      = <percentage> | 0
```

- Angles are converted to CSS degrees (0 = to top, clockwise) and not
  normalised (`450deg` stays 450). No direction means 180.
- `to top|right|bottom|left` are 0/90/180/270. **Corner keywords depend on the
  box's aspect ratio**; they are mapped to the angle for a square box
  (45/135/225/315) with a `corner-angle` warning.
- Positions are stored as 0-1 and may lie outside it (`-10%`, `120%`;
  `position-out-of-range` warning). A missing position stays `undefined` in the
  document; [`resolveStops`](api.md) applies the CSS rules.
- A double-position stop expands to two stops with the same colour.
- **Colour hints are parsed and ignored** (`color-hint-ignored` warning): the
  document has no transition midpoints, so a gradient with hints is scored and
  printed as if they were absent.
- `repeating-linear-gradient` yields a document with `repeating: true`
  (which `score` then reports as unscorable).
- Comments are allowed anywhere whitespace is.

### Colours

| Syntax | Notes |
|---|---|
| `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` | |
| `rgb()` / `rgba()` | Legacy (commas; all numbers or all percentages) and modern (spaces, `/ alpha`, numbers and percentages mixed). Channels are clamped and rounded. |
| `hsl()` / `hsla()` | Legacy and modern; hue as a number or `deg`/`grad`/`rad`/`turn`. |
| The 148 named colours | Case-insensitive. |
| `transparent` | `#000000` with alpha 0. |
| `oklab()`, `oklch()` | Converted to sRGB. Out-of-gamut colours are **gamut-mapped by reducing OKLCH chroma** at constant lightness and hue, with a `gamut-mapped` warning. This is not the channel clipping browsers currently apply, so such a stop can differ from the rendered colour. |

Alpha is clamped to 0-1 and kept on the stop only when below 1. The `none`
keyword, `hwb()`, `light-dark()` and anything not listed are `unknown-color`.

## Skip codes

| Code | When |
|---|---|
| `legacy-syntax` | Vendor-prefixed gradients (different angle and keyword conventions) and `-webkit-gradient()`. |
| `unsupported-kind` | `radial-gradient`, `conic-gradient` and their repeating forms: kind, range and stop ranges only. |
| `var` | `var()` anywhere: direction, colour, component or position. |
| `calc` | `calc()` and the other math functions (`min`, `max`, `clamp`, …). |
| `env` | `env()`. |
| `currentColor` | `currentColor`. |
| `color-mix` | `color-mix()`. |
| `relative-color` | Relative colour syntax, `rgb(from …)` etc. |
| `lab-lch` | `lab()`, `lch()`. |
| `color-function` | `color(display-p3 …)` and the other predefined spaces. |
| `system-color` | `Canvas`, `ButtonFace`, … including the deprecated ones. |
| `unknown-color` | Not a colour, or a malformed supported colour. |
| `length-position` | A stop position in `px`, `em`, or any other length. |
| `too-many-stops` | More than `maxStops` (default 32) document stops. |
| `interpolation-space` | `in hsl`, `in srgb-linear`, `in lch`, … (a real space the document cannot express). |
| `preprocessor` | `$var`, `@var`, `#{…}`, `${…}`. |
| `syntax` | Anything else that is not a valid linear gradient: bad direction, empty argument, misplaced hint, no stops, a gradient nested in a gradient. |
| `unbalanced` | The function never closes. |
| `too-long` | Longer than `maxLength` (default 100,000) code units. |
| `too-deep` | More than 64 levels of parentheses inside. |

The first problem in source order decides the code. A skipped gradient scores
as `unscorable` with the same code (`scoreParsed`).

Warnings (never skips): `color-hint-ignored`, `corner-angle`,
`position-out-of-range`, `gamut-mapped`.

## Not supported

- Radial and conic gradients (found, not interpreted).
- Anything whose value is not in the text: custom properties, math functions,
  `env()`, `currentColor`, system colours, preprocessor variables, template
  expressions. Tailwind class names and other non-CSS spellings are out of
  reach (`bg-[linear-gradient(to_right,…)]` is found and skipped).
- Wide-gamut and relative colours: `lab()`, `lch()`, `color()`, `color-mix()`,
  `rgb(from …)`, `hwb()`, `light-dark()`, the `none` keyword.
- Length stop positions, interpolation spaces other than `srgb`/`oklab`/`oklch`.
- Colour hints (ignored with a warning), corner keywords for non-square boxes
  (approximated with a warning).
- Legacy and vendor-prefixed syntaxes.
- HTML comments, HTML entities inside `style` attributes, and CSS escapes inside
  identifiers (`\6c inear-gradient(`).
- A single-stop gradient parses to a one-stop document, which `score` reports
  as `too-few-stops`.

## Tests

`packages/core/tests/parser.test.ts` (every rule and skip code, exact offsets),
`parser-corpus.test.ts` (real-world gradients with expected stops) and
`parser-fuzz.test.ts` (seeded fuzzing, a time budget on pathological input,
`parseGradient(toCSS(doc))` round trips).
