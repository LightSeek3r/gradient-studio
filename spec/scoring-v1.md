# Gradient smoothness score — model v1

Status: frozen with the v1 characterisation vectors (`spec/vectors/v1-*.json`).
Source of truth for every number below: `V1_MODEL` in
[`src/scoring-model-v1.ts`](../src/scoring-model-v1.ts). `tests/spec.test.ts`
checks that every finding code has a section here and vice versa, and that every
`` `V1_MODEL.…` = value `` line in this file matches the code.

The score is a *smoothness score by our definition*, not a validated quality
verdict (PLAN D5).

## 1. Input domain

A gradient is scorable under v1 when it has **at least 2 stops** and every stop has

- an opaque **`#rrggbb`** colour — six hex digits, either case
  (`` `V1_MODEL.domain.colorPattern` ``); no alpha, shorthand, names or functional notation;
- a **finite position in 0..100** (percent along the gradient line).

- `V1_MODEL.domain.minStops` = 2
- `V1_MODEL.domain.minPosition` = 0
- `V1_MODEL.domain.maxPosition` = 100

Anything else is **unscorable**: `scoreGradient` returns `status: "unscorable"`,
a `reason` naming the first offending stop by its input index, `score: 0`, all
dimensions 0, no issues and no findings. `suggestGradient` returns its input
unchanged. The CSS and interpolation helpers skip invalid stops.

## 2. Pipeline

1. Stable-sort the stops by position. Ties keep array order (that is what CSS
   paints), so results are invariant under any permutation of the input that
   keeps the relative order of stops sharing a position.
2. Convert each stop to OKLAB / OKLCH (`L`, `C`, `h`).
3. Run the rules below in order. Each rule fires at most one tier and then emits
   exactly **one finding** `{code, severity, dimension, pointsLost, stops?, segment?, message}`.
   `issues[]` is `findings.map(f => f.message)`.
4. Each dimension starts at its weight and subtracts its findings' `pointsLost`;
   it is then clamped at 0. The score is the sum of the four dimensions.

- `V1_MODEL.weights.lightness` = 30
- `V1_MODEL.weights.hue` = 30
- `V1_MODEL.weights.chroma` = 20
- `V1_MODEL.weights.rhythm` = 20

The `rhythm` dimension is reported as `details.spacing`.

**Clamping.** For each dimension *d* with weight *W*:
`W − details[d] = min(W, Σ pointsLost of d's findings)`. Lightness, chroma and
rhythm can collect more nominal penalty than their weight (e.g. two lightness
reversals cost 24 plus 8 for an abrupt jump); the excess is absorbed and the
dimension scores 0. So `Σ pointsLost = 100 − score` exactly when no dimension is
clamped, and `Σ pointsLost > 100 − score` otherwise. `pointsLost` is always the
rule's nominal penalty.

**Locations.** `stops` are indices into the **position-sorted** stops (sorted,
unique). `segment` is `[start, end]` in positions 0–100 and always lies on stop
positions; when both are present, `segment` runs from the first to the last
listed stop. "Segment *i*" below means sorted stops *i* and *i+1*.

**Severity** follows the penalty: ≥ 12 error, 6–10 warning, ≤ 5 info.

**Measurements.** `details.measurements` (`ScoreMeasurements`) exposes every
quantity a threshold is compared with. The vectors record them, and a case is
`boundary: true` when a measurement lies within `1e-6 · max(1, |t|)` of one of
its thresholds *t* (`V1_BOUNDARY_TABLE`, `boundaryHits`). Ports must match
non-boundary cases exactly and boundary cases on measurements only.

**Ties (D8).** Wherever a rule names "the largest", "the worst", "the first on
ties" or the ends of an arc, values that agree within `EPS = 1e-9` (relative,
absolute below 1; `src/tolerance.ts`) are **ties**, and ties go to the lowest
position-sorted index. The measurements and every threshold test are exact as
before; only the choice among near-equal candidates uses the tolerance, so that
locations do not depend on the last bit of `pow` / `cbrt` / `atan2` (which
differs between Node versions and languages). See `docs/DETERMINISM.md`.

**Two definitions of "achromatic" (kept as v1 behaviour).** Hue rules and refine
treat a stop as chromatic when `C > 0.02`; the dead-zone rule calls a stop
achromatic when `C < 0.04` and vivid when `C ≥ 0.08`. A stop with
`0.02 < C < 0.04` is therefore chromatic for hue but achromatic for coherence.

Notation: `ΔE(a, b)` is the Euclidean distance in OKLAB; `CV(x) = σ(x) / mean(x)`
with the population σ.

---

## 3. Lightness (30)

### `lightness/reversal`

**Measures** interior local extrema of OKLAB `L` along position order (a dip or
peak in lightness). Measurement: `lightnessReversals`.

**Formula.** Stop *i* (0 < *i* < n−1) is a reversal when `L[i]` is strictly less
than both neighbours or strictly greater than both. With *k* reversals the
penalty is `k · penaltyPerReversal`; message
`Lightness fluctuates ({count} reversal{plural}) — creates visual noise`.

- `V1_MODEL.lightness.reversal.penaltyPerReversal` = 12

**Severity** error. **Location** `stops` = the reversal stops.

**Example.** `#e0e7ff 0%, #1e1b4b 50%, #c7d2fe 100%`: L dips at stop 1 →
`{code: "lightness/reversal", pointsLost: 12, stops: [1]}`.

### `lightness/perceived-reversal`

**Measures** the same extrema on Helmholtz–Kohlrausch apparent lightness
`L + chromaWeight · C`, only when `lightness/reversal` found none. Measurement:
`perceivedReversals`.

- `V1_MODEL.lightness.perceivedReversal.chromaWeight` = 0.25
- `V1_MODEL.lightness.perceivedReversal.tier.penalty` = 6

**Severity** warning. **Location** `stops` = the apparent-lightness extrema.

**Example.** `#808080 0%, #ff0066 50%, #9a9a9a 100%`: L rises monotonically but
the vivid middle stop looks brighter than the grey after it → −6, `stops: [1]`.

### `lightness/low-contrast`

**Measures** `maxDeltaE`, the largest ΔE between any two stops.

| tier | fires when | penalty |
|---|---|---|
| invisible (error) | `maxDeltaE < invisibleBelow` | 15 |
| low (warning) | `maxDeltaE < lowBelow` | 8 |

- `V1_MODEL.lightness.contrast.invisibleBelow` = 0.02
- `V1_MODEL.lightness.contrast.invisible.penalty` = 15
- `V1_MODEL.lightness.contrast.lowBelow` = 0.05
- `V1_MODEL.lightness.contrast.low.penalty` = 8

**Location** all stops, `segment` = first to last position.

**Example.** `#336699 → #3f72a8` (0/100): `maxDeltaE ≈ 0.042` → low, −8.
`#336699 → #346699`: `≈ 0.0009` → invisible, −15.

### `lightness/abrupt-jump`

**Measures** big colour jumps squeezed into a small gap. Measurement:
`maxCloseJumpDeltaE` = max ΔE over segments whose gap is in `(0, maxGap]`.

**Formula.** The first segment (in position order) with `0 < gap ≤ maxGap` and
`ΔE > deltaEAbove` fires; later segments are not checked.

- `V1_MODEL.lightness.abruptJump.maxGap` = 10
- `V1_MODEL.lightness.abruptJump.deltaEAbove` = 0.15
- `V1_MODEL.lightness.abruptJump.tier.penalty` = 8

**Severity** warning. **Location** that segment (`stops` + `segment`).

**Example.** `#000000 0%, #ffffff 5%, #888888 100%`: ΔE ≈ 1 over 5% →
−8, `stops: [0, 1], segment: [0, 5]`.

### `lightness/uneven-speed`

**Measures** `velocityCv` = CV of `ΔE / gap` over segments with gap > 0
(needs ≥ `minStops` stops, ≥ `minSegments` such segments and a positive mean).

| tier | fires when | penalty |
|---|---|---|
| strong (warning) | `velocityCv > strongAbove` | 8 |
| mild (info) | `velocityCv > mildAbove` | 4 |

- `V1_MODEL.lightness.velocity.minStops` = 3
- `V1_MODEL.lightness.velocity.minSegments` = 2
- `V1_MODEL.lightness.velocity.strongAbove` = 0.8
- `V1_MODEL.lightness.velocity.strong.penalty` = 8
- `V1_MODEL.lightness.velocity.mildAbove` = 0.5
- `V1_MODEL.lightness.velocity.mild.penalty` = 4

**Location** the segment whose speed deviates most from the mean (first on ties,
within EPS: with two segments, e.g. any 3-stop gradient, always the first).

**Example.** `#000000 0%, #ffffff 10%, #f4f4f4 55%, #e8e8e8 100%`:
`velocityCv ≈ 1.38` → −8, `segment: [0, 10]`.

---

## 4. Hue (30)

Only **chromatic** stops (`C > chromaticAbove`) take part.

- `V1_MODEL.hue.chromaticAbove` = 0.02

### `hue/wide-arc`

**Measures** `enclosingArc` = 360° minus the largest gap between the sorted
chromatic hues (the smallest arc containing them all; needs ≥ 2 chromatic stops).
Two hues can enclose at most 180°, so the clash tier needs ≥ 3 chromatic stops.

| tier | fires when | penalty |
|---|---|---|
| clash (error) | `enclosingArc > clashAbove` | 20 |
| wide (warning) | `enclosingArc > wideAbove` | 8 |

- `V1_MODEL.hue.arc.clashAbove` = 180
- `V1_MODEL.hue.arc.clash.penalty` = 20
- `V1_MODEL.hue.arc.wideAbove` = 120
- `V1_MODEL.hue.arc.wide.penalty` = 8

**Location** `stops` = the two chromatic stops at the ends of the arc (the hues
either side of the largest gap). Hues within EPS count as equal (also across
0°/360°): the start is the **lowest** index among the stops sharing the start
hue and the end the **highest** index among those sharing the end hue (what
exact duplicates always gave); when all chromatic hues are equal, the lowest and
highest index; when several gaps tie for largest, the one whose start has the
lowest index. The same rule applies to `hue/narrow-arc`.

**Example.** `#ff0000 → #00ff80`: arc ≈ 122° → wide, −8, `stops: [0, 1]`.
`#ff0000, #00ff00, #0000ff` (0/50/100): arc ≈ 235° → clash, −20.

### `hue/narrow-arc`

Formerly a silent penalty (D4). **Measures** `enclosingArc` as above; fires when
`enclosingArc < narrowBelow` (the gradient is a single hue).

- `V1_MODEL.hue.arc.narrowBelow` = 15
- `V1_MODEL.hue.arc.narrow.penalty` = 5

**Severity** info. **Location** the two arc-end stops.

**Example.** `#3b82f6 → #2563eb`: arc ≈ 3° → −5,
"Very narrow hue arc (<15°) — the gradient reads as a single hue".

### `hue/direction-reversal`

**Measures** `hueSteps` = signed shortest-arc hue differences between chromatic
position-neighbours, in (−180, 180]. Steps with `|Δh| ≤ minStep` are ignored.

**Formula.** With ≥ `minChromaticStops` chromatic stops, fires when there is at
least one step `> minStep` and at least one `< −minStep`.

- `V1_MODEL.hue.direction.minChromaticStops` = 3
- `V1_MODEL.hue.direction.minStep` = 5
- `V1_MODEL.hue.direction.tier.penalty` = 10

**Severity** warning. **Location** `stops` = each chromatic stop where a
significant step's sign differs from the previous significant step's (the stop
the new direction starts from).

**Example.** OKLCH hues 350°, 30°, 10° at 0/50/100: steps +40, −20 → −10,
`stops: [1]`.

---

## 5. Chroma (20)

### `chroma/saturation-range`

**Measures** `chromaRange = max(C) − min(C)` over all stops.

| tier | fires when | penalty |
|---|---|---|
| spike (error) | `chromaRange > spikeAbove` | 12 |
| uneven (info) | `chromaRange > unevenAbove` | 5 |

- `V1_MODEL.chroma.range.spikeAbove` = 0.2
- `V1_MODEL.chroma.range.spike.penalty` = 12
- `V1_MODEL.chroma.range.unevenAbove` = 0.12
- `V1_MODEL.chroma.range.uneven.penalty` = 5

**Location** `stops` = the most and the least saturated stop (first occurrence,
within EPS).

**Example.** `#808080 → #ff0000`: range ≈ 0.258 → −12, `stops: [0, 1]`.

### `chroma/dead-zone`

**Measures** `coherenceRatio = min C of achromatic stops / max C of vivid stops`
(needs ≥ `minStops` stops and at least one of each kind).

- `V1_MODEL.chroma.coherence.minStops` = 3
- `V1_MODEL.chroma.coherence.achromaticBelow` = 0.04
- `V1_MODEL.chroma.coherence.vividAtLeast` = 0.08

| tier | fires when | penalty |
|---|---|---|
| dead zone (warning) | `coherenceRatio < deadZoneBelow` | 8 |
| gap (info) | `coherenceRatio < gapBelow` | 4 |

- `V1_MODEL.chroma.coherence.deadZoneBelow` = 0.15
- `V1_MODEL.chroma.coherence.deadZone.penalty` = 8
- `V1_MODEL.chroma.coherence.gapBelow` = 0.3
- `V1_MODEL.chroma.coherence.gap.penalty` = 4

**Location** `stops` = the achromatic stops.

**Example.** `#ff0000, #808080, #00ff00`: ratio ≈ 0 → −8, `stops: [1]`.

### `chroma/muddy-midpoint`

**Measures** the chroma lost at the 8-bit sRGB midpoint of each segment (what a
browser's default sRGB interpolation shows). For segment *i* with endpoint
colours `c1`, `c2`: `mid = round((c1 + c2) / 2)` per channel,
`avg = (C(c1) + C(c2)) / 2` (`segmentEndpointChroma`), and, when
`avg > endpointChromaAbove`, `dip = 1 − C(mid) / avg`. `worstDip` is the largest
dip (0 if none).

| tier | fires when | penalty |
|---|---|---|
| muddy (warning) | `worstDip > muddyAbove` | 10 |
| slight (info) | `worstDip > slightAbove` | 5 |

- `V1_MODEL.chroma.midpoint.endpointChromaAbove` = 0.04
- `V1_MODEL.chroma.midpoint.muddyAbove` = 0.5
- `V1_MODEL.chroma.midpoint.muddy.penalty` = 10
- `V1_MODEL.chroma.midpoint.slightAbove` = 0.3
- `V1_MODEL.chroma.midpoint.slight.penalty` = 5

This is the only sRGB-specific rule in v1. **Location** the worst segment (first
on ties, within EPS).

**Example.** `#00ff00 → #ff00ff`: the sRGB midpoint `#808080` is grey,
`worstDip ≈ 1` → −10, `segment: [0, 100]`.

### `chroma/banding`

**Measures** per segment the number of 8-bit levels `max(|ΔR|, |ΔG|, |ΔB|)`
(`segmentRgbSteps`, integer) against its gap (`segmentGaps`).

**Formula.** Walk segments in position order; the first segment matching a tier fires.

| tier | fires when | penalty |
|---|---|---|
| strong (warning) | `steps < strongStepsBelow` and `gap > strongSpanAbove` | 6 |
| subtle (info) | `steps < subtleStepsBelow` and `gap > subtleSpanAbove` | 4 |

- `V1_MODEL.chroma.banding.strongStepsBelow` = 16
- `V1_MODEL.chroma.banding.strongSpanAbove` = 25
- `V1_MODEL.chroma.banding.strong.penalty` = 6
- `V1_MODEL.chroma.banding.subtleStepsBelow` = 8
- `V1_MODEL.chroma.banding.subtleSpanAbove` = 10
- `V1_MODEL.chroma.banding.subtle.penalty` = 4

**Location** that segment.

**Example.** `#112233 → #1a2b3b` (0/100): 9 levels over 100% → −6, `segment: [0, 100]`.

---

## 6. Rhythm (20, reported as `details.spacing`)

### `rhythm/edge-gap`

**Measures** `edgeGap = first + (100 − last)`, the percent of the line outside the stops.

| tier | fires when | penalty |
|---|---|---|
| bunched (error) | `edgeGap > bunchedAbove` | 12 |
| short (warning) | `edgeGap > shortAbove` | 6 |
| slight (info, formerly silent) | `edgeGap > slightAbove` | 3 |

- `V1_MODEL.rhythm.edge.bunchedAbove` = 40
- `V1_MODEL.rhythm.edge.bunched.penalty` = 12
- `V1_MODEL.rhythm.edge.shortAbove` = 20
- `V1_MODEL.rhythm.edge.short.penalty` = 6
- `V1_MODEL.rhythm.edge.slightAbove` = 10
- `V1_MODEL.rhythm.edge.slight.penalty` = 3

**Location** `stops` = the first and last stop.

**Example.** `#ff0000 6%, #0000ff 94%`: edgeGap 12 → −3,
"Stops fall slightly short of the edges — small solid-color zones".

### `rhythm/narrow-span`

**Measures** `span = last − first`.

| tier | fires when | penalty |
|---|---|---|
| squeezed (warning) | `span < squeezedBelow` | 8 |
| narrow (info, formerly silent) | `span < narrowBelow` | 4 |

- `V1_MODEL.rhythm.span.squeezedBelow` = 20
- `V1_MODEL.rhythm.span.squeezed.penalty` = 8
- `V1_MODEL.rhythm.span.narrowBelow` = 40
- `V1_MODEL.rhythm.span.narrow.penalty` = 4

**Location** first and last stop, `segment` = `[first, last]`.

**Example.** `#ff0000 32%, #0000ff 67%`: span 35 → −4,
"Transition covers less than 40% of the gradient" (plus `rhythm/edge-gap` −12 for edgeGap 65).

### `rhythm/uneven-gaps`

**Measures** `gapCv` = CV of the gaps between sorted positions (needs ≥ `minStops`
stops and a positive mean gap).

| tier | fires when | penalty |
|---|---|---|
| clustered (warning) | `gapCv > clusteredAbove` | 10 |
| uneven (info, formerly silent) | `gapCv > unevenAbove` | 4 |

- `V1_MODEL.rhythm.gaps.minStops` = 3
- `V1_MODEL.rhythm.gaps.clusteredAbove` = 0.5
- `V1_MODEL.rhythm.gaps.clustered.penalty` = 10
- `V1_MODEL.rhythm.gaps.unevenAbove` = 0.25
- `V1_MODEL.rhythm.gaps.uneven.penalty` = 4

**Location** the gap deviating most from the mean gap (first on ties, within EPS).

**Example.** stops at 0/35/100: gaps 35, 65, `gapCv = 0.3` → −4,
"Stop spacing is slightly uneven", `segment: [0, 35]`.

---

## 7. Refine (`suggestGradient` / `refineGradient`)

Not scored, but part of v1 and frozen by `v1-suggest.json`.

1. Decline (return the input) when it is unscorable.
2. Stable-sort by position. Group position-neighbours at most `hardStopGap`
   apart into **hard-stop groups**; with a single group, decline.
3. Lightness: `L' = lightnessKeep · L + (1 − lightnessKeep) · ramp`, where the
   ramp runs linearly (by stop index) from the first to the last stop's L.
4. Hue: stops with `C ≤ achromaticAtMost` are achromatic — their hue is
   undefined; they are left out and keep their hue and chroma. If the chromatic
   hues' enclosing arc exceeds `maxHueArc`, every chromatic hue's signed offset
   from the centre is scaled by `maxHueArc / arc`. The centre is the circular
   mean; when the mean resultant length is below `degenerateResultantBelow`
   (e.g. opposed hues, where the mean is floating-point noise) it is the
   midpoint of the shorter arc from the first to the last chromatic stop by
   position, going towards increasing hue at exactly 180° (within EPS).
5. Chroma (chromatic stops only): `C = min(maxChroma, meanC · (1 + chromaEnvelope · sin(π t)))`,
   with `meanC` over chromatic stops and `t` the stop index / (n − 1).
6. Positions: one even slot per group (`round(g / (G − 1) · 100)`), members keep
   their offset from the group's first stop, and the last group ends at 100.
   Without hard stops this is `round(i / (n − 1) · 100)`.
7. An achromatic stop that 8-bit rounding pushes above `achromaticAtMost` is
   re-encoded with C = 0.
8. **Guarantee:** if the result scores below the input, decline and return the
   input unchanged (position-sorted, same ids).

- `V1_MODEL.refine.lightnessKeep` = 0.3
- `V1_MODEL.refine.maxHueArc` = 80
- `V1_MODEL.refine.achromaticAtMost` = 0.02
- `V1_MODEL.refine.degenerateResultantBelow` = 0.05
- `V1_MODEL.refine.chromaEnvelope` = 0.3
- `V1_MODEL.refine.maxChroma` = 0.4
- `V1_MODEL.refine.hardStopGap` = 1

So refine never lowers the score, keeps achromatic stops achromatic, keeps hard
stops hard, and is invariant under permutations of the input.
