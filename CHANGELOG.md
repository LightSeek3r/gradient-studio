# Changelog

All notable changes to Gradient Studio are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow
[Semantic Versioning](https://semver.org) loosely while the project is 0.x.

## [Unreleased]

### Added (Python port, `ports/python`)

- `opal42-gradient` (working name, **not published**; no PyPI name has been reserved): a pure-Python
  (3.10+, standard library only, typed) port of scoring model v1 in `ports/python`: colour
  conversions, hex/rgb/hsl/name parsing and formatting, `score_gradient` with coded and located
  findings, `suggest_gradient` / `refine_gradient` with the same guarantees, `build_gradient_css`,
  `build_multi_gradient_style`, `interpolate_gradient`, `color_at_position`, `complement_hex`, and the
  148-name table generated from the TypeScript source. The gradient-string parser, the document API
  and the exporters are not ported.
- A conformance harness that replays `spec/vectors/*.json` (`python3 -m unittest discover`,
  `scripts/check_conformance.py`): 1,740 cases, 1,651 compared exactly, 89 boundary cases checked on
  measurements, 0 mismatches, on Python 3.10 to 3.13; plus property tests. A CI job `python-port` runs
  it on Python 3.10 and 3.13. No vector, spec or TypeScript file changed.
- `docs/python.md`: what is ported, the results, and the JavaScript-versus-Python portability notes
  (`Math.round` half-up versus banker's rounding, `%`, `Math.cbrt`, `sum()` on Python 3.12+, regex and
  number-printing differences, last-bit differences of `pow`/`sin`/`cos`/`atan2`) and a finding for the
  spec: on 3-stop gradients the location of `lightness/uneven-speed` is decided by sub-ulp noise (10
  vectors), which suggests a boundary annotation for location ties.

### Added (web app: English and French)

- Full EN/FR localisation of the web app with no new dependency: typed catalogues
  (`apps/web/src/i18n/en.ts`, `fr.ts` typed `Record<keyof typeof en, string>`, so a missing
  translation fails typecheck), an ICU-lite `t(key, params)` with plural and select through
  `Intl.PluralRules`, `<I18nProvider>`, `useT()`, and an accessible EN | FR switcher in the header.
- Language detection: `lang=fr|en` in the URL fragment, then the stored choice, then
  `navigator.languages`. `<html lang>`, `<title>`, the description and the Open Graph/Twitter tags
  follow the language at runtime (`index.html` stays English).
- URL format: an optional `;lang=fr|en` segment on document links (`#v1;…;lang=fr`) and issue
  permalinks (`#issue=<code>;lang=fr`). It is written only when the language was chosen, never
  auto-detected, and links with or without it open the same gradient (`docs/URL-FORMAT.md`).
- Everything user-visible is translated: toasts, the import dialog and its parser messages, stop
  cards, directions, export notes, the score ledger, per-rule explanations and finding messages
  (chosen by stable `code` and severity, falling back to core's English `message` only for unknown
  codes), targeted-fix labels, curves, screen-reader strings and live regions, the footer theory
  text and the PWA update toast. Core keeps English messages; the CLI stays English.
- Checks: both catalogues must have the same keys and ICU placeholders, no empty values and no
  untranslated or English-leftover text outside a technical allow-list; a scan of every `.tsx`
  file fails on a hard-coded visible string; EN and FR components are axe-tested.
- `docs/i18n.md` (how to add a locale) and `docs/i18n-glossary.md` (French terminology).

### Added (GradientBench, phase 3)

- `packages/bench` (`@opal42/bench`, private): GradientBench v0, an offline model-agnostic harness with 100 briefs, a gradient extractor (CSS, JSON, JSX, Tailwind), scoring with the v1 metric, a paired bootstrap / Wilcoxon comparison and deterministic JSON, Markdown and static HTML reports. Measures smoothness by our definition only; not validation of the metric (docs/bench.md). No leaderboard of real models is published.

### Added (exports, phase 3)

- Core subpath `@opal42/gradient/export`: `toTailwind` (arbitrary value, native `bg-linear-*` /
  `from-` `via-` `to-` utilities, `@theme`, `@utility`), `toScss`, `toCssVariables`, `toSvg`
  (angle as a `gradientTransform` for any box), `toSwiftUI`, `toCompose`, `toFlutter`, `toGodot`,
  `toAndroidXml`, `toDtcg`, `toFigmaPaint` / `fromFigmaPaint` / `angleToFigmaTransform`,
  `cssAngleToLine` and `exportAll`. Unsupported input (invalid, repeating where the target has none)
  is a typed result, never garbage; OKLAB/OKLCH and differing-alpha documents are pre-sampled with
  premultiplied-correct baking for sRGB-only targets. Native snippets are untested on device and the
  DTCG shape is unverified against the spec (`docs/exports.md`).
- Web app: the Export panel has tabs (CSS, CSS in OKLAB with sRGB fallback, Tailwind, SCSS, CSS
  variables, SVG, SwiftUI, Compose, Flutter, Godot, Android XML, DTCG JSON, Figma), each with copy,
  language label, wrapped code and notes. Tabs other than CSS export the base gradient and say so
  when several directions are layered; the Suggested view is respected.

### Added (web app: PWA, deploy-as-code, accessibility CI)

- Installable and offline-capable: a generated service worker (versioned precache, no analytics,
  no foreign origins), a non-blocking "Update available - reload" toast, a maskable icon, and an
  "Import CSS" shortcut (`/?action=import`). See `docs/DEPLOY.md`.
- `public/_headers` (strict CSP, security and cache headers) for Cloudflare Pages, and an example `wrangler.jsonc` under `docs/deploy/` (not active).
- `eslint-plugin-jsx-a11y` in lint, and axe component tests (stop chip, ledger rows, import dialog).

### Changed (web app import)

- CSS import now runs on the core `parseGradient` through a thin adapter instead of a second parser;
  it additionally accepts `oklab()`/`oklch()` and gradients inside whole rules. Differences are listed
  in `docs/web-import-notes.md`.

### Added (explainable score, U2)

- Points ledger: "100 − 20 − 12 − 10 = 58", one expandable row per deduction saying what the rule
  measures, with an explicit "floor 0" line when a dimension's penalties exceed its budget.
- Issue lane under the stop bar (brackets over segments, markers on stops) linked both ways with
  the ledger; lightness, chroma and hue curves on the bar's x-axis.
- "Fix this (+N)" per issue with a split preview and ghost handle (core `proposeFixes`), applied as
  one undoable step; a live score delta while a stop is dragged or recoloured.
- One example gradient per rule and issue permalinks (`#issue=<code>`, see `docs/URL-FORMAT.md`).

### Changed

- The score is labelled a smoothness score, with descriptive bands (smooth, mostly smooth, uneven,
  rough) in one hue instead of Excellent/Good/Fair/Poor in green, amber and red.

### Fixed (scoring engine, before freezing scoring model v1)

Every vector these change is accounted for in `spec/vectors/CHANGES-v1.md`.

- Invalid colours (anything but `#rrggbb`), positions outside 0–100 and fewer than two stops are
  now reported as unscorable instead of scoring a perfect 100; Suggest leaves them alone and the
  CSS builders skip invalid stops, so `#NaNNaNNaN` can no longer appear.
- Sampling a gradient whose stops do not reach 0 % or 100 % now clamps to the end colours and no
  longer skips middle stops.
- `parseName("constructor")` and similar no longer return JavaScript built-ins.
- Four penalties that took points off silently now say why (narrow hue arc, stops slightly short of
  the edges, transition under 40 % of the line, slightly uneven stop spacing).
- The score no longer depends on the order the stops were added in; only their positions count.
- Suggest keeps grey stops grey, keeps hard stops (stops at the same position, or ≤ 1 % apart)
  hard, centres opposed hues deterministically, and never returns a lower-scoring gradient: if it
  cannot improve the score it returns the gradient unchanged.

### Added

- Every score now carries coded, located findings (`findings`), the measurements its thresholds
  compare (`details.measurements`) and a `status`; all thresholds and weights live in one frozen
  table (`src/scoring-model-v1.ts`) documented rule by rule in `spec/scoring-v1.md`.
- `SCOPE.md` and `PRIVACY.md`.

## [0.1.0] - 2026-10-17

The first tagged version, published with an MIT licence. It covers everything since the project
started on 2026-03-11.

### Added

- **The gradient editor** (11 March 2026): colour stops on a draggable bar, an angle control, a
  live 0–100 quality score in four perceptual dimensions (lightness flow, hue arc, chroma
  balance, stop rhythm) with named issues, and **Suggest**, an OKLAB-based refinement with an
  Original/Suggested toggle and **Apply**.
- **Every colour format and complements** (27 August): each stop is editable through the colour
  picker, hex, RGB, HSL and the nearest of 148 CSS colour names, with paste (any notation) and
  copy on every field, plus its OKLCH complement, one click to swap in.
- **Multi-angle gradients** (27 August): up to seven directions aimed with a draggable compass,
  per-direction angle, weight and mute, presets and **Spread evenly**, blended as an exact
  weighted mean or through eight `background-blend-mode`s.
- **Export CSS and the header score** (27 August): a copy-ready `background` declaration (with
  `background-blend-mode` when needed), the live score chip in the header, and the
  **How does this work?** note.
- **Icons and link previews** (27 August): SVG and PNG favicons, app icons, a web manifest, a
  meta description, and Open Graph and Twitter Card tags with a 1200×630 preview image.
- **Open-source release** (17 October): MIT licence, a full README with screenshots, this
  changelog, contributing and security guides, a code of conduct, issue and pull request
  templates, and a CI workflow that lints and builds every push and pull request.

### Changed

- **Suggestion engine** (26 April): **Suggest** keeps the stops in their position order and
  compresses a wide hue arc to 80° around the stops' circular mean hue, for cleaner midpoints.
  The layout was refreshed at the same time.
- **Self-hosted fonts** (9 October): Space Grotesk and JetBrains Mono are bundled through
  Fontsource, so the app loads everything from its own origin.
- **Default gradient** (27 August): the editor opens on a navy-to-violet gradient.

### Removed

- The early single-file `gradient-studio.jsx` prototype, superseded by the TypeScript app
  (9 October).

[0.1.0]: https://github.com/LightSeek3r/gradient-studio/releases/tag/v0.1.0
