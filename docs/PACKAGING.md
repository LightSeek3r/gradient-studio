# Packaging

How `@opal42/gradient` (core) and `opal42` (CLI) are built, what they export
and what they weigh. Both packages are `"private": true` and nothing here
publishes anything ([`RELEASING.md`](RELEASING.md)).

## Build

Both packages build with [tsdown](https://tsdown.dev) (rolldown), which
installs and runs offline from the npm proxy:

- `npm run build:packages` (core, then CLI). Output goes to each package's
  gitignored `dist/`.
- Core: five entries (`index`, `css`, `color`, `names`, `export`), ESM, ES2022, unminified,
  with `.d.ts`. Shared code lands in hashed chunks next to the entries.
- CLI: `dist/cli.js` (the `bin`, shebang, executable bit set by tsdown) and
  `dist/index.js` (the `run` function; unstable until 1.0). `@opal42/gradient`
  is a declared dependency and stays external.
- **ESM only.** Node >= 22 can `require()` ESM, and every browser/bundler
  consumer is ESM, so a CJS build (two more output sets, a dual-package
  hazard) is not justified. `attw --profile esm-only` is green.

## Core `exports`

| Subpath | Contents |
|---|---|
| `.` | everything: scorer, refiner, document API, parser, colour helpers, v1 model |
| `./css` | `parseGradient`, `parseCssColor` and parser types |
| `./color` | colour parse/format/convert (`parseAnyColor`, `formatHex`, `hexToOklch`, `gamutFitOklch`, ...), `parseCssColor`, `complement` |
| `./names` | `CSS_NAMED_COLORS`, `CSS_COLOR_NAMES`, `nearestColorName` |
| `./export` | `toTailwind`, `toScss`, `toSvg`, native snippets, `toDtcg`, Figma paints, `exportAll` ([`exports.md`](exports.md)) |
| `./package.json` | |

Each entry has a `source` condition (TypeScript source, first), then `types`
and `default` (the built `dist`). `source` is for this workspace only: the web
app and the package tests set it (`resolve.conditions` in the Vite/Vitest
configs, `customConditions` in the app tsconfigs), so they run without building
the packages. `src/` is not in the published tarball; no consumer enables
`source`.

`sideEffects: false`. Subpaths were chosen from measured sizes (below):
`./names` is an entry rather than a separate module because the table is
already tree-shaken when unused; `./css` and `./color` give bundlers that do not
tree-shake (and readers) a small, obvious surface.

### Module-load audit

Before this work, importing a colour helper dragged the whole v1 scoring model
(about 3 KB gzip) into a bundle: `deepFreeze(...)` calls, `new RegExp(V1_MODEL...)`
and the name lookup tables ran at module load, and a bundler cannot prove such
code is pure. Behaviour-preserving fixes (vectors byte-identical,
`npm run vectors:diff` clean; 2768 core tests pass):

- `V1_MODEL`, `V1_BOUNDARY_TABLE`, `V1_FINDING_CODES`: `/* @__PURE__ */`
  annotations (the latter two inside a pure IIFE, because their argument
  expressions read `V1_MODEL` properties, which a bundler treats as possibly
  side-effecting).
- `isValidStopColor`: the validation `RegExp` is built on first use instead of
  at load.
- `color-formats.ts`: the name tables are built by annotated pure expressions.

Effect: `import { hexToOklch } from "@opal42/gradient/color"` fell from 3.8 kB to
0.4 kB gzip.

## Measured sizes

Minified + gzipped, everything bundled, via size-limit (esbuild). Budgets are
the first measurement plus about 10 %, enforced by `npm run size` in CI.

| Import | Measured | Budget |
|---|---|---|
| `import *` from `.` (whole library) | 19.52 kB | 21.5 kB |
| `{ score }` | 5.65 kB | 6.2 kB |
| `{ parseGradient }` | 8.23 kB | 9.1 kB |
| `{ parseGradient, scoreParsed, refine }` | 14.91 kB | 16.4 kB |
| `./css` (all) | 8.38 kB | 9.2 kB |
| `./color` (all) | 6.74 kB | 7.4 kB |
| `./color` `{ parseAnyColor }` | 2.32 kB | 2.6 kB |
| `./color` `{ hexToOklch }` | 0.40 kB | 0.5 kB |
| `./names` (all) | 1.98 kB | 2.2 kB |
| CLI own code (`dist/cli.js`, core excluded) | 9.5 kB | 10.5 kB |

(size-limit kB are 1000 bytes.) Tarballs: core 45.0 kB packed (19 files), CLI
16.2 kB packed (8 files; `npm pack --dry-run`).

### Against the plan's aspirations

PLAN §6 hoped for "<= 4 KB core / <= 3 KB colour+names gz". Honest status:

- The **colour** side is close: `./color` as a whole is 6.7 kB, but typical use
  (`parseAnyColor` with the name table) is 2.3 kB, inside the 3 kB aim.
- The **core** is far from 4 kB: the whole library is 19.5 kB, and scoring alone
  is 5.7 kB. The parser added about 9 kB gzip (8.2 kB on its own, mostly the
  tokenizer, the colour grammar with the 148 names, and the skip logic) to what
  was originally a roughly 4 kB engine. That is the price of "never a wrong
  colour" parsing of real-world CSS; it was not chased.

What could shrink it, if size ever matters (not done, none needed now):

1. Ship scoring and the parser as separate entries with no shared colour
   grammar, and let the parser reuse the name table by index instead of a
   `Record` plus two `Map`s (a guess: about 1 kB).
2. Move the user-facing English messages and the v1 table of thresholds into a
   compact array form (the model object is about 18 kB unminified).
3. Drop `toCSSWithFallback`, `bakeStops` and `sampleGradient` from `.` into a
   `./render` entry; they pull in the OKLAB/OKLCH interpolation (about 4 kB).
4. Minify property names in the model (breaks readability of the published
   table; probably not worth it).

## Checks

| Script | Tool | Runs on |
|---|---|---|
| `npm run lint:package` | publint `--strict` | the packed tarballs |
| `npm run attw` | @arethetypeswrong/cli, `--profile esm-only` | the packed tarballs |
| `npm run size` | size-limit | the built `dist` |

All three run in CI after `npm run build:packages`, as does the CLI smoke test
(`node packages/cli/dist/cli.js score packages/cli/tests/fixtures`) and
`npm run vectors:diff`. `prepack` rebuilds, so a packed tarball can never carry
a stale or missing `dist`. The package metadata (`files`, `types`, `engines`,
`publishConfig` with `access: public` and `provenance: true`, repository,
license) is final apart from `private`.


## Budget re-baseline (2026-11-16)

`proposeFixes` (U2) was added to core after the first budgets were measured. Re-measured gzip sizes:
whole core 23.0 kB (budget 25.3 kB), `parseGradient` alone 9.8 kB (budget 10.8 kB). Both budgets are
the measurement plus about 10% headroom, as before.

Open question: `parseGradient` on its own grew by about 0.7 kB when `proposeFixes` was added even though
it does not use it. That suggests a small tree-shaking leak (a shared chunk or module-level work). It is
worth investigating before 1.0; the budget was raised only so the check keeps catching *new* regressions.

## Stylelint plugin

`@opal42/stylelint-plugin` ([`stylelint.md`](stylelint.md)) follows the CLI
pattern: tsdown, ESM only, one entry (`dist/index.js` + `.d.ts`), `private`,
`@opal42/gradient` a dependency and `stylelint` (>= 16.14) a peer dependency,
both external. Own code is about 4.1 kB gzip (budget 4.5 kB); the tarball has
`dist`, `LICENSE`, `README.md` and `package.json`. The same three checks cover it
(`lint:package`, `attw`, `size`), and CI loads the built plugin through the
Stylelint CLI.


## `./export` subpath (phase 3)

A fifth entry, `dist/export.js`, not re-exported from the root (the whole-library
budget is unchanged). Zero dependencies; it shares the colour and baking chunks.
Measured gzip sizes and budgets (measurement plus about 10%):

| Import | Measured | Budget |
|---|---|---|
| `./export` (all) | 12.18 kB | 13.4 kB |
| `./export` `{ toTailwind }` | 3.88 kB | 4.3 kB |
| `./export` `{ toDtcg }` (pulls baking) | 6.02 kB | 6.6 kB |
| `./export` `{ cssAngleToLine }` | 198 B | 220 B |

## Size note after the performance work (2026-11-17)

The proposeFixes speed-up (prepared scoring data, a per-search colour memo, the finding-persistence
pruning in `src/api/fix-persistence.ts`; `docs/worker.md`, "Fix search cost") added code to the engine and
to `proposeFixes`. Re-measured gzip sizes: whole core 24.73 kB (budget 25.3 kB, was 23.0 kB), `{ score }`
6.10 kB (budget 6.2 kB), `parseGradient` alone 9.93 kB (budget 10.8 kB), `{ parseGradient, scoreParsed,
refine }` 15.38 kB (budget 16.4 kB). All budgets were left as they are: every entry is still inside its
budget, so no re-baseline was needed. `{ score }` has only 0.1 kB left; the next change to the scorer will
have to re-baseline it or trim code. The engine's internals (`PreparedScore`, `ScoreMemo`) are not part of
the public API: `src/index.ts` now lists the engine's exports by name instead of `export *`.


## Web components (phase 4)

`@opal42/element` ([`element.md`](element.md)) follows the same pattern (tsdown,
ESM only, `private`, publint, attw, size-limit) with one difference: it has **no
runtime dependencies**. `@opal42/gradient` is a devDependency that is bundled
in, so the package can ship one self-contained, minified file
(`dist/opal42-element.js`, 27.25 kB gzip, budget 30 kB) that a plain
`<script type="module">` loads. `sideEffects` lists only the auto-defining files
(`dist/define.js`, `dist/opal42-element.js`). The library entries (`.`, `./define`)
bundle core too, so there is no peer or external to resolve.


## Style Dictionary adapter

`@opal42/style-dictionary` ([`style-dictionary.md`](style-dictionary.md)) follows the
stylelint-plugin pattern: tsdown, ESM only, one entry, `private`, `@opal42/gradient` a
dependency (external) and `style-dictionary` ^5 a peer dependency that is **never
imported** (the user passes it to `register`), also a dev dependency for the tests. Own code is
4.18 kB gzip (budget 4.6 kB, measured plus about 10%). The same three checks cover it
(`lint:package`, `attw`, `size`).

`style-dictionary` 5.8.0 pulls `@bundled-es-modules/glob`, which depends on `glob` 13 and
`minimatch` 10, both flagged by `npm audit` (moderate). A root `overrides` entry
(`"@bundled-es-modules/glob": { "glob": "^14.0.6" }`, which brings `minimatch` 11) keeps
`npm audit` at 0. Style Dictionary's own tests are not run against glob 14; our builds are.
