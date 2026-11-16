# Stylelint plugin

`@opal42/stylelint-plugin` (working name, not published: [`RELEASING.md`](RELEASING.md))
reports the **smoothness score** of the linear CSS gradients in your stylesheets
and the coded findings behind it. It is an adapter over `@opal42/gradient`:
all scoring lives in the core (scoring model v1,
[`spec/scoring-v1.md`](../spec/scoring-v1.md)), the plugin only maps results to
Stylelint problems and text edits. No network, no telemetry
([`PRIVACY.md`](../PRIVACY.md)).

The number is a smoothness score by our definition, not a quality verdict.
**There is no default threshold** (PLAN D5): `opal42/min-score` requires you to
choose one.

Requirements: Node 22+, Stylelint **16.14 or newer** (the autofix uses the
`fix` object of `utils.report`, added in 16.14; tested against 18). ESM only.

## Install and configure

Until the package is published, build it from a checkout
(`npm run build:packages`) and point `plugins` at
`packages/stylelint-plugin/dist/index.js`. Once published:

```sh
npm install --save-dev stylelint @opal42/stylelint-plugin
```

Flat `stylelint.config.js`:

```js
/** @type {import('stylelint').Config} */
export default {
  plugins: ['@opal42/stylelint-plugin'],
  rules: {
    // Pick your own number; 70 is an example, not a recommendation.
    'opal42/min-score': 70,
    'opal42/valid-gradient': true,
  },
};
```

With options and per-code rules:

```js
export default {
  plugins: ['@opal42/stylelint-plugin'],
  rules: {
    'opal42/min-score': [
      70,
      {
        properties: ['background', 'background-image', '/^--/'], // default: every declaration
        ignoreUnscorable: true, // default
        skipHardStops: true,    // default
        skipAlpha: true,        // default
        severity: 'warning',    // Stylelint's own option
      },
    ],
    'opal42/no-finding': [['hue/wide-arc', 'lightness/reversal']],
    'opal42/valid-gradient': true,
  },
};
```

## Rules

### `opal42/min-score`

Reports every gradient whose smoothness score is below the minimum (inclusive:
a score equal to the minimum passes). Primary option: a number from 0 to 100,
**required**.

| Secondary option | Default | Meaning |
|---|---|---|
| `ignoreUnscorable` | `true` | `false` also reports gradients that cannot be scored (`var()`, `calc()`, radial, repeating, ...) as "was not scored (code: reason)". |
| `skipHardStops` | `true` | Gradients whose neighbouring stops share a position but not a colour (stripes) are not judged. `false` scores them anyway: v1 numbers are not adjusted for stripes. |
| `skipAlpha` | `true` | Gradients with translucent stops are not judged (v1 measures opaque stops). `false` scores the colour channels only, ignoring alpha; scrims (`#000` to `transparent`) will look worse than they are. |
| `properties` | all | Only these declarations. Strings match the property name (case-insensitive; custom properties exactly), `'/regex/flags'` strings and `RegExp`s match by pattern. |

Message: `Gradient smoothness score 58 is below the minimum 70; largest
deductions: hue/wide-arc -20, lightness/reversal -12, chroma/muddy-midpoint -10`.
The problem's range is the whole gradient function.

### `opal42/no-finding`

Forbids specific findings. Primary option: an array of finding codes from
[`spec/scoring-v1.md`](../spec/scoring-v1.md) (`['hue/wide-arc']`); an unknown
code is an invalid option. Secondary options: `skipHardStops`, `skipAlpha`,
`properties` (as above). One problem per finding, located on **the offending
stops** (from the first to the last stop the finding names; the whole gradient
when it names none). Message: `Unexpected smoothness finding hue/wide-arc (-20
points): Hue arc spans >180° - colors clash unexpectedly`.

### `opal42/valid-gradient`

Reports gradients that cannot be parsed for reasons you can fix: skip codes
`syntax` (bad direction, empty argument, too many positions, a gradient inside
a gradient) and `unbalanced`. It is deliberately conservative: everything that
is merely outside what the scorer understands (`var()`, `calc()`, `color-mix()`,
wide-gamut colours, radial, conic, legacy prefixes, preprocessor variables) is
**not** reported, because it may be valid CSS. Primary option `true`;
secondary `properties`. No autofix.

## What is looked at

Every declaration (including custom properties `--x: linear-gradient(...)`,
declarations in `@media`/`@supports`/nesting, and layers of a `background`
shorthand that also has `url(...)`). Each gradient function in a value is
judged on its own. Gradients inside quoted strings (`content: "..."`) and inside
`url()` are ignored. Not looked at: radial, conic, repeating and vendor-prefixed
gradients, anything with `var()`, `calc()`, `color-mix()`, wide-gamut colours or
preprocessor variables (all reported only as "not scored" with
`ignoreUnscorable: false`), Tailwind classes, CSS-in-JS, `@include` arguments.

## Positions

Ranges are exact: line, column, `endLine`, `endColumn` of the offending text,
including multi-line values, comments inside the value and CRLF files. The
parser works on the value as written in the source and the offset is mapped the
way PostCSS counts positions (from the node start in the original input).

**SCSS and Less** work through `customSyntax` (`postcss-scss`, `postcss-less`):
`$variables`, nested rules, `//` comments (also inside a gradient, and
preserved by the fix), Less `@variables`. Best effort: preprocessor
expressions (`$a`, `#{...}`, `darken(...)`, `@a`) make a gradient unscorable,
so it is skipped, never guessed. Positions after SCSS `//` comments are
exact; this is covered by tests, but exotic syntaxes (Sass indented syntax,
`@include` arguments) are not.

## Autofix (`stylelint --fix`)

Opt-in, as always with Stylelint: nothing changes unless you pass `--fix`. The
fix is conservative and can **change colours**: it uses the same moves as the
web app's Suggest button (`refine`) and the targeted edits of `proposeFixes`.
Review the diff, or run `--fix` on a branch first.

- `min-score` first applies targeted fixes (largest gain first) until the
  score reaches the minimum, else repeats the one-click refinement. A fix is
  offered **only if it reaches the minimum**; otherwise the problem stays
  reported and nothing is changed.
- `no-finding` removes the forbidden findings with the targeted fix for each
  code. It is offered only when it strictly raises the score, removes the
  finding and introduces no other forbidden finding.
- Only when the declaration holds **exactly one gradient** and that gradient
  is scorable, opaque, without hard stops, colour hints or double-position
  stops. Never for skipped, legacy, radial, conic, repeating, `var()`/`calc()`
  or preprocessor gradients, and never when `skipAlpha: false`/`skipHardStops:
  false` let such a gradient be scored.
- Only the **stop arguments** are replaced (changed stops become `#rrggbb`
  with an explicit percentage; unchanged stops keep their text). Direction,
  `in oklch`, whitespace, comments and everything outside the gradient stay
  byte for byte. Other layers of a `background` shorthand are untouched.
- Every step is re-parsed and re-scored from the rewritten text and must raise
  the score strictly; a second `--fix` pass finds nothing to do (idempotent).
- Stylelint's `disableFix` and `stylelint-disable` comments are honoured.

## Limits

The v1 score measures the stop list, not the interpolated path, and it has not
been validated against human judgement (PLAN D5). Use it as a consistent,
explainable smoothness check, with a threshold you chose.
