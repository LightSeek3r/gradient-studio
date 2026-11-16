# Changelog

## 0.1.0 (unreleased)

First version, working name `opal42.gradient-score`. Not published.

- Code lens `Smoothness N - M issues` above scorable gradients; no lens for skipped gradients unless `opal42.showSkipped`.
- Diagnostics on the offending stops (source `opal42`, code = finding code); severity information or warning, error only below the optional `opal42.minScore` (no default).
- Quick fixes per finding and `Refine whole gradient`; edits touch only stop arguments and are verified by re-scoring the rewritten text.
- Hover with score, dimensions, plain-language findings and SVG swatches of the gradient and the proposed fix.
- Commands `Opal42: Score current file` and `Opal42: Open in Gradient Studio`.
- Debounced (300 ms) analysis of changed documents only, cached by document version, 500 KB default size cap.
- No network, no telemetry.
