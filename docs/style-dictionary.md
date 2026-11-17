# Style Dictionary

`@opal42/style-dictionary` (working name, private, not published:
[`RELEASING.md`](RELEASING.md)) adds the **smoothness score** of gradient design
tokens to a [Style Dictionary](https://styledictionary.com) build. It is an
adapter over `@opal42/gradient`: all scoring lives in the core (scoring model v1,
[`spec/scoring-v1.md`](../spec/scoring-v1.md)); the package reads tokens, calls
the core and writes attributes, reports and CSS. No network, no I/O of its own,
no telemetry ([`PRIVACY.md`](../PRIVACY.md)).

The number is a smoothness score by our definition, not a quality verdict.
**There is no default threshold** (PLAN D5): `minScore` is off until you set it.

Requirements: Node 22+, Style Dictionary **5** (tested with 5.8.0). ESM only.
Style Dictionary 4 has the same hook API (`registerTransform` and friends,
`transitive`, attribute transforms), but it was **not tested**, and its colour
handling predates DTCG colour objects, so the peer range is `^5.0.0`.

## Read this first: what is and is not verified

This work was done offline in a sandbox. The DTCG specification text itself
(design-tokens.org, `tr.designtokens.org`, the community-group repository) was
**not reachable**, so the normative shape of the `gradient` type is **not
verified against the specification**. What was checked instead:

| Claim | Status |
|---|---|
| A gradient `$value` is an array of `{ color, position }` stops, `position` a number 0-1, `color` a colour value or a reference | **Corroborated by three independent implementations, not by the normative text**: Style Dictionary 5.8.0 (`expandObjectTokens` types `gradient.position` as `number` and links the `#gradient` section of the spec); Terrazzo `@terrazzo/token-tools` and `@terrazzo/parser` 2.10.0 (its `valid-gradient` rule: "Must be an array of { color, position } objects", both keys required, "Expected number 0-1", unknown keys reported; CSS output multiplies position by 100). Read from the installed packages, nothing run against a spec. |
| DTCG 2025.10 colour objects (`colorSpace`, `components`, `alpha`, `hex`) | Style Dictionary 5.8.0 reads them (its list of 14 valid colour spaces and `isDTCGColorObject` are in `transform-utils/colors.js`). Same status as above: not checked against the text. |
| Style Dictionary has no gradient transform or format of its own | **Verified in the installed source**: `grep` finds `gradient` only in the colour filter (which excludes CSS gradient *strings* from colour transforms), in the `expand` types map and in a comment. A gradient token is passed through untouched. |
| `toDtcg` (core export) is accepted by Style Dictionary and by this package | **Tested**: four documents in both colour formats are written by `toDtcg`, built by a real Style Dictionary run, and score and print exactly like the core does (`tests/dtcg-roundtrip.test.ts`). This proves the writer and the readers agree, not that either matches the specification. |
| The DTCG gradient has no angle or interpolation | From memory of the specification, consistent with every implementation read above (none has a field for one). Hence the vendor `$extensions` entry, below. |
| Pre-2025 draft shape | The draft's gradient is the same array, with colours as CSS strings (`"#ff0000"`) instead of colour objects. Identified from Style Dictionary's own type map, which predates the colour objects; **no other pre-2025 shape could be identified** from the sources available, so no other is accepted. |
| `$extensions.opal42.lock`, the vendor angle key | Our own conventions, not part of any standard. |

If the normative shape differs from the table below, only `src/read.ts` changes.

## Accepted token shapes

`readGradient` accepts exactly these and reports everything else as a skip with
a code (`tests/read.test.ts`):

1. **`dtcg-array`**: an array of stops `{ color, position? }`.
   - `color`: a DTCG colour object with `colorSpace` `srgb` (exact), `oklab` or
     `oklch` (converted by the core's strict parser, gamut-mapped by chroma
     reduction), or a CSS colour string (the pre-2025 draft; anything
     `parseCssColor` reads). `"none"` components count as 0. Other colour spaces
     (`display-p3`, `hsl`, ...) are skipped with `unsupported-color-space`; the
     object's `hex` fallback is **deliberately not used** (a wrong colour is
     worse than a skip, and SCOPE.md rules out a colour library).
   - `position`: a number 0-1. A missing position is accepted and laid out as
     CSS does (the specification requires it).
   - Alpha below 1 is kept on the stop; the v1 model then reports `alpha`
     (unscorable).
2. **`css-string`** (legacy): a `$value` string that is exactly one CSS
   `linear-gradient(...)`. Parsed with `parseGradient`; its skip codes pass
   through (`unsupported-kind`, `var`, `legacy-syntax`, ...). Several gradients,
   text around the gradient, or no gradient are skipped
   (`multiple-gradients`, `not-a-single-gradient`, `no-gradient`).

A token is a gradient token when its type is `gradient`, or when its value is a
string containing a CSS gradient function (SD leaves those typed `color`).

**Angle.** The DTCG gradient has no direction, but scores do not depend on it
(v1 measures the stops) and CSS output needs one. In order: the token's
`$extensions.opal42.angle`, the `angle` the core's `toDtcg` writes under
`$extensions["io.github.lightseek3r.gradient-studio"]` (so its output round-trips,
interpolation included), the `angle` plugin option, then **90** (to the right).

## Use

Until the package is published, build it from a checkout
(`npm run build:packages`) and import `packages/style-dictionary/dist/index.js`.
Once published: `npm install --save-dev style-dictionary @opal42/style-dictionary`.

```js
// sd.config.mjs
import StyleDictionary from 'style-dictionary';
import { register } from '@opal42/style-dictionary';

const sd = new StyleDictionary({
  source: ['tokens/**/*.json'],
  platforms: {
    css: {
      transformGroup: 'opal42/css', // name/kebab, color/css, opal42/gradient-score
      buildPath: 'build/',
      files: [
        { destination: 'gradients.css', format: 'opal42/css-gradients' },
        { destination: 'gradient-report.json', format: 'opal42/report-json' },
      ],
    },
  },
});

register(sd, {
  minScore: 70,        // your own number; no default. Omit to check nothing.
  onBelowMin: 'error', // 'warn' (default) or 'error' (fails the build)
});

await sd.buildAllPlatforms();
```

`register` takes a Style Dictionary instance or the class (`register(StyleDictionary)`
makes the hooks global); both have the same `register*` methods and the package
never imports `style-dictionary` itself. Register before building.

With the `style-dictionary` CLI, a config module could call
`register(StyleDictionary)` on the class and `export default` the config; **that
path was not tested** (the tests build through the JavaScript API). Names:

| Name | Kind | What it does |
|---|---|---|
| `opal42/gradient-score` | transform (attribute) | Adds `token.attributes.opal42`. **Never changes the value.** |
| `opal42/gradient-refine` | transform (value, `transitive`) | Opt-in. Replaces the value with the core `refine` output. |
| `opal42/css-gradients` | format | CSS custom properties with the final gradient strings. |
| `opal42/report-json` | format | JSON report of every gradient token. |
| `opal42/gradient-check` | action | Enforces `minScore` when none of the two formats is used. |
| `opal42/css` | transform group | `name/kebab`, `color/css`, `opal42/gradient-score`. |

Options of `register(sd, options)`: `minScore`, `onBelowMin`, `angle`, and `log`
(`false` to mute, or a function; the default is `console`, silent when Style
Dictionary's `log.verbosity` is `silent`). Bad option values throw a `TypeError`.

### `opal42/gradient-score`

```json
{ "score": 58, "scoringModel": "v1", "status": "scored",
  "findings": [ { "code": "lightness/reversal", "severity": "error", "pointsLost": 12, "stops": [1] } ] }
```

`status` is `scored`, `unscorable` (read fine, outside the model's domain:
`alpha`, `repeating`, `too-few-stops`, `position-range`, ...) or `skipped` (could
not be read: the codes above). For the last two `score` is `null` and `code` and
`reason` say why. `hardStops: true` is added when two neighbouring stops share a
position but not a colour (v1 numbers are not adjusted for stripes). Wording is
neutral: the attributes describe, they do not judge.

### `opal42/gradient-refine`

Replaces a gradient's value with the core `refine` result only when **all** hold:
the token has no `$extensions.opal42.lock === true`; it is scorable (no alpha, not
repeating, readable); it has no hard stops; the refined score is **strictly**
higher; the result can be written back in the token's own shape (a CSS string
with colour hints or a corner direction is left alone, because a rewrite would
change it). Anything else is untouched, and every gradient token gets one log
line: `opal42 refine: g: score 58 -> 90 (stops changed: 1, 2, 3)` or
`opal42 refine: g: left as is (locked)`.

Refinement can change colours. Colour objects are written back as `srgb` objects
(with `hex`) when a stop changed, strings as `#rrggbb`; unchanged stops and any
extra keys on a stop are kept byte for byte. A CSS string is rewritten with the
core's `toCSS`.

Put it **after** `opal42/gradient-score` to keep both numbers: the attribute is
the score before refinement, and the report's `score` is that of the value that
was built (with `scoreBeforeRefine` when they differ).

### References

Style Dictionary defers any token whose value contains `{references}` until the
references are resolved, and runs value transforms on it only if the transform
is `transitive`. So:

- `opal42/gradient-score` is an attribute transform: it runs on the resolved
  value, whether the stops are references (`{ "color": "{color.brand}" }`) or the
  whole value is one (`"$value": "{gradient.base}"`).
- `opal42/gradient-refine` is `transitive: true`, so it also runs after
  resolution. The token's `original` keeps the references; the built value has
  none (a refined stop is a concrete colour).
- Colour transforms in your group run on the colour tokens first, so the stops
  arrive as whatever they produced (`color/css` gives hex). Any CSS colour
  string or `srgb`/`oklab`/`oklch` object is read.
- **`expand`**: Style Dictionary's `expand` splits composite tokens into
  sub-tokens. A gradient expanded that way is no longer a gradient token and is
  not seen. Use `expand: { exclude: ['gradient'] }` (tested).

### `minScore`

Gradient tokens whose built score is below it are collected and sorted by path;
`onBelowMin: 'error'` throws (the build fails):

```
opal42: 2 gradient tokens below minScore 80 (smoothness score, scoring model v1):
  navy: 71 (lightness/reversal, ...)
  z: 58 (lightness/reversal, ...)
```

`warn` (default) logs the same text once. Only **scored** tokens are compared:
unscorable and skipped tokens, and gradients with hard stops (like the Stylelint
plugin's default), are never counted as failures. The check runs inside both
formats and in the `opal42/gradient-check` action. It judges the value that is
built, so a refined gradient is checked after refinement.

### Formats

`opal42/css-gradients`: `:root { --gradient-name: linear-gradient(...); }`, one
property per gradient token, in token order, names from `token.name` (so keep
`name/kebab` or another name transform). `file.options.selector` changes
`:root`. A gradient that cannot be printed becomes `/* skipped name: code */`.
No sRGB fallback is added (PLAN D9); `outputReferences` is not supported.

`opal42/report-json`: `tool`, `scoringModel`, a `note` ("a smoothness score by our
definition, not a quality verdict"), `minScore` if set, a `summary` (counts of
gradients, scored, unscorable, skipped) and `tokens` sorted by dotted path, each
with `path`, `score`, `status`, `findings`, `code`/`reason`, `locked`. No
timestamps and no absolute paths, so it is byte-identical across builds and safe
to commit or diff (a snapshot is tested).

## Tests

`npm test -w @opal42/style-dictionary` runs real Style Dictionary builds on
temporary directories (fixtures: composite gradients, references, CSS strings,
locked and alpha and hard-stop tokens, malformed tokens, `toDtcg` output),
asserting exact files. No network.

## Privacy

Nothing leaves the build: the package makes no network request, writes only the
files Style Dictionary writes for the formats you configure, and collects no
telemetry. Token values are read in memory and scored locally.
