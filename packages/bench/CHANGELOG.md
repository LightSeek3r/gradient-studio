# Changelog

All notable changes to `@opal42/bench` (GradientBench). Pre-1.0; the summary
`schemaVersion` (currently 1) is the compatibility promise for `summary.json`.

## [Unreleased]

### Added

- GradientBench v0, an offline model-agnostic harness. No network, no model calls, no API keys.
- `prompts/briefs.json`: 100 UI design briefs in 10 categories with a documented authoring policy,
  `briefs.schema.json`, a validator and a pinned brief-set hash.
- `extract`: gradients from Markdown fences, prose, inline CSS, SCSS, JSON (exact decoding),
  JSX/CSS-in-JS strings, Tailwind arbitrary values (`bg-[linear-gradient(to_right,...)]`,
  `bg-linear-[...]`) and Tailwind utilities (`bg-gradient-to-*`, `bg-linear-*`, `from-`/`via-`/`to-`;
  palette colours only with a supplied palette), single-definition variable substitution, and
  de-duplication.
- `score` layer: per-brief any-gradient, scorable ratio, min/mean score, finding-code frequencies
  and the OKLAB distance refine would move the colours.
- `report`: `summary.json` (schemaVersion 1), Markdown, and a self-contained static HTML
  leaderboard (inline SVG distributions, dark/light, passes axe, no external URLs); paired bootstrap
  interval (seeded, 2,000 resamples) and Wilcoxon signed-rank p-value, implemented in-house.
  Every report carries the circularity caveat and provenance; no flag removes them.
- `opal42-bench` CLI: `validate-briefs`, `prompts`, `score`, `report`.
- `examples/`: a synthetic run to test the harness and show the formats (not model results).
