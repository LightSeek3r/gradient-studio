---
"@opal42/gradient": minor
"opal42": minor
---

First release (0.1.0).

`@opal42/gradient`: the v1 smoothness scorer and refiner, a source-ranged CSS
gradient parser (`parseGradient`), the document API (`score`, `scoreParsed`,
`refine`, `toCSS`, `bakeStops`, `sampleGradient`, `complement`) and the colour
helpers. ESM only, zero dependencies, subpaths `.`, `./css`, `./color`,
`./names`.

`opal42`: the command line. `opal42 score` (files, directories or `-`), `refine`
and `parse`, with `--json`, `--format github`, `--min-score` (no default),
`--fail-on-unscorable`, `--fix`/`--dry-run`, `--ignore`, documented exit codes
and a stable JSON schema (`schemaVersion: 1`). The score is a smoothness score,
not a quality verdict.
