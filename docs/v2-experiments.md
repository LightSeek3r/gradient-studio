# v2 experiments: v1 vs v2-experimental on the v1 corpus

Status: **experiment report for an experimental prototype.** Model:
[`spec/scoring-v2.md`](../spec/scoring-v2.md). Code:
`packages/core/src/experimental/v2.ts` (`@opal42/gradient/experimental`).
Nothing here changes v1 or any default (PLAN D8). No human data exists
(PLAN D5): the numbers below say where the two *definitions* differ, not
which one is right.

## Method

- **Inputs.** The 316 inputs of `spec/vectors/v1-score.json`; the 306 that v1
  can score (10 are outside the v1 domain and skipped). Stops are sorted by
  position and converted to documents (positions / 100), exactly as the v1
  document adapter would see them.
- **Models.** v1 = `score(doc)`. v2 = `scoreV2(doc, opts)` with
  `interpolation` = `srgb`, `oklab`, `oklch` (shorter hue), and `oklch` with
  `gamutMapping: "clip"` instead of the CSS Color 4 algorithm. Reference length
  for banding: 1000 px.
- **Reproduce.** `npm run experiments:v2 -w @opal42/gradient` prints the
  tables below (deterministic except the timing line).
- **Caveat on the corpus.** 190 of the 306 cases are uniformly random hex
  colours. Random stops are far more saturated and hue-scattered than designed
  gradients, so the oklch gamut and hue numbers are upper bounds for real use
  (spec §9, threat 3).

## Results

## Score deltas (v2 − v1)

| config | mean | median | p10 | p90 | min | max | |Δ| ≤ 5 | v2 > v1 | v2 < v1 | Spearman ρ(v1, v2) |
|---|---|---|---|---|---|---|---|---|---|---|
| srgb | -3.2 | 0.0 | -12.0 | 0.0 | -35 | 34 | 219 | 12 | 126 | 0.974 |
| oklab | -0.8 | 0.0 | -5.0 | 0.0 | -14 | 34 | 275 | 20 | 88 | 0.990 |
| oklch | 1.5 | 1.0 | -4.0 | 6.0 | -19 | 34 | 234 | 157 | 65 | 0.986 |
| oklch-clip | 1.4 | 1.0 | -4.0 | 6.0 | -19 | 34 | 232 | 157 | 63 | 0.986 |

## Histogram of deltas (count of cases)

| bucket | srgb | oklab | oklch | oklch-clip |
|---|---|---|---|---|
| ≤ −20 | 4 | 0 | 0 | 0 |
| −19…−10 | 50 | 6 | 4 | 7 |
| −9…−5 | 44 | 55 | 8 | 8 |
| −4…−1 | 28 | 27 | 53 | 48 |
| 0 | 168 | 198 | 84 | 86 |
| +1…+5 | 1 | 3 | 97 | 98 |
| +6…+10 | 5 | 10 | 51 | 50 |
| > +10 | 6 | 7 | 9 | 9 |

## Finding flips per rule (v1 code → v2 counterpart)

Cells: both / v1 only / v2 only (number of cases).

| v1 code | v2 code | srgb | oklab | oklch | oklch-clip |
|---|---|---|---|---|---|
| `chroma/banding` | `v2/banding` | 14 / 0 / 9 | 14 / 0 / 9 | 14 / 0 / 9 | 14 / 0 / 9 |
| `chroma/dead-zone` | `chroma/dead-zone` | 35 / 0 / 0 | 35 / 0 / 0 | 35 / 0 / 0 | 35 / 0 / 0 |
| `chroma/muddy-midpoint` | `v2/chroma-dip` | 192 / 6 / 14 | 192 / 6 / 19 | 0 / 198 / 0 | 0 / 198 / 0 |
| `chroma/saturation-range` | `chroma/saturation-range` | 135 / 0 / 0 | 135 / 0 / 0 | 135 / 0 / 0 | 135 / 0 / 0 |
| `hue/direction-reversal` | `v2/hue-direction-reversal` | 132 / 5 / 3 | 132 / 5 / 0 | 133 / 4 / 0 | 133 / 4 / 0 |
| `hue/narrow-arc` | `v2/narrow-hue-arc` | 20 / 0 / 0 | 20 / 0 / 0 | 20 / 0 / 0 | 20 / 0 / 0 |
| `hue/wide-arc` | `v2/hue-arc` | 212 / 3 / 2 | 212 / 3 / 1 | 212 / 3 / 1 | 212 / 3 / 1 |
| `lightness/abrupt-jump` | `lightness/abrupt-jump` | 71 / 0 / 0 | 71 / 0 / 0 | 71 / 0 / 0 | 71 / 0 / 0 |
| `lightness/low-contrast` | `v2/low-contrast` | 10 / 0 / 3 | 10 / 0 / 3 | 10 / 0 / 3 | 10 / 0 / 3 |
| `lightness/perceived-reversal` | `v2/perceived-reversal` | 1 / 3 / 11 | 1 / 3 / 1 | 1 / 3 / 1 | 1 / 3 / 1 |
| `lightness/reversal` | `v2/lightness-reversal` | 182 / 2 / 28 | 180 / 4 / 1 | 180 / 4 / 1 | 181 / 3 / 2 |
| `lightness/uneven-speed` | `v2/uneven-speed` | 90 / 3 / 17 | 90 / 3 / 5 | 90 / 3 / 23 | 90 / 3 / 15 |
| `rhythm/edge-gap` | `rhythm/edge-gap` | 80 / 0 / 0 | 80 / 0 / 0 | 80 / 0 / 0 | 80 / 0 / 0 |
| `rhythm/narrow-span` | `rhythm/narrow-span` | 16 / 0 / 0 | 16 / 0 / 0 | 16 / 0 / 0 | 16 / 0 / 0 |
| `rhythm/uneven-gaps` | `rhythm/uneven-gaps` | 100 / 0 / 0 | 100 / 0 / 0 | 100 / 0 / 0 | 100 / 0 / 0 |

## New v2 rules: cases firing

| code | srgb | oklab | oklch | oklch-clip |
|---|---|---|---|---|
| `v2/unexpected-hue` | 27 | 3 | 7 | 7 |
| `v2/powerless-hue` | 0 | 0 | 7 | 7 |
| `v2/gamut-excursion` | 0 | 8 | 182 | 182 |

## oklch: CSS Color 4 gamut mapping vs clipping

14 of 306 cases score differently; max |Δ| = 14.


## Reading the results

**sRGB: v2 broadly agrees with v1, and is stricter.** Spearman ρ(v1, v2-srgb)
= 0.974; 168 of 306 cases score identically and 219 within ±5. The 126 cases
that drop do so mostly because v2 sees what happens *between* the stops:

- `v2/lightness-reversal` fires in 28 cases where v1's does not. sRGB mixing
  in gamma space darkens mid-segment: `#ff0000 → #00ff00` dips to L ≈ 0.55
  between 0.63 and 0.87 (1 reversal, −12); `#808080 → #ff0066 → #9a9a9a`
  ("H-K wobble") dips in both segments (3 turns, lightness 30 → 0; score
  74 → 46, the largest srgb drops are of this kind).
- `v2/unexpected-hue` fires in 27 srgb cases (3 in oklab): sRGB mixes drift in
  OKLCH hue, e.g. `#0000ff → #ffffff` drifts 21.5° towards purple (−4).
- `v2/uneven-speed` adds 17 cases, chiefly 2-stop gradients (v1's rule needs
  3 stops) and ramps touching black, where OKLAB's cube root makes the first
  1/64 of an sRGB ramp the fastest (sRGB black→white: CV 0.75, −4).
- `v2/banding` adds 9 cases and loses none: dark ramps with 16–60 levels.
  `#1e293b → #0f172a` has 18 levels → 55.6 px bands at 1000 px (−6); v1 is
  silent (it needs < 16 levels).
- The muddy-midpoint verdicts agree in 192 cases (v1-only 6, v2-only 14): the
  whole-path dip and v1's single 8-bit midpoint probe mostly coincide.

Cases that *rise* under srgb are v1 artefacts that v2 removes on purpose:
sub-JND stop wobbles (pastel 6/7 stops: v1 counts every tiny L extremum,
45 → 63) and zero-width stops (`#ff0000, #00ff00, #0000ff` all at 30 %:
v1 scores the invisible green, 38 → 72; v2 samples only the painted red|blue).

**oklab: closest to v1** (ρ = 0.990, 198 identical). The straight a/b line
still desaturates: red→green loses 45 % of its chroma at the midpoint, which
is `slight` (−5), not `muddy` (−10). 8 cases have small gamut excursions.

**oklch: the muddy midpoint disappears, gamut excursions appear.** All 198
v1 muddy-midpoint findings vanish (`worstDip` ≡ 0 by construction; the
review's prediction that the rule is moot holds exactly). In exchange,
`v2/gamut-excursion` fires in 182 of 306 cases (100 mild, 82 strong; median
excursion ΔE 0.034, p90 0.098; 123 of the 190 random cases). Net: 157 cases
rise, 65 fall, median +1. Example: red→green scores v1 90, v2-srgb 78 (dip +
reversal), v2-oklab 95, v2-oklch 92 (excursion ΔE 0.123 over ≈ 100 % of the
line, −8).

**Hue path.** On the corpus (all `shorter`), arc verdicts barely change
(212 both, 3 v1-only, 1–2 v2-only): for shorter paths the visited arc equals
v1's stop arc up to sampling. The difference is entirely in the hue method:
the 300° pair `#db6468 → #b76ec7` visits 59.9° under `shorter` (score 100)
and 300.1° under `longer` (−20 clash, −4 gamut: 76). v1 gives the same number
for both.

**Powerless hue.** 7 corpus cases have near-grey stops (4·10⁻⁶ < C ≤ 0.02)
next to a chromatic stop more than 30° away; in oklch their invisible hue
steers the path. Curated example: `#faf8f5 → #0000ff` passes 154° from blue
(`v2/unexpected-hue` −10, `v2/powerless-hue` −2). Pure greys (C ≈ 10⁻⁸) are
powerless and clean.

**Gamut mapping mode.** CSS Color 4 mapping vs per-channel clipping changes
14 of 306 oklch scores (max |Δ| 14). Clipping shifts hue (it fires the
unexpected-hue rule more often); the choice matters less than the threshold
of the excursion rule itself.

**Cost.** Built package (`dist/experimental.js`), Node 22, this machine,
8 evenly spaced fully saturated stops: median 0.84 ms (srgb, 289 samples),
1.04 ms (oklab, 351), 1.13 ms (oklch shorter, 366), 2.82 ms (oklch longer, 516;
p99 4.5 ms) — within the 5 ms target. Under vite-node (unoptimised transform,
the experiment script) the mean is ≈ 2.4 ms with outliers to ≈ 29 ms from JIT
warm-up and GC.

## What this does and does not show

- It shows the definitions differ in **predictable, explainable** ways, each
  traced to one rule. It does not show v2 is closer to human judgement; no
  such data exists (spec §10 has the protocol).
- v2-srgb is not a drop-in replacement for v1: same direction of judgement
  overall (ρ 0.97), but ~41 % of cases change score, mostly downwards.
- Under oklch, `v2/gamut-excursion` dominates. Whether that is a defect the
  user should be told about depends on the display (P3 shows much of it
  faithfully) and on what browsers really do (spec §2, unverified here).

## Open questions for the owner

1. **Should v2 be pursued at all before validation?** The cheapest next step
   is renderer fidelity (spec §10.1: compare the sampled path with browser
   screenshots); the preference study (§10.2) needs ≈ 30 raters × 60 pairs.
2. **Gamut excursion under oklch** fires on 59 % of the corpus. Keep it as a
   penalty, make it informational (0 points), or tie it to a display-gamut
   option (sRGB vs P3)? And default mapping: CSS Color 4 or clip (what we
   believe browsers do)?
3. **Explicit hue methods.** Should `longer`/`increasing`/`decreasing` waive the
   arc clash (the author asked for a rainbow), or should the UI warn instead?
4. **Double counting** of the sRGB muddy middle (chroma dip −10 *and*
   lightness reversal −12 for red→green). Keep both, cap the pair, or drop
   one?
5. **Lightness prominence 0.02.** It removes v1's sub-JND wobble penalties
   (pastels +18) but makes srgb grey↔vivid mixes lose up to 36 points. Is
   one JND the right floor, and should mid-segment sRGB dips cost the same
   12 points as a stop-level reversal?
6. **Banding thresholds** (16/32 px at 1000 px) flag dark ramps v1 ignores.
   Acceptable, or should banding weight the luminance of the step and use the
   real line length (the web app knows the preview size)?
7. **`rhythm/uneven-gaps`.** v2 measures speed on the path, so uneven *gaps*
   are only a proxy. Drop the rule in v2?
8. **Near-greys.** Flag every 4·10⁻⁶ < C ≤ 0.02 stop in oklch (current
   behaviour, 2 points), or offer an automatic fix (snap to C = 0)?
9. **Web app.** Is an interpolation selector (sRGB / OKLab / OKLCH + hue
   method) wanted? It is the precondition for exposing v2 there (PLAN §3.5).
10. **Corpus.** Can we build a corpus of real-world gradients (from the parser
    corpus / public CSS) so that distributions are not driven by random hex
    stops?
