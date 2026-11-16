# Web app: CSS import on the core parser (notes for the PR)

The app's own `apps/web/src/import/parse-linear-gradient.ts` (a second CSS parser) is gone.
Import now runs on `parseGradient` from `@opal42/gradient` (spec/parser.md) through a thin
adapter, `apps/web/src/import/adapter.ts`. The adapter keeps the exported API
(`parseLinearGradient`, `looksLikeGradient`, `ImportedGradient`, `ParseResult`), so the dialog,
paste-anywhere, stop-field paste, toast text and Undo flow are unchanged.

## What the adapter does (and core does not)

- Takes the **first gradient** found in the text; with more, warns "Found N background layers;
  imported only the first." If the first cannot be imported it is rejected even when a later one
  could be.
- Maps core skip codes to user messages (`var`, `calc`, `env`, `currentColor`, `color-mix`,
  `relative-color`, `lab-lch`, `color-function`, `system-color`, `unknown-color`, `length-position`,
  `preprocessor`, `legacy-syntax`, radial/conic, `unbalanced`, ...). Text for the first group says what
  to do ("Paste the gradient with its computed values instead.").
- Applies the editor's limits, each with a warning: opaque stops only, 0-100 % stop range (exact
  sRGB trim at the edges), integer CSS-degree angle in [0, 360), at most `MAX_STOPS` (10) stops
  (core is asked for every stop so the error names the real count), sRGB interpolation.
- Rejects `repeating-*` (core parses it; the score does not cover it).
- Keeps `in hsl`, `in display-p3`, ... importable as sRGB with a warning: core skips them
  (`interpolation-space`), the adapter rewrites the clause to `in srgb` and re-parses.
- Aggregates core's per-hint warnings into the old "Skipped N colour hints" text; rebuilds the old
  corner-angle text; detects stops that browsers clamp (core resolves silently).
- Guard: input over 10,000 characters is refused before scanning.

## Behaviour differences (all deliberate, none loses a colour silently)

| Input | Before | Now |
|---|---|---|
| `oklab()` / `oklch()` colours | rejected | imported (core converts; out-of-gamut is gamut-mapped with a warning) |
| `color: linear-gradient(...)`, `--x: ...`, a whole `.a { ... }` rule | rejected ("Paste a single background value") | the first gradient is imported |
| `50% red` (position before colour) | rejected | accepted as `red 50%` (core grammar `<color> && <position>`) |
| `rgba(255, 0, 0, 0)` (any alpha 0) | red with a "transparency dropped" warning | treated like `transparent`: takes its neighbour's colour (premultiplied interpolation), warning says so |
| Error wording | per-stop ("Stop 2: ...") | per-problem; core's skip carries no stop number |
| `url()` or colours before the gradient | rejected | ignored; the gradient is found |

Everything else (accept/reject rules, auto-distribution, double positions, clamping, hint and
interpolation warnings, 10-stop cap, vendor-prefix rejection, never throwing) is covered by the
ported tests and behaves as before.

## Tests

`apps/web/tests/import-adapter.test.ts` is the old parser suite ported to the adapter (101 cases;
cases whose expectation changed are listed in the "differences" block). `tests/sw-helpers.test.ts`
covers the PWA helpers, `tests/a11y.test.tsx` the axe checks.
