# Gradient smoothness score — model v2 (research draft, NOT frozen)

Status: **research document + experimental prototype.** Nothing here is a
contract. The prototype is `scoreV2` in
[`packages/core/src/experimental/v2.ts`](../packages/core/src/experimental/v2.ts),
exported only from the opt-in subpath `@opal42/gradient/experimental`, and it
reports `scoringModel: "v2-experimental"`. Core keeps shipping v1 as its only
model and v1 stays the default everywhere (PLAN §3.5, D8). v1 is frozen
([`scoring-v1.md`](scoring-v1.md)); nothing in this document changes it.

Every threshold in `V2_MODEL` is marked *tuning not validated*. Some are copied
from `V1_MODEL` because the rule carries over unchanged (a test checks the
copies); the rest are first guesses, justified below where a justification
exists and labelled as guesses where it does not. No human data backs either
set (PLAN D5). A v2 number is a **smoothness score by a stated definition**,
not a measure of quality.

Experiment results (v1 vs v2 over the v1 corpus) are in
[`docs/v2-experiments.md`](../docs/v2-experiments.md).

---

## 1. Problem statement

v1 scores the **stop list**: OKLAB/OKLCH values of the stops, their positions,
and one sRGB-specific probe (the 8-bit midpoint of each segment, rule 3c). The
browser does not paint the stop list. It paints a **path**: for each pixel on
the gradient line it interpolates between the two neighbouring stops in the
document's interpolation space (`in srgb` by default for hex stops, or
`in oklab`, `in oklch [shorter|longer|increasing|decreasing] hue`), converts
the result to the display and quantises it. Two documents with identical stops
and different interpolation look different, and v1 gives them the same score.

Concretely, v1 is wrong or silent in these cases (all verified with the
prototype, see the tests):

| Case | What the browser paints | What v1 says |
|---|---|---|
| `#ff0000 → #00ff00` `in oklch` | a saturated red–orange–yellow–green path (with a gamut excursion, §5.1) | −10 "muddy midpoint" (it always probes the sRGB midpoint) |
| `#ff0000 → #00ff00` default sRGB | a dark, desaturated olive middle (L dips from 0.63 to ≈ 0.55) | −10 muddy, but no lightness finding: the dip is between the stops |
| two hues 300° apart, `in oklch longer hue` | a 300° rainbow | the same as `shorter`: v1 sees a 60° arc |
| `#808080 → #ff0000` `in oklch longer hue` | per the spec text, a full 360° rainbow growing out of grey (§5.3) | 2 stops, nothing about hue |
| `#faf8f5 → #0000ff` `in oklch` | the off-white's invisible hue (≈ 80°) steers the path through green before blue | nothing about hue |
| `#0000ff → #ffffff` default sRGB | a purple cast (hue drifts ≈ 22° from blue) | nothing about hue |
| a dark 2-stop ramp with 20 8-bit levels over the whole line | 50 px bands at 1000 px | nothing (v1's banding needs < 16 levels) |

The review of the plan (`docs/plan-research/review.md`, item 5) named the four
problems a v2 has to solve: the muddy-midpoint rule is moot under `in oklch`;
the ">180° arc" rule must be defined per hue path; banding uses 8-bit sRGB
endpoint deltas that are wrong for non-sRGB paths; and new failure modes exist
(gamut excursion mid-path, unexpected hues on the path, powerless hue on grey
stops). This document answers each.

## 2. The model: sample the rendered path

**Input.** A `GradientDocument` (spec/api.md): linear, not repeating, at least
two stops, every stop an opaque `#rrggbb`, positions resolved by the CSS rules
(`resolveStops`) and inside 0–1. Interpolation is `doc.interpolation`, or
`opts.interpolation` when given, or sRGB when both are absent.

*Why sRGB is the default.* CSS Color 4 makes Oklab the default interpolation
space for host syntaxes that do not name one, **except** that interpolation
between legacy sRGB colour forms (hex, named, `rgb()`, `hsl()`, `hwb()`) is done
in gamma-encoded sRGB. All stops in the v1/v2 domain are hex, so the default is
sRGB. If a later domain admits `oklch()` stops, the default for such documents
is Oklab and the prototype's default must follow.

**Output.** The v1 result shape — `{status, score, dimensions, issues,
analysis}` — with `scoringModel: "v2-experimental"` plus `measurements`
(`V2Measurements`). Outside the domain: `{status: "unscorable", code, reason}`
with the same codes as `score` (`invalid-document`, `unsupported-kind`,
`repeating`, `too-few-stops`, `invalid-color`, `invalid-alpha`, `alpha`,
`invalid-position`, `position-range`, and `engine` if something throws).

**The rendered path.** For a position *t* in segment *i* (stops *i*, *i+1*
with gap > 0), let *u* = (t − tᵢ)/(tᵢ₊₁ − tᵢ). The intended colour is

- `srgb`: componentwise lerp of the gamma-encoded channels (0–1, not rounded);
- `oklab`: lerp of `L, a, b`;
- `oklch`: lerp of `L`, `C`, and of the fixed-up hues *h₁′, h₂′* (§5.3), with
  CSS Color 4 *missing-component* handling: a stop whose hue is **powerless**
  (C ≤ `V2_MODEL.color.powerlessChromaAtMost` = 0.000004) has a missing hue
  and takes the other stop's hue before the fix-up; when both are missing the
  hue stays missing (C is then ≈ 0 and the hue irrelevant).

The ends (`u = 0`, `u = 1`) are the stop colours exactly. Outside
`[first, last]` the end colours extend (solid zones, scored by the unchanged
rhythm rules). At a hard stop (two stops at one position) both colours are
sampled at the same *t*: a jump with Δt = 0. A zero-width stop between two
hard stops is never painted and never sampled; the first and the last stop
colours are always sampled because they are always painted.

Premultiplication is a no-op for opaque stops (§7 covers alpha).

**Display model.** An sRGB display, 8 bits per channel, no dithering. The
intended colour is mapped to the display by

- `gamutMapping: "css4"` (default): the CSS Color 4 algorithm *CSS gamut
  mapping to an RGB destination*: L ≥ 1 → white, L ≤ 0 → black, in gamut →
  unchanged; otherwise if the per-channel clip is within JND = 0.02 (OKLAB ΔE)
  of the colour, the clip; otherwise a binary search on OKLCH chroma (ε =
  0.0001) for the most chromatic colour whose clip is within JND, then its
  clip;
- `gamutMapping: "clip"`: per-channel clamp of the gamma-encoded values.

"In gamut" allows `V2_MODEL.color.gamut.channelTolerance` = 1e-6 per
gamma-encoded channel, so stops themselves (which round-trip through OKLAB with
~1e-9 error) are in gamut.

*Where browsers differ (not verified in this environment, which has no
browser).* To our knowledge, engines have not uniformly shipped the CSS
Color 4 gamut-mapping algorithm for painting; colours outside the display
gamut are commonly clipped per channel, and on a wide-gamut (Display P3)
screen an "out of sRGB" sample inside P3 is shown unclipped. The prototype
therefore exposes both mappings; on the v1 corpus under `in oklch` they change
13 of 306 scores (max |Δ| 14, docs/v2-experiments.md). A display-gamut
parameter (sRGB vs P3) is future work (§12 Q6). Whether engines dither
gradients (which hides 8-bit bands) is also engine- and platform-dependent and
unmodelled.

**Note on the existing helper.** `sampleGradient`/`bakeStops` gamut-map by pure
chroma reduction (`gamutFitOklch`) and use a different powerless threshold
(1e-5). That is fine for export baking; it is not what CSS Color 4 specifies,
so v2 does not reuse it.

## 3. Sampling

### 3.1 Base grid

Each segment with gap *g* > 0 is split into
`m = max(minIntervalsPerSegment, ⌈intervalsPerUnit · g⌉)` equal intervals
(`intervalsPerUnit` = 256, `minIntervalsPerSegment` = 8), sampled at
`u = k/m`, k = 0…m; neighbouring segments share their stop sample.

Why 256 per unit (≈ 3.9 px on a 1000 px line):

1. **Hue resolution.** The longest single-segment hue travel is < 360°
   (`longer`); at 256 intervals per unit a full-width segment moves ≤ 1.4° per
   interval, well under the smallest hue threshold used (5°, direction rule).
2. **Colour resolution.** The largest OKLAB distance between two sRGB colours
   is ≈ 1.0 (black–white) and paths are at most ~1.5 long (longer-hue rainbows);
   per interval that is ≤ 0.006, below half a JND (0.02), so a
   piecewise-linear reading of the path cannot miss a JND-sized feature except
   where the path has a kink (gamut boundary) — which refinement handles.
3. **8-bit resolution.** A channel sweeping 0–255 over the whole line changes
   ≈ 1 level per interval, so the Chebyshev path length used by the banding
   rule (§6) is resolved at about one level.
4. **Cost.** ≈ 257 samples for any gradient whose segments are long, plus
   8 per short segment.

The minimum of 8 intervals per segment keeps short segments (a 1 % gap gets
⌈2.56⌉ = 3 intervals from the base rate) from being read as straight lines.

### 3.2 Adaptive refinement

Up to `refine.maxPasses` = 4 passes; each pass bisects (inserts the midpoint
of) every interval that

- has displayed ΔE > `refine.deltaEAbove` = 0.01 (half a JND: a jump the grid
  did not resolve, typical of short segments), or
- straddles the gamut boundary (one end in gamut, the other not), or
- sits at a turn of more than `refine.turnAboveDeg` = 20° between consecutive
  OKLAB chords (kinks from gamut mapping, sRGB paths bending near grey).

Intervals are visited segment by segment, left to right; at most
`refine.maxExtraSamples` = 256 samples are added in total. The order is fixed,
so the result is deterministic.

### 3.3 Cost bound

Samples S ≤ Σ_segments (⌈256 g⌉ + 8) + 1 + (hard-stop duplicates ≤ n) + 2
(edge stops) + 256 (refinement) ≤ 516 + 10 n for n stops (≤ 596 for 8 stops;
typically ≈ 260–520). Each sample costs one conversion plus, when out of gamut
under `css4`, at most ⌈log₂(C/ε)⌉ ≈ 13 bisection steps. Rules are O(S), except
the path diameter (O(S²), ≈ 160 k distance evaluations at S = 570) and the
visited-hue arc (O(S log S)). Measured on the built package: see
docs/v2-experiments.md (target < 5 ms for 8 stops).

All measurements that are sums over samples are time-weighted (by Δt) or
taken over fixed windows, so refinement changes them only by resolving the
path better, never by over-weighting refined regions.

## 4. Rules

Notation: ΔE = Euclidean OKLAB distance. "Displayed" = after gamut mapping.
Positions are 0–1 in locations (`segment`), and the rules carried over from v1
use the same percent rounding as the v1 adapter so that they agree with v1
bit for bit. Tiers, penalties and severities follow the v1 conventions
(≥ 12 error, 6–10 warning, ≤ 5 info); each rule emits at most one finding;
dimensions keep the v1 weights 30/30/20/20 and clamp at 0.

### 4.1 Carry-over table

| v1 rule | v2 code | status | v2 definition (summary) |
|---|---|---|---|
| `lightness/reversal` | `v2/lightness-reversal` | **redefined** | turns of displayed L along the samples with prominence ≥ 0.02 (catches mid-segment dips; ignores sub-JND wobbles v1 counts) |
| `lightness/perceived-reversal` | `v2/perceived-reversal` | **redefined** | same on L + 0.25·C, only when no L reversal |
| `lightness/low-contrast` | `v2/low-contrast` | **redefined** | diameter of the displayed path instead of the stop set (equal for straight paths) |
| `lightness/abrupt-jump` | `lightness/abrupt-jump` | **unchanged** | a property of stop placement |
| `lightness/uneven-speed` | `v2/uneven-speed` | **redefined** | CV of arc length per 1/64-line window, time-weighted; applies to 2-stop gradients too |
| `hue/wide-arc` | `v2/hue-arc` | **redefined** | smallest arc enclosing the hues of displayed chromatic samples — so it follows the hue path (§5.3) |
| `hue/narrow-arc` | `v2/narrow-hue-arc` | **redefined** | same measurement, < 15° |
| `hue/direction-reversal` | `v2/hue-direction-reversal` | **redefined** | sign changes of the net hue travel per segment between chromatic stops, measured on samples |
| `chroma/saturation-range` | `chroma/saturation-range` | **unchanged** | stop chroma (author intent); path chroma loss is `v2/chroma-dip` |
| `chroma/dead-zone` | `chroma/dead-zone` | **unchanged** | stop chroma classes |
| `chroma/muddy-midpoint` | `v2/chroma-dip` | **redefined** (moot under oklch) | chroma loss of the *intended* path vs linear chroma between the endpoints; identically 0 in oklch |
| `chroma/banding` | `v2/banding` | **redefined** | 8-bit levels traversed by the displayed path per segment → band width in px at a reference length |
| `rhythm/edge-gap` | `rhythm/edge-gap` | **unchanged** | positions only |
| `rhythm/narrow-span` | `rhythm/narrow-span` | **unchanged** | positions only |
| `rhythm/uneven-gaps` | `rhythm/uneven-gaps` | **unchanged** (candidate for removal) | positions only; a proxy that `v2/uneven-speed` now measures directly (§12 Q4) |
| — | `v2/gamut-excursion` | **new** | §5.1 |
| — | `v2/unexpected-hue` | **new** | §5.2 |
| — | `v2/powerless-hue` | **new** | §5.4 |

Codes of unchanged rules are kept; every new or redefined rule has a `v2/`
code so that a consumer can never confuse a sampled measurement with the v1
one. `V2_FINDING_CODES` lists all codes with `{dimension, origin, replaces?}`.

**Why some rules stay stop-based.** Saturation range and dead zone describe
the author's choice of colours. Measuring them on the path would make them
count the same path defect (an sRGB chroma dip) that `v2/chroma-dip` already
counts. Keeping intent rules on stops and rendering rules on the path is the
separation that avoids double counting. It is a design choice, not a finding.

### 4.2 Lightness (30)

**`v2/lightness-reversal`.** Walk the displayed L of the samples with a
hysteresis of `prominence` = 0.02 (one OKLAB JND, the same constant CSS gamut
mapping uses): a turn is recorded when L has moved at least 0.02 against the
current direction from the running extreme. Penalty 12 per turn (as v1),
error. Location: the stop(s) at the turns (or the segment's two stops when the
turn is mid-segment). *Differences from v1, intended:* sub-JND stop wobbles do
not count (pastel examples gain 18 points), mid-segment dips do (sRGB
red→green dips to L ≈ 0.55 between 0.63 and 0.87: one reversal).

**`v2/perceived-reversal`.** The same on L + 0.25 C (Helmholtz–Kohlrausch
first-order term copied from v1), only when no L reversal; 6, warning.

**`v2/low-contrast`.** `pathDeltaE` = the largest ΔE between two displayed
samples; < 0.02 → 15 (error), < 0.05 → 8 (warning). Equal to v1's stop
diameter for straight paths; larger for curved ones.

**`lightness/abrupt-jump`.** Unchanged (v1 §3).

**`v2/uneven-speed`.** Each positive segment is cut into
`max(1, round(64 g))` windows (≈ 16 px at 1000 px); speed = arc length of the
displayed path inside the window / window width; `speedCv` = time-weighted
coefficient of variation of the window speeds. > 0.8 → 8 (warning), > 0.5 → 4
(info) (v1 thresholds). Location: the segment whose mean speed deviates most.

*Why windows.* OKLAB L = ∛(linear luminance) has an infinite slope at black.
On an sRGB black→white ramp, per-sample speed ∝ t^(−2/3) near 0, whose
variance diverges as sampling is refined: the CV was 1.86 at our grid and
would grow with finer grids. Over 1/64 windows the integral is finite and the
CV converges (0.75 for sRGB black→white; 0 in oklab). The window width is a
stated scale, not a perceptual constant. That OKLAB says the first 1/64 of an
sRGB black→white ramp covers ≈ 10 % of the lightness range, where CIE L*
says ≈ 1 %, is a known weakness of OKLAB near black (§8).

### 4.3 Hue (30)

Chromatic stop: C > 0.02 (v1). Chromatic sample: displayed C > 0.02.

**`v2/hue-arc` / `v2/narrow-hue-arc`.** With ≥ 2 chromatic stops (as v1),
`visitedHueArc` = 360° minus the largest gap between the sorted hues of the
chromatic samples. > 180 → 20 (error), > 120 → 8 (warning), < 15 → 5 (info).
Thresholds from v1. Because it is measured on the samples it follows the hue
path; see §5.3 for what each path can reach.

**`v2/hue-direction-reversal`.** For each segment whose two stops are
chromatic, the net signed hue travel = Σ of wrapped hue differences of
consecutive chromatic samples. Travels with |·| ≤ 5° are ignored; fires (10,
warning) when both signs remain. Segments touching a grey stop are excluded:
next to a grey the sample hue drifts with chroma, not with the hue path, and
counting it produced false reversals on `grey → pink → grey` in an earlier
iteration. In oklch the per-segment travel *is* the requested path, so the
rule fires exactly when consecutive segments are asked to turn opposite ways
— which may be deliberate (§8).

### 4.4 Chroma (20)

**`chroma/saturation-range`, `chroma/dead-zone`.** Unchanged (v1 §5).

**`v2/chroma-dip`.** For each sample of a segment whose expected chroma
`(1 − u)·Cₐ + u·C_b` exceeds 0.04, `dip = 1 − C_intended / C_expected`;
`worstDip` is the maximum. > 0.5 → 10 (warning), > 0.3 → 5 (info) (v1
thresholds). It measures the **intended** path, so it captures interpolation
geometry (a straight line through the neutral axis) and not gamut loss, which
`v2/gamut-excursion` measures. Consequences, by space:

- `srgb`: replaces v1's single 8-bit midpoint probe with the whole path; on
  the corpus it agrees with v1's muddy-midpoint in 192 cases, v1-only 6, v2-only 14;
- `oklab`: straight lines in a/b still cut towards grey: red→green loses 45 %
  of its chroma at the midpoint (slight, −5; not muddy);
- `oklch`: chroma is interpolated linearly, so `worstDip` ≡ 0 (up to
  rounding): **the muddy-midpoint rule is moot under `in oklch`**, as the
  review predicted.

**`v2/banding`.** §6.

**`v2/gamut-excursion`.** §5.1.

### 4.5 Rhythm (20)

`rhythm/edge-gap`, `rhythm/narrow-span`, `rhythm/uneven-gaps`: unchanged
(v1 §6).

## 5. New failure modes and path geometry

### 5.1 Mid-path gamut excursion (`v2/gamut-excursion`)

Stops are in sRGB, but paths between them need not be:

- `srgb` paths are convex combinations inside the cube: never out of gamut;
- `oklab` paths are straight in OKLAB, and the sRGB gamut is not convex in
  OKLAB: e.g. `#0000ff → #ffffff` reaches linear b ≈ 1.084 mid-path (excursion
  ΔE 0.014 after mapping — below the JND, so CSS mapping clips it);
- `oklch` paths keep chroma while rotating hue, and sRGB's maximum chroma
  varies strongly with hue: `#ff0000 → #00ff00` holds C ≈ 0.26–0.29 through
  orange and yellow, where sRGB's limit at that lightness is far lower
  (excursion 0.123; ≈ 100 % of the line is out of gamut).

`gamutExcursion` = max over samples of ΔE(intended, displayed);
`outOfGamutFraction` = time-weighted fraction of the stop span whose intended
colour is out of gamut. > 0.06 → 8 (warning), > 0.02 → 4 (info). The 0.02
floor is the CSS gamut-mapping JND (below it, CSS itself accepts the clip);
0.06 (three JNDs) is a guess. What the author loses: on an sRGB display the
intended chroma ramp becomes a plateau along the gamut surface, which can read
as a flat band; on a P3 display much of it is shown as intended. Hence the
display-gamut question in §12.

### 5.2 Unexpected hue on the path (`v2/unexpected-hue`)

Each segment gets an **expected hue interval** from its stops (stops with
C ≤ 0.02 have no hue):

| segment endpoints | expected interval |
|---|---|
| both achromatic | none (the segment is not checked) |
| one chromatic | that stop's hue (an interval of width 0) |
| both chromatic, `srgb`/`oklab` | the shorter arc between the two hues |
| both chromatic, `oklch` | the arc the hue method asks for (§5.3), direction included |

`hueExcursion` = the largest angular distance between the hue of a displayed
sample with **C > 0.04** and its segment's interval (0 inside). > 35° → 10
(warning), > 15° → 4 (info) (guesses). The higher chroma floor (0.04) keeps
low-chroma hue noise out. Causes it detects:

- sRGB mixing artefacts: `#0000ff → #ffffff` drifts 21.5° towards purple
  (info); grey-to-vivid sRGB mixes drift with chroma;
- invisible hues of near-greys in oklch (§5.4): `#faf8f5 → #0000ff` passes
  154° from blue (warning);
- spec-literal `longer` paths from a powerless grey (§5.3): 179°;
- per-channel clipping, which shifts hue (CSS mapping preserves it).

### 5.3 Hue-path geometry and the 180° rule

CSS Color 4 *hue interpolation* fixes up the two hues θ₁, θ₂ (both in
[0, 360)) before interpolating linearly (`fixHues`):

| method | fix-up | travel of one segment |
|---|---|---|
| `shorter` (default) | θ₂ − θ₁ > 180 → θ₁ += 360; θ₂ − θ₁ < −180 → θ₂ += 360 | [0°, 180°] |
| `longer` | 0 < θ₂ − θ₁ < 180 → θ₁ += 360; −180 < θ₂ − θ₁ ≤ 0 → θ₂ += 360 | [180°, 360°] (exactly 360° for equal hues) |
| `increasing` | θ₂ < θ₁ → θ₂ += 360 | [0°, 360°), always increasing |
| `decreasing` | θ₁ < θ₂ → θ₁ += 360 | [0°, 360°), always decreasing |

Consequences for the arc rule:

- Under `shorter`, a 2-stop gradient visits at most 180°, so the **clash tier
  needs ≥ 3 chromatic stops** (as in v1, whose arc is the same minimal
  enclosing arc). A 3-stop red→green→blue under `shorter` visits ≈ 235°.
- Under `longer`, every segment travels ≥ 180°, so a 2-stop gradient
  **always** reaches the clash tier unless its hues are exactly 180° apart.
  Example (tests): two hues 300° apart give `visitedHueArc` ≈ 60° (no finding
  beyond what v1 gives) under `shorter` and ≈ 300° (−20, clash) under `longer`.
- Under `increasing`/`decreasing` the travel is anything in [0, 360).

Whether −20 is the right response to an explicit `longer hue` is a policy
question, not a measurement question: the author asked for a rainbow (§8,
§12 Q2). The prototype scores what is painted and leaves intent to the UI.

**Spec-literal edge case.** A missing hue takes the other colour's hue
*before* the fix-up. For `#808080 → #ff0000 in oklch longer hue` both hues are
then equal, and `longer` turns equal hues into a full 360° turn: the path is a
rainbow growing out of grey. The prototype follows the text literally
(`hueTravel` ≈ 332° on chromatic samples, `v2/unexpected-hue` 179°). Whether
browsers do this is unverified.

### 5.4 Powerless hue on grey stops (`v2/powerless-hue`)

CSS Color 4: in OKLCH a hue is *powerless* when C is 0, and the sample
conversion code treats chroma below a small epsilon as zero (we use 4e-6,
the value we recall from that code; **to be checked against the current
Editor's Draft**). Powerless components are treated as missing during
interpolation, so a pure grey (sRGB greys convert to C ≈ 2–4·10⁻⁸ with the
engine's matrices) borrows its neighbour's hue and the path is clean.

The failure mode is the **near-grey**: an off-white such as `#faf8f5` has
C ≈ 0.003, far below anything visible but far above the epsilon, so its hue
(≈ 80°) is *not* powerless and the oklch path rotates from 80° to the
neighbour's hue while chroma grows — showing hues neither stop has. The rule
fires (2, info) in oklch when a stop with powerless < C ≤ 0.02 has a
chromatic neighbour more than 30° away in hue; the visible consequence is
scored by `v2/unexpected-hue`, which is why this rule costs little. Browser
epsilons differ (and have changed over time), so whether a given near-grey is
powerless is implementation-dependent: another reason to flag it.

## 6. Banding on rendered 8-bit steps

v1 counts `max(|ΔR|, |ΔG|, |ΔB|)` between a segment's endpoints and fires on
"< 16 levels over > 25 %" or "< 8 levels over > 10 %". That is exact for sRGB
paths (which are straight in the cube) and wrong for OKLAB/OKLCH paths, which
are curved in sRGB and can traverse a channel non-monotonically.

v2 measures the **displayed** path: `segmentLevels[i]` = Σ over consecutive
samples of 255 · max-channel |Δ| of the displayed gamma-encoded colour (the
Chebyshev path length in 8-bit units, unrounded). For an sRGB path this equals
v1's `segmentRgbSteps` exactly (the path is straight); for curved paths it
counts levels traversed, including back-and-forth. At a reference gradient-line
length *ℓ* (`referenceLengthPx`, default 1000 px, parameter), the average band
width of segment *i* is `ℓ · gapᵢ / max(levelsᵢ, 1)` px; `maxBandPx` is the
widest. > 32 px → 6 (warning), > 16 px → 4 (info). (A solid segment is one band
of its whole width, as in v1.)

The thresholds are guesses chosen so that, for a full-width sRGB segment at
1000 px, the subtle tier starts near v1's strong tier (16 levels over 25 % ≈
15.6 px per level). Consequences: dark 2-stop ramps with 16–60 levels, which v1
ignores, are now flagged (9 v2-only cases in the corpus, 0 v1-only).

Not modelled, and each could matter more than the threshold: the luminance of
the band step (a one-level step is far more visible in dark greys than in
saturated blue); dithering (engine-dependent, hides bands); 10-bit output;
the actual length of the gradient line (box size × angle, unknown to a linter);
and local non-uniformity of levels within a segment (the average can hide a
locally flat stretch; `v2/uneven-speed` partially covers it).

## 7. Alpha and premultiplied interpolation (designed, not implemented)

The prototype returns `unscorable` / `alpha` for any translucent stop. The
intended treatment:

1. Interpolate premultiplied, as CSS Color 4 specifies: multiply the colour
   components (not hue) by alpha, interpolate, divide by the interpolated alpha.
   `transparent` is `rgb(0 0 0 / 0)`; premultiplication is what keeps
   `red → transparent` from passing through dark grey.
2. A translucent gradient has no colour of its own: it is composited over a
   backdrop. Score the path composited over **two reference backdrops** (white
   and black, plus optionally the user's background) and report the worst,
   or report both.
3. Rules that read chroma/hue must treat a sample whose alpha < ~0.05 as
   achromatic for hue purposes (its hue is invisible).

Open: the backdrop is unknown to a linter; a single score may be the wrong
output for translucent gradients (§12 Q7).

## 8. What remains subjective and untested

- **Every threshold.** Copies of v1 thresholds are as untested as v1's; the new
  ones (prominence 0.02, 15°/35° hue excursion, 0.02/0.06 gamut excursion,
  16/32 px bands, 1/64 speed windows, 4e-6 powerless epsilon, 0.04 visible
  chroma) are first guesses.
- **Intent vs defect.** A `longer` rainbow, a deliberate there-and-back hue
  zig-zag, a stripe of hard stops and a deliberately dark band are scored as
  defects. The model has no notion of intent. v1 shares this.
- **Weights and severities.** 30/30/20/20 and the per-rule penalties are v1's;
  the new rules were slotted in without data. Penalties add linearly; nothing
  says two defects are twice as bad as one.
- **Double counting.** The sRGB muddy middle costs both `v2/chroma-dip` (−10)
  and, when L dips by ≥ 0.02, `v2/lightness-reversal` (−12). Both are real
  rendered properties; whether both should count is open (§12 Q3).
- **Uniform colour space.** Every perceptual claim leans on OKLAB ΔE and
  OKLCH hue: an approximate model, weak near black, not designed for large
  differences, with no viewing-condition or spatial (contrast sensitivity)
  model. Spatial frequency matters for banding and abruptness and is ignored.
- **The display.** sRGB, 8-bit, no dithering, no P3, no HDR, no ambient light.

## 9. Threats to validity

1. **No human validation exists (PLAN D5).** v2 numbers are a *definition* of
   smoothness over the rendered path, not truth. "v2 is better than v1" is
   unproven; the experiments show only where they *differ*.
2. **Circularity.** Any tuning against the v1 corpus or against `refine`
   output would make v2 agree with v1 by construction. Thresholds were not
   fitted to the corpus; the comparison in docs/v2-experiments.md is
   descriptive.
3. **Corpus bias.** The v1 corpus is hand-picked edge cases plus uniformly
   random hex colours. Random hex stops are far more saturated and
   hue-scattered than designed gradients, which inflates gamut excursions and
   hue findings under oklch. A corpus of real-world gradients (e.g. from the
   parser corpus) is needed before drawing distributional conclusions.
4. **Spec fidelity.** The prototype follows our reading of CSS Color 4
   (missing components, hue fix-up, gamut mapping, the epsilon). Constants
   recalled from memory (the 4e-6 epsilon) are flagged. No browser was
   available to compare rendered pixels; a pixel-level comparison against
   Chromium, WebKit and Gecko screenshots is the first validation step (§10.1).
5. **Implementation divergence.** Browsers clip, dither and may treat greys
   differently; the "rendered path" is a model of *a* renderer.
6. **Numerical determinism.** Results depend on `Math.cbrt/pow/atan2/cos/sin`,
   which JS engines may implement with ulp-level differences. Measurements are
   rounded to 1e-9 where they feed thresholds, and the golden file rounds to
   6 decimals; a threshold coincidence can still flip a tier across engines
   (the v1 boundary-case problem). A v2 boundary table would be needed before
   freezing.

## 10. Validation protocol (proposed, NOT run)

### 10.1 Step 0 — renderer fidelity (no humans)

Render each corpus gradient in Chromium, WebKit and Gecko (`in srgb/oklab/oklch`
× hue methods) at 1000 × 100 px on an sRGB profile, read back the middle row,
and compare with the prototype's displayed samples (ΔE per pixel; band
positions). Report agreement per engine and gamut-mapping mode. This decides
the default `gamutMapping` and the powerless epsilon, and is cheap.

### 10.2 Step 1 — pairwise preference study

- **Question.** "Which gradient looks smoother?" (two-alternative forced choice;
  a separate block may ask "which looks more pleasant?" to separate smoothness
  from taste).
- **Stimuli.** 60 pairs, each pair two renderings of the *same stops* under
  different interpolation (isolates the path, which is what v2 adds) or two
  stop sets with similar v1 but different v2 scores. Stratified by predicted
  |Δscore| (0–5, 6–15, > 15) and by rule family (dip, reversal, gamut, hue,
  banding). Plus 6 attention checks (identical pairs and an obvious hard-stop
  vs smooth pair), left/right and order randomised, each pair shown twice
  (swapped) to measure intra-rater consistency.
- **Presentation.** 800 × 200 px stimuli on a neutral grey (#808080 is not
  neutral for every rater's display; record device, OS, browser, colour
  profile if available), no time limit, no scores shown.
- **Raters.** ≥ 30 after exclusions (failing ≥ 2 attention checks, or
  intra-rater consistency < 60 %). Opt-in, offline or with explicit consent,
  no personal data beyond device class.
- **Sample size.** 60 pairs × 30 raters × 2 presentations = 3 600 judgements.
  To detect a rank correlation of 0.3 between model score difference and
  preference at α = 0.05, power 0.8, ≈ 85 independent items are needed
  (Fisher z: n ≈ ((1.96 + 0.84) / atanh 0.3)² + 3); with 60 pairs the study is
  powered for ρ ≈ 0.35. Comparing v1 and v2 (two dependent correlations with a
  shared criterion) needs more; treat that comparison as exploratory unless
  the pair count is raised to ≈ 150.
- **Analysis (pre-registered).** Fit a Bradley–Terry model (or mixed-effects
  logistic regression: P(left preferred) ~ Δscore + (1 | rater) + (1 | pair))
  for each model. Primary outcome: proportion of pairs where the higher-scored
  member is preferred by the majority, with bootstrap 95 % CIs (resampling
  raters and pairs), v1 vs v2 on the same pairs. Secondary: Kendall τ between
  Bradley–Terry strengths and scores; per-rule-family agreement; inter-rater
  agreement (Krippendorff's α). Report all, including null results.
- **Decision rule (proposal).** v2 can become an opt-in *non-experimental*
  model only if its agreement is ≥ v1's on interpolation pairs with a CI that
  excludes a drop; it can become a default only in a major and only if it is
  better on interpolation pairs and not worse on the rest.

## 11. Versioning and migration

1. **Now (this prototype).** `@opal42/gradient/experimental` exports `scoreV2`,
   `samplePathV2`, `V2_MODEL`, `V2_FINDING_CODES`, `fixHues`. No semver
   guarantee, no default anywhere, `scoringModel: "v2-experimental"` in every
   result. `score()` still accepts only `"v1"`. The golden file
   `spec/vectors/v2-experimental-score.json` (`npm run vectors:v2`) is a
   regression fixture for the prototype, not a contract, and is not read by
   `vectors:diff`; it may change with review while v2 is experimental.
2. **Promotion to `v2` (owner decision, after §10.1 at least).** Freeze this
   document; add a v2 boundary table; generate `spec/vectors/v2-*.json`
   (score, findings, samples) with their own replay test; widen
   `ScoreResult.scoringModel` to `"v1" | "v2"` and accept
   `score(doc, { scoringModel: "v2" })` in a minor release. v1 remains the
   default; its vectors and behaviour do not change.
3. **Default flip.** Only in a major release, only after a validation result
   (§10.2), announced, with `scoringModel` echoed everywhere (results, CLI
   JSON, lint messages) so that stored scores can be told apart.
4. **Web app.** Pin v1 until it ships a visible **interpolation selector**:
   `sRGB (default) | OKLab | OKLCH` and, for OKLCH, `shorter | longer |
   increasing | decreasing hue`. The selector already maps to
   `doc.interpolation` and `toCSS` prints `in oklab` / `in oklch longer hue`.
   When v2 is offered it is labelled "experimental", shows `scoringModel`, and
   is computed on the selected interpolation — so the score changes when the
   selector changes, which is the point. Share URLs must carry the
   interpolation (docs/URL-FORMAT.md) and, once v2 exists, the model.
5. **Lint/CLI/MCP.** `--scoring-model v2` (opt-in) once promoted; `min-score`
   thresholds are model-specific and must not be carried from v1 to v2.

## 12. Open questions

The owner-facing list is in docs/v2-experiments.md ("Open questions"). The
model-level ones: Q1 default gamut mapping (css4 vs clip) and display gamut
(sRGB vs P3); Q2 should an explicit `longer`/`increasing`/`decreasing` path
waive the arc and direction rules; Q3 double counting of the sRGB muddy middle
(dip + reversal); Q4 drop `rhythm/uneven-gaps` in favour of `v2/uneven-speed`;
Q5 banding: add step luminance and the real line length; Q6 P3 display model;
Q7 translucent gradients: one score or per-backdrop scores.
