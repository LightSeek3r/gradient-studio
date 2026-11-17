# Determinism across Node versions and ports

The v1 engine (`@opal42/gradient`) gives **the same answer on every supported
Node version** (22 and 24, both in CI) and in the Python port. This page states
the guarantee precisely, explains the defect that broke it (D8), how it was
fixed, and lists every place in `packages/core/src` where a floating-point
comparison chooses something observable.

## The guarantee

For any input in the v1 domain, on every supported Node version:

| Output | Guarantee |
|---|---|
| `score`, `details.*` (integers), finding codes, severities, `pointsLost`, messages | identical |
| `findings[].stops`, `findings[].segment` (locations) | identical |
| `proposeFixes`: which findings get a fix, which stops it edits, the new colours / positions, `gain`, `label` | identical |
| `refine` / `suggestGradient`: output stops (colours, positions, ids), `declined` | identical |
| non-integer measurements (`details.measurements`: ΔE, arcs, CVs, chroma...) | agree to **1e-9 relative**, not bitwise |

Exception, documented since v1 was frozen: a **`boundary`** case (a measurement
within 1e-6 of one of its thresholds, flagged in `spec/vectors/v1-findings.json`)
may flip a threshold test, and therefore its score, between engines. That is a
property of a threshold model computed in floating point and is out of scope
here.

Residual events that are not boundary cases but can in principle still differ
(all are measure-zero for real inputs; none occurs in the vectors or in the
determinism goldens):

- an 8-bit channel value that lands within ~1e-13 of `.5` before rounding
  (`rgbToHex` / `linearToSrgb`), e.g. in a fix candidate's or refine's colour;
- two **neighbouring** stops of different colours whose OKLab `L` (or
  `L + 0.25·C`) agree to the last bits: `lightness/reversal` and
  `lightness/perceived-reversal` count interior extrema with exact `<` / `>`.
  That count is a score-affecting measurement, so it was left exact (making it
  tolerant would change v1 scores); 0 of the 316 corpus cases has such a pair;
- a computed value that lands within noise of the 1e-9 tie band edge itself.

## Defect D8: tie-dependent location / selection

`Math.pow`, `Math.cbrt`, `Math.atan2`, `Math.sin` and `Math.cos` are not
correctly rounded; their last bit differs between V8 versions, between
JavaScript and Python, and between platform libms. Measurements built from them
(OKLab, ΔE, hue) therefore differ by a few ulp, which the tolerant vector
comparator already absorbs. The real problem was **selection**: wherever an
exact `<` / `>` chose which stop, segment or candidate to report or edit, two
values that are equal in exact arithmetic were ordered by noise.

Reproduction (before the fix): `#00a600@0 #00ff00@50 #006900@100`. All three
greens have the same OKLCH hue (linear sRGB `(0, g, 0)` scales `l, m, s`
together, so `a/b` is constant) up to ~1e-13°. `hue/narrow-arc` named stops
`[0, 2]` on Node 22 and `[0, 1]` on Node 24, so `proposeFixes` edited stop 2
(`#4b5f00`) on Node 22 and stop 0 (`#799600`) on Node 24, both with gain 5. The
Python port found the same class of defect independently
(`lightness/uneven-speed` on 3-stop gradients, see `docs/python.md`).

### The fix: one mechanism, `src/tolerance.ts`

- `EPS = 1e-9`, applied as `|a − b| <= EPS · max(1, |a|, |b|)` (`approxEq`):
  relative above magnitude 1 (hue degrees, positions in percent), absolute
  below (L, C, ΔE, velocities, dips, costs).
- `argBest(values, "min" | "max")`: values within EPS of the extreme are ties;
  the **lowest index** wins (an index into the position-sorted stops, or into
  the candidate list).
- `roundHalfUp(x)`: a value within EPS of `k + 0.5` rounds up, like an exact half.
- `quantize(x)`: a sort key snapped to the EPS grid, so a sort with ties is a
  strict total order (a comparator that answers "equal within EPS" is not
  transitive, and `Array.prototype.sort` with such a comparator is
  implementation-defined).

Why 1e-9: engine noise is below 1e-13 absolute on values of order 1-360;
genuine differences between 8-bit colours are above 1e-7 (adjacent 8-bit
colours differ by ~1e-3 in OKLab and ~1e-2° in hue). The band is four orders
of magnitude above the noise and two below anything an author can produce.

What it does **not** change: measurements (the enclosing arc, CVs, ranges,
dips are the same numbers as before) and threshold tests. Only the choice
among near-equal candidates.

### Tie rules

| Selection | Rule |
|---|---|
| `lightness/uneven-speed`, `rhythm/uneven-gaps` location | the segment whose deviation from the mean is largest; deviations within EPS tie, the **first segment** wins. (With two segments, every 3-stop gradient, the two deviations are equal in exact arithmetic, so this is always the first segment.) |
| `hue/wide-arc`, `hue/narrow-arc` stops | hues within EPS are **equal** (chained, also across the 0°/360° seam); the old rule is applied to the (hue, index) order with that equality: the arc **starts at the lowest index** of the group after the largest gap and **ends at the highest index** of the group before it. When all chromatic hues tie (arc ≈ 0) that is the group's lowest and highest index. When several gaps tie for largest, the one whose start has the lowest index wins. The highest index for the end is what exact duplicates (the same colour twice) always gave, so no exact-duplicate case changed. |
| `chroma/saturation-range` stops | most and least saturated stop; ties to the lowest index |
| `chroma/muddy-midpoint` segment | worst dip; ties to the first segment |
| `refine` degenerate centre | first-to-last chromatic arc within EPS of 180° counts as exactly 180° (towards increasing hue, as specified) |
| `proposeFixes` pick | among candidates that recover the most points, the cheapest; costs within EPS tie, the **first candidate** in generation order wins (was: a sequential scan with a 1e-12 slack) |
| `proposeFixes` candidate generation | "is b lighter than a" with equal L (within EPS) is yes; the signed hue arc within EPS of 180° is +180°; a position target within EPS of a half rounds up |
| `nearestColorName` | equidistant names (within EPS) go to the first in table order |
| `bakeStops` (export) | largest-remainder apportionment; remainders within EPS tie to the earlier segment (as the code always intended) |

The frozen reference copies used by the performance differential tests
(`packages/core/tests/reference/*-v1-ref.ts`) were changed **in lockstep**
(each edit marked `D8 (lockstep)`), so the differential tests still prove that
the optimised code equals the reference. The Python port implements the same
rule (`ports/python/src/opal42_gradient/_tolerance.py`).

## Audit: every float comparison that selects something observable

`file:line` refers to `packages/core/src` at the time of the fix. "Fixed" =
now uses `tolerance.ts`; "threshold" = a genuine v1 threshold test on a
score-affecting measurement (boundary behaviour, unchanged); "exact" = only
correctly rounded `+ − × ÷` on positions or integers, identical on every
IEEE-754 engine.

| # | Where | What it selects | Status |
|---|---|---|---|
| 1 | `gradient-engine.ts:280` `mostDeviant` (used at `:641` velocity, `:832` gaps) | segment of `lightness/uneven-speed`, `rhythm/uneven-gaps` | **fixed** (`argBest`) |
| 2 | `gradient-engine.ts:300` `hueArcEnds`, used at `:670` | stops of `hue/wide-arc` / `hue/narrow-arc` | **fixed** (tie groups) |
| 3 | `gradient-engine.ts:727` | stops of `chroma/saturation-range` (was `indexOf(max/min)`) | **fixed** (`argBest`) |
| 4 | `gradient-engine.ts:772` | segment of `chroma/muddy-midpoint` (was `dip > worstDip`) | **fixed** (`argBest`) |
| 5 | `gradient-engine.ts:963` `refineGradient` | degenerate hue centre, `d <= 180` | **fixed** (`approxEq`) |
| 6 | `api/fixes.ts:569` | the fix returned per finding (`cost` tie-break, was `b.cost < pick.cost - 1e-12`) | **fixed** (`argBest`) |
| 7 | `api/fixes.ts:201` | direction of the "push the ends apart" lightness candidates | **fixed** (`approxEq`) |
| 8 | `api/fixes.ts:121` `arcTo` | direction of hue targets at exactly opposed hues | **fixed** (`approxEq`) |
| 9 | `api/fixes.ts:324` `place` | position candidate when the target is a half | **fixed** (`roundHalfUp`) |
| 10 | `color-formats.ts:233` `nearestColorName` | nearest CSS name | **fixed** (`argBest`) |
| 11 | `api/document.ts:223` `bakeStops` | which segments get the extra baked samples | **fixed** (`quantize`); was already engine-independent (exact arithmetic) but broke its own "ties to the earlier segment" rule by rounding; one export golden (`export-manyStops.json`, OKLab bake) changed accordingly |
| 12 | `gradient-engine.ts:263` `interiorExtrema` (`:569`, `:586`), mirrored in `api/fix-persistence.ts:80` | stops of `lightness/reversal`, `lightness/perceived-reversal` **and their count** (score) | unchanged: score-affecting; see residual events above |
| 13 | `gradient-engine.ts:614` abrupt jump, `:784-790` banding (first hit), `:699` hue direction signs, `:655` and coherence chromatic / achromatic classification | first segment over a threshold, stops by class | threshold |
| 14 | `gradient-engine.ts:441`, `:396` (`hueOrder`, `sortByHue`), `api/fix-persistence.ts:175-197` | order of stops by hue | used only for the arc measurement (gap values do not depend on the order of equal hues) and for pruning; locations come from row 2 |
| 15 | `api/fixes.ts:267` (`d >= |gap|`), `:307` (`target > 0`), `api/fixes.ts:125` `encode` | candidate set, quantised candidate colours | threshold-adjacent / 8-bit rounding: measure-zero (residual events) |
| 16 | `api/fixes.ts` dedupe key (`seen`), `evaluated` cache | candidate identity | exact (hex strings and integer positions) |
| 17 | `gradient-engine.ts` refine hard-stop groups, even slots; `api/score.ts:72` hard-stop flag; `css/parse.ts:532` gradient order; `export.ts:238`, `:476`, `:517` rounding of angles/positions | groups, slots, order | exact |
| 18 | `export.ts:242` channel rounding of sampled colours | baked / converted colours | 8-bit rounding: measure-zero |
| — | `experimental/` | v2 model | not audited (experimental, not frozen) |

## Vectors

Regenerating the v1 vectors changed **4 of 316** `v1-findings.json` cases (all
`lightness/uneven-speed` on 3-stop gradients, now the first segment); every
other case in every file is byte-identical. `npm run vectors:diff` classifies
each change as D8 by an input predicate (`d8Ties` in
`packages/core/scripts/vector-lib.ts`: two candidates whose deciding values agree
within EPS), and requires that only the located finding's `stops` / `segment`
moved. Details: `spec/vectors/CHANGES-v1.md`, section D8.

## Tests

- `packages/core/tests/determinism.test.ts`: the reproduction above; same-hue
  families (green, red, blue, yellow, magenta, cyan), palindromes and 3-stop
  gradients, each compared with a golden file generated on Node 22
  (`tests/golden/determinism-families.json`) and across every permutation of
  the input array and repeated runs. Before the fix this test fails on Node 24.
- `packages/core/tests/tolerance.test.ts`: the helpers, and seeded property
  tests that perturb planted ties by 1e-12 and assert the selection does not move.
- `packages/stylelint-plugin/tests/fix.test.ts`: the `min(99)` autofix of
  `#00a600, #009000 50%, #006900` now edits the last stop (`#4b5f00`; was
  `#799600`, an engine-dependent choice); both score 100.
- `ports/python/tests/test_tolerance.py`: the same rule in Python, including a
  run with the platform `math.cbrt` (which used to move 5 vector locations).
- CI runs the `verify` job on Node 22 and Node 24 (`fail-fast: false`).

## Reproducing on Node 24 locally

```sh
# a Node 24 binary without changing the system one
N24=$(npx -y -p node@24 -c 'dirname "$(which node)"')
PATH="$N24:$PATH" node -v                       # v24.x
PATH="$N24:$PATH" npm test                      # whole suite on Node 24
PATH="$N24:$PATH" npx vitest run tests/determinism.test.ts   # in packages/core
```

Do not regenerate the vectors or the determinism golden on another Node
version than the one that produced them without reviewing the diff: under this
guarantee the only acceptable differences are float measurements within 1e-9.
