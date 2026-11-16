# Issue codes (scoring model v1)

Every point the score loses maps to one of these codes. Definitions, formulas and
constants: `spec/scoring-v1.md`. Severity follows the penalty: 12 or more is
`error`, 6-10 is `warning`, 5 or fewer is `info`. Dimension budgets: lightness 30,
hue 30, chroma 20, spacing 20 (the spec calls spacing "rhythm").

| Code | Dimension | What it means | One-line fix |
|---|---|---|---|
| `lightness/reversal` | lightness | A stop is darker or lighter than both neighbours | Put its lightness between its neighbours |
| `lightness/perceived-reversal` | lightness | A vivid stop looks brighter than its neighbour although its lightness is lower | Reduce that stop's chroma or lightness |
| `lightness/low-contrast` | lightness | All stops are within a small colour distance (below 0.05; below 0.02 is "invisible") | Widen the lightness or hue range, or accept a flat look on purpose |
| `lightness/abrupt-jump` | lightness | A large colour jump (above 0.15) squeezed into 10% or less of the line | Move the stops apart or add an intermediate stop |
| `lightness/uneven-speed` | lightness | The colour changes fast in one segment and slowly in others | Space stops in proportion to the colour distance between them |
| `hue/wide-arc` | hue | Hues span more than 120 degrees (more than 180 is "clash") | Bring hues within about 80-120 degrees |
| `hue/narrow-arc` | hue | Under 15 degrees: reads as a single hue (info only) | Fine if a monochrome gradient is wanted |
| `hue/direction-reversal` | hue | The hue path turns back on itself | Make hue move in one direction |
| `chroma/saturation-range` | chroma | Chroma differs a lot between stops (above 0.12 info, above 0.2 error) | Bring the chroma of the stops closer |
| `chroma/dead-zone` | chroma | A grey stop between vivid ones | Tint the grey toward the neighbouring hues, or drop it |
| `chroma/muddy-midpoint` | chroma | The sRGB midpoint of a segment loses most of its chroma | Add a vivid intermediate stop or use closer hues; `in oklab` helps rendering but not the v1 number |
| `chroma/banding` | chroma | Few 8-bit colour steps over a long segment (visible bands) | Widen the colour difference or shorten the segment |
| `rhythm/edge-gap` | spacing | Solid areas before the first and after the last stop | Start at 0%, end at 100% |
| `rhythm/narrow-span` | spacing | The transition covers under 40% of the line | Stretch the stops over more of the line |
| `rhythm/uneven-gaps` | spacing | Stop spacing varies a lot | Space stops evenly |

Skip codes (no score): `var`, `calc`, `env`, `currentColor`, `color-mix`,
`relative-color`, `lab-lch`, `color-function`, `system-color`, `unknown-color`,
`length-position`, `too-many-stops`, `interpolation-space`, `preprocessor`,
`syntax`, `unbalanced`, `too-long`, `too-deep`, `legacy-syntax`,
`unsupported-kind` (radial, conic), `alpha`, `repeating`, `too-few-stops`.
See `spec/parser.md` and `spec/api.md`.
