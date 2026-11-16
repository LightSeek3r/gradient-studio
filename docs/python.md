# Python port (`opal42-gradient`)

`ports/python` is a **pure-Python port of scoring model v1**: standard library
only, zero runtime dependencies, Python 3.10 or newer, fully typed. It is the
first port made under the contract of [`PLAN.md`](PLAN.md) section 3.3 (ports are on
demand and read the vectors only), and it doubles as a check that the contract
is enough to write one: [`spec/scoring-v1.md`](../spec/scoring-v1.md) and
`spec/vectors/*.json` were the only inputs besides the TypeScript reference.

Status: **not published**. `opal42-gradient` is a working name; nothing has been
uploaded to PyPI and no name has been reserved there (PEP 541 forbids
squatting). Publishing, and checking the name, is a later step for the owner. The
package performs no I/O: no network, files, environment, clock, randomness or
telemetry ([`PRIVACY.md`](../PRIVACY.md), [`SCOPE.md`](../SCOPE.md)).

## What is ported, and what is not

Ported (names are the TypeScript names in `snake_case`; positions are percentages
0-100 and channels 0-255, the legacy engine's units):

| TypeScript | Python |
|---|---|
| `scoreGradient`, `unscorableReason`, `isValidStopColor` | `score_gradient`, `unscorable_reason`, `is_valid_stop_color` |
| `suggestGradient`, `refineGradient` | `suggest_gradient`, `refine_gradient` |
| `buildGradientCSS`, `buildMultiGradientStyle`, `spreadDirectionAngles` | `build_gradient_css`, `build_multi_gradient_style`, `spread_direction_angles` |
| `interpolateGradient`, `colorAtPosition` | `interpolate_gradient`, `color_at_position` |
| `srgbToLinear`, `linearToSrgb`, `hexToRgb`, `rgbToHex`, `rgbToOklab`, `oklabToRgb`, `oklabToLinearRgb`, `oklabToLch`, `lchToOklab`, `hexToOklch`, `oklchToHex` | same names in `snake_case` |
| `parseHex`, `parseRgb`, `parseHsl`, `parseName`, `parseAnyColor` | `parse_hex`, `parse_rgb`, `parse_hsl`, `parse_name`, `parse_any_color` |
| `formatHex/Rgb/Hsl/Name/NameDisplay`, `nearestColorName`, `CSS_NAMED_COLORS` | `format_*`, `nearest_color_name`, `CSS_NAMED_COLORS` (148 names) |
| `rgbToHsl`, `rgbToHslPrecise`, `hslToRgb`, `hexToHsl`, `hexToHslPrecise`, `hslToHex` | same, in `snake_case` |
| `gamutFitOklch`, `oklchToHexFitted`, `complementHex` | `gamut_fit_oklch`, `oklch_to_hex_fitted`, `complement_hex` |
| `V1_MODEL`, `V1_BOUNDARY_TABLE`, `boundaryHits`, `V1_FINDING_CODES` | `V1_MODEL` (frozen dataclasses), `V1_BOUNDARY_TABLE`, `boundary_hits`, `V1_FINDING_CODES` |

Results are frozen dataclasses (`GradientScore`, `Finding`, `ScoreDetails`,
`ScoreMeasurements`, `RefineResult`, `Stop`); stops may be given as `Stop`,
`(color, position)` pairs or mappings with `color`, `position` and optional `id`.

**Not ported** (each needs a separate port, with its own vectors or corpus):

- the **gradient-string parser** `parseGradient` / `scoreParsed` ([`spec/parser.md`](../spec/parser.md));
- the **document API** of [`spec/api.md`](../spec/api.md): `score(doc)`, `refine(doc)`,
  `proposeFixes`, `toCSS`, `bakeStops`, `sampleGradient`, `resolveStops`;
- the **exporters** (`@opal42/gradient/export`: Tailwind, SCSS, SVG, native snippets, DTCG, Figma);
- OKLab-aware features outside v1 (scoring model v2 does not exist yet).

The conformance target is exactly the vectors for **score, findings, suggest,
css, interpolate and color**. Behaviour outside them (for example the
`hex_to_rgb` of a malformed string, below) is the port's own choice and is
documented where it differs.

## Conformance results

Run `python3 scripts/check_conformance.py` in `ports/python`. Policy
([`PLAN.md`](PLAN.md) 3.3, `tests/conformance.py`):

- **Non-boundary case:** must match **exactly**: integer scores and details, finding
  `code` / `severity` / `dimension` / `pointsLost` / `stops` / `segment` / `message`
  (and key order), `issues`, unscorable `reason`, every hex and CSS string, integer
  channels. Floating-point measurements must agree within relative 1e-9 / absolute
  1e-12.
- **Boundary case** (`boundary: true`, a measurement within 1e-6 of a threshold):
  only the measurements are required, within the same tolerance. Whether the
  integers happened to match is counted separately.
- `v1-suggest.json` has no flag of its own; a suggest case counts as boundary when
  the same-named `v1-findings.json` case is flagged. `v1-interpolate.json` and
  `v1-css.json` have no thresholds, so every case is exact.
- The port also computes `boundary_hits()` itself; it equals the vector's
  `boundaryHits` for all 316 findings cases.

Result (Python 3.10, 3.11, 3.12 and 3.13 on x86-64 Linux, glibc 2.39; identical on all four):

| vectors | cases | compared exactly | boundary | boundary, integers also exact | mismatches |
|---|---:|---:|---:|---:|---:|
| `v1-score.json` | 316 | 309 | 7 | 7 | 0 |
| `v1-findings.json` | 316 | 275 | 41 | 41 | 0 |
| `v1-suggest.json` | 316 | 275 | 41 | 41 | 0 |
| `v1-interpolate.json` | 316 | 316 | 0 | 0 | 0 |
| `v1-css.json` | 319 + 1 | 320 | 0 | 0 | 0 |
| `v1-color.json` | 156 | 156 | 0 | 0 | 0 |
| **total** | **1740** | **1651** | **89** | **89** | **0** |

(`v1-css.json`'s extra case is its `spreadDirectionAngles` table, 15 entries.)
The 89 boundary cases are not skipped: their measurements are checked like
everyone else's. 33 of the 41 findings-boundary cases are only boundary because a
segment gap equals 10 or 25 exactly (integer positions, so no floating-point
question arises); in fact all 89 boundary cases also match exactly.

Floating-point values compared against the vectors: **9,804**, of which **9,014
(91.9%) are bit-identical**; the largest relative error of any value of magnitude
>= 1e-6 is 8.2e-13 and the largest absolute error 4.0e-13, both in hue-derived
measurements (`hueSteps`, `enclosingArc`): a hue is an `atan2` of two small numbers
and is ill-conditioned for low-chroma colours, so one-ulp differences in `a` / `b`
become ~1e-13 degrees. The tolerance (1e-9) is 1000x wider than the worst case
seen, and the boundary band (1e-6) 10^6 wider than the integer-relevant noise.

Besides the vectors, the suite has property tests over seeded random inputs (no
NaN, integer scores 0-100, every lost point explained by a finding, permutation
invariance, refine never lowers the score and keeps hard / achromatic stops,
interpolation always returns valid hex, garbage input never raises), unit tests of
the JavaScript-semantics helpers, and consistency tests: every `` `V1_MODEL.x` = v ``
line of `spec/scoring-v1.md` is checked against the Python model, every finding
code has a spec section, and the generated name table is checked against the
TypeScript source. 58 tests in total (one, comparing with `math.cbrt`, is skipped on Python 3.10), about 6 seconds.

**The harness does bite.** Re-running it with deliberate faults:

| fault | result |
|---|---|
| Python `round()` instead of `Math.round` in the muddy-midpoint and refine-slot code | 122 of 316 score cases, 122 findings cases and 14 suggest cases fail |
| Python `round()` everywhere | the above, plus 4 colour cases |
| `math.cbrt` (platform libm) instead of the V8 algorithm | 5 findings cases fail (see "ties" below) |
| `x ** (1/3)` as cube root | 3 findings cases fail |
| `sum()` instead of a left-to-right loop, Python `%` instead of `fmod`, banker's rounding only in the colour conversions | **no vector fails** (see below) |

## Portability notes (JavaScript versus Python)

PLAN section 3.3 predicted the first two; the others were found while porting.

### 1. `Math.round` rounds half up; Python's `round` rounds half to even

`Math.round(2.5) === 3`, `Math.round(-2.5) === -2`; `round(2.5) == 2`.
`js_round` in `_jsnum.py` reproduces `Math.round` exactly (not as
`floor(x + 0.5)`, which is wrong for `0.49999999999999994`). Every place the
reference rounds, and the port's counterpart:

| Reference | What | Port |
|---|---|---|
| `gradient-engine.ts:108` `linearToSrgb` | 8-bit channel from linear light | `colorspace.linear_to_srgb` |
| `gradient-engine.ts:128` `rgbToHex` | channel to hex digits | `colorspace.rgb_to_hex` |
| `gradient-engine.ts:539-541` | the **8-bit sRGB midpoint** `(a + b) / 2` of the muddy-midpoint rule | `engine.score_gradient` |
| `gradient-engine.ts:801` | refine's even position slots `g / (G - 1) * 100` | `engine.refine_gradient` |
| `gradient-engine.ts:877` | alpha to three decimals in `rgba(...)` | `engine._rgba_string` |
| `gradient-engine.ts:936` | `spreadDirectionAngles` | `engine.spread_direction_angles` |
| `color-formats.ts:279` | `rgbToHsl` (h, s, l) | `formats.rgb_to_hsl` |
| `color-formats.ts:300-302` | `hslToRgb` channels | `formats.hsl_to_rgb` |
| `color-formats.ts:387` | `parseRgb` channels | `formats.parse_rgb` |

The muddy-midpoint rule is the one that matters in practice: whenever two
endpoint channels have an odd sum the midpoint lands on `.5`, and banker's rounding
would pick the even neighbour half the time. With Python's `round` there, 122 of
316 corpus cases get the wrong score. (Ties inside the colour conversions are
measure-zero events for real inputs, which is why no vector distinguishes them;
the port uses `js_round` there too.)

### 2. `%` is `fmod` in JavaScript, floored modulo in Python

The reference wraps angles as `((x % 360) + 360) % 360`. Python's `%` returns a
different last bit for negative `x`. The port uses `math.fmod` (`js_fmod`) wherever
the reference uses `%` on a float (12 places). No current vector tells the two apart, so
this is again conformance by construction.

### 3. `Math.cbrt` is not `math.cbrt` (and `math.cbrt` needs Python 3.11)

OKLab takes cube roots of three sums per colour. V8's `Math.cbrt` is a port of
FreeBSD's `s_cbrt.c` (error < 0.667 ulp); glibc's `cbrt` is a different
algorithm. Measured against Node 22 on 2,001 inputs in [0, 1]: the port's
`js_cbrt` (the FreeBSD algorithm, ~30 lines, standard library `struct` for the
bit work) is **bit-identical on all 2,001**; the platform `math.cbrt` on 904
(45%), up to 3 ulp away. Because of the ties below this is not cosmetic. The port
uses its own implementation on every Python version, so scores do not depend on
the interpreter version or platform libm for this function.

### 4. `sum()` is no longer a left-to-right sum (Python 3.12+)

`sum([0.1] * 10)` is `0.9999999999999999` on Python 3.11 (like JavaScript's
`reduce`) and `1.0` on 3.13, where `sum` of floats uses compensated summation.
All means and variances in the port are explicit loops (`_total`,
`_population_cv`). The vectors do not currently distinguish the two (an experiment
with `sum()` passes), so this is conformance by construction rather than by test.

### 5. Other semantic differences, all handled

- **Regular expressions.** JavaScript `$` matches only at the very end; Python's
  also before a final `\n`. `\d`, `\s`, `\b` and `/i` differ for non-ASCII input
  (JavaScript `\s` includes U+FEFF; Python's `str.strip` strips U+001C-U+001F but
  not U+FEFF). The port uses `fullmatch` / `\Z`, `re.ASCII`, explicit
  `[0-9]` classes, and a JavaScript whitespace set (`JS_WHITESPACE`, `js_trim`).
  `"#ff0000\n"` is **not** a valid stop colour, in either language.
- **Number printing.** `1.0` prints as `1`, `1e-7` as `1e-7`, `1e21` as `1e+21`
  (`js_number_str`), in CSS strings, messages and `unscorable` reasons.
  `JSON.stringify` of a colour in a reason is `json.dumps(..., ensure_ascii=False)`.
- **`parseFloat`** takes the longest numeric prefix (`"1.5 %"` is 1.5); Python's
  `float()` rejects it (`js_parse_float`).
- **`**2`** is written `x * x` (what V8 computes, and what Python's `pow` gives).
- **Stable sorts**, `indexOf` (first match) and `Math.max` / `min` behave the same.
- **Object key order** is part of the reference's finding output; the harness
  checks it.
- **Garbage hex.** `hexToRgb("zz")` returns NaNs in TypeScript; `hex_to_rgb` raises
  `ValueError`. Scoring, CSS and interpolation validate first and never raise.

### 6. Transcendental functions are the platform's, and differ in the last bit

`pow`, `sin`, `cos` and `atan2` come from the C library (`math.*`); V8 uses its own
fdlibm-derived implementations. Measured against Node 22.23 (V8 12.4) on glibc 2.39 (the repository's CI uses Node 24):

| function | bit-identical | max difference |
|---|---:|---:|
| `pow(x, 2.4)`, sRGB to linear (256 inputs) | 224 (87.5%) | 1 ulp |
| `pow(x, 1/2.4)` (2,001) | 1,789 (89.4%) | 1 ulp |
| `sin` / `cos` of a hue (3,601 each) | 96.8% / 96.1% | 1 ulp |
| `atan2` (2,000) | 83.3% | 1 ulp |

These are the source of the 8% of float values that are not bit-identical in the
conformance run; none of them changed a single integer, string or finding.
The port did not reimplement them: it would cost ~600 lines (fdlibm `pow`,
`sin`/`cos` with argument reduction, `atan`) for a difference the 1e-6 boundary
band already absorbs. A port to a language with a different libm (Rust, Swift,
Kotlin) will see the same kind of noise and the same remedy applies: match
non-boundary cases exactly, boundary cases on measurements.

### 7. Finding for the spec: `mostDeviant` ties on 3-stop gradients

`lightness/uneven-speed` is located at the segment whose velocity deviates most
from the mean (first on ties). With exactly **two velocity segments** (every
3-stop gradient, or 4 stops with a zero gap) the two deviations are *equal in exact
arithmetic*: `|v0 - m|` and `|v1 - m|` with `m = (v0 + v1) / 2`. Which one is
"larger" is therefore decided by the last bit of `v0`, `v1`, i.e. by the last bit of
the OKLab distances, i.e. by `cbrt` and `pow`.

In the vectors, **10 of the 93 cases that have an `uneven-speed` finding** are in
this situation (relative gap between the two deviations: 4 exactly 0, 6 of about
1e-16 to 3.4e-16): `abrupt jump 5%`, `abrupt jump 10%`, `abrupt jump 11%`,
`random #29 (n=4)`, `#84`, `#112`, `#118 (shuffled)`, `#170`, `#172`, `#180`.
None is flagged `boundary`, yet their `stops` / `segment` (but not the score)
depend on sub-ulp noise: replacing V8's cube root with the platform's flips the
location in 5 of them (the mismatches listed in the table above). The score and
the finding code are unaffected, because the penalty does not depend on which
segment is named.

This is a **portability finding, not a defect of the port**. Proposals (the v1
vectors were not touched):

1. add a boundary annotation for *location* ties: mark a case `boundary` (or a new
   `locationTie: true`) when the relative gap between the largest and second
   largest deviation is below 1e-9, and have ports compare `stops` / `segment` of
   that finding only on non-tie cases;
2. in model v2, define the tie rule explicitly (for two segments: the segment with the
   larger velocity), so the result is a function of the measurement and not of its
   rounding. `rhythm/uneven-gaps` has the same shape but is safe: gaps are
   differences of positions, computed with correctly rounded `+ - * /` only, which
   every IEEE-754 language reproduces bit for bit.

### 8. Other observations

- Grey and near-grey colours have `a`, `b` of order 1e-8 to 1e-11 (`#808080`:
  `a = 4.86e-11`), pure rounding noise, so their OKLCH **hue** is arbitrary and
  differs between libms. The conformance harness skips the hue of colours with
  chroma below 1e-6 (the chroma and everything the score uses is compared). The
  score never reads the hue of a stop with chroma <= 0.02.
- `v1-score.json`'s boundary flag is computed from 9 measurements only
  (`LEGACY_MEASUREMENTS`) while `v1-findings.json` uses all of them (7 versus 41
  flagged cases); the harness follows each file's own flag.

## How to run

```sh
cd ports/python
python3 -m unittest discover -v          # everything; pytest also works if installed
python3 scripts/check_conformance.py     # summary; exit 1 on mismatches, 2 if spec/vectors is missing
python3 scripts/gen_names.py --check     # name table in sync with packages/core/src/color-formats.ts
python3 -m mypy                          # optional: strict typing (mypy is not required)
```

No installation and no network are required. The vectors are found by walking up
from `tests/` to `spec/vectors/`; set `OPAL42_VECTORS_DIR` to use another
directory. `pip install ./ports/python` (a minimal setuptools `pyproject.toml`; pip fetches
setuptools for the isolated build, or use `--no-build-isolation` offline) installs
the package without dependencies. CI runs the suite on Python 3.10 and 3.13 (`.github/workflows/ci.yml`,
job `python-port`).

## Maintaining the port

- The TypeScript engine is the reference. A change to `V1_MODEL`, a rule or a
  vector must be mirrored here; `tests/test_spec.py` fails on any numeric drift of
  the model table, and the vectors fail on any behavioural drift.
- The name table is generated (`scripts/gen_names.py`); never edit
  `_names_table.py` by hand.
- Per PLAN D6 a port is a permanent maintenance tax. If nobody uses it, archive it
  rather than let it drift.
