# @opal42/style-dictionary

[Style Dictionary](https://styledictionary.com) 5 hooks that attach the
**smoothness score** of gradient design tokens (OKLAB/OKLCH, scoring model v1)
to your build, plus an opt-in refinement. Working package name; not published
yet. Requires Node 22+.

```js
// sd.config.mjs (until published: import from packages/style-dictionary/dist/index.js)
import StyleDictionary from 'style-dictionary';
import { register } from '@opal42/style-dictionary';

const sd = new StyleDictionary({
  source: ['tokens/**/*.json'],
  platforms: {
    css: {
      transformGroup: 'opal42/css',
      buildPath: 'build/',
      files: [
        { destination: 'gradients.css', format: 'opal42/css-gradients' },
        { destination: 'gradient-report.json', format: 'opal42/report-json' },
      ],
    },
  },
});

register(sd, { minScore: 70, onBelowMin: 'error' }); // minScore has no default: choose your own number
await sd.buildAllPlatforms();
```

- `opal42/gradient-score` (attribute transform): adds `attributes.opal42 = { score, scoringModel, findings, status }`. Never changes the value.
- `opal42/gradient-refine` (opt-in value transform): replaces a gradient with the core `refine` output only when the score strictly improves, the token is not locked (`$extensions.opal42.lock: true`), and it has no alpha, hard stops or skipped parts. It can change colours.
- formats `opal42/css-gradients` and `opal42/report-json`; transform group `opal42/css`.

The score is a smoothness score by our definition, not a quality verdict.

## DTCG: verified and not verified

The normative text of the DTCG `gradient` type could not be read offline, so the
shape is **not verified against the specification**. The package reads the
commonly implemented one: an array of `{ color, position }` stops (`position`
0-1; `color` a DTCG `srgb`/`oklab`/`oklch` colour object or a CSS colour string,
the pre-2025 draft), plus a legacy `$value` that is one CSS linear-gradient.
Style Dictionary 5.8.0 and Terrazzo 2.10.0 read the same array. Everything else
is a structured skip with a code. Details and the full list:
[docs/style-dictionary.md](https://github.com/LightSeek3r/gradient-studio/blob/master/docs/style-dictionary.md).

## Privacy

Nothing leaves the build: no network request, no telemetry. Tokens are read and
scored in memory; the only files written are the ones Style Dictionary writes
for the formats you configure.
