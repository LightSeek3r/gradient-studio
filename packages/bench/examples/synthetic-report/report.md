# GradientBench report

> **Read this first.** Measures perceptual smoothness by the Opal42 v1 definition - not aesthetics, brand fit or human preference; the same metric drives the refine step, so with-skill gains are expected by construction and are not validation of the metric.

> **SYNTHETIC DATA: these records were written by hand to test the harness and demonstrate the format. They are not outputs of any model and must not be read as model results.**

## Provenance

| Field | Value |
| --- | --- |
| Bench version | 0.0.0 |
| Scoring model | v1 |
| Core version (@opal42/gradient) | 0.0.0 |
| Brief set | GradientBench briefs 0.1.0 (100 briefs) |
| Brief-set hash | `43fdc97bdcbded2f` |
| Tailwind palette entries supplied | 0 |
| Bootstrap | 2000 resamples, seed 659522, 95% percentile interval |
| Sources | synthetic-results.jsonl |

## Results by model and condition

Sorted by mean score (descending). Unit: the per-brief mean score of the gradients found in one answer. Ranking by a smoothness metric ranks smoothness only.

| Model | Condition | Records | Any gradient found | Scorable (scored/found) | Mean score | Median | IQR | Mean of per-record minimum |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| synthetic-model-a | with-skill | 12 | 91.7% | 100.0% | 92.7 | 95.0 | 95.0 to 98.0 | 92.7 |
| synthetic-model-b | with-skill | 7 | 100.0% | 100.0% | 91.0 | 92.0 | 88.5 to 95.0 | 91.0 |
| synthetic-model-b | baseline | 7 | 85.7% | 85.7% | 84.2 | 85.0 | 82.0 to 88.0 | 84.2 |
| synthetic-model-a | baseline | 12 | 91.7% | 91.7% | 80.2 | 85.0 | 62.5 to 92.0 | 80.2 |

## By condition (pooled over models)

| Model | Condition | Records | Any gradient found | Scorable (scored/found) | Mean score | Median | IQR | Mean of per-record minimum |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all models | with-skill | 19 | 94.7% | 100.0% | 92.1 | 95.0 | 89.8 to 95.8 | 92.1 |
| all models | baseline | 19 | 89.5% | 89.5% | 81.6 | 85.0 | 65.0 to 92.0 | 81.6 |

## By model (pooled over conditions)

| Model | Condition | Records | Any gradient found | Scorable (scored/found) | Mean score | Median | IQR | Mean of per-record minimum |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| synthetic-model-b | all conditions | 14 | 92.9% | 92.9% | 87.8 | 88.0 | 82.0 to 95.0 | 87.8 |
| synthetic-model-a | all conditions | 24 | 91.7% | 95.7% | 86.5 | 93.5 | 82.8 to 95.8 | 86.5 |

## Paired comparison against the baseline condition

Pairs are briefs scored in both conditions. Difference = condition minus baseline, in score points. The interval is a paired bootstrap percentile interval; p is the two-sided Wilcoxon signed-rank test. With-skill gains are expected by construction: the same metric drives refine.

| Model | Condition | Paired briefs | Unpaired | Mean baseline | Mean condition | Mean difference | 95% interval | Wilcoxon p | Better / tied / worse |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| synthetic-model-a | with-skill | 11 | 1 | 80.2 | 92.7 | +12.5 | +3.5 to +22.7 | 0.0313 (exact, n=9) | 7 / 2 / 2 |
| synthetic-model-b | with-skill | 6 | 1 | 84.2 | 90.8 | +6.7 | -0.8 to +16.7 | 0.2500 (exact, n=4) | 3 / 2 / 1 |

## Most frequent finding codes

Share of scored gradients carrying the code (top 5 per group).

| Model | Condition | Scored gradients | Codes (share) |
| --- | --- | --- | --- |
| synthetic-model-a | with-skill | 11 | hue/narrow-arc 36.4%; chroma/banding 9.1%; chroma/dead-zone 9.1%; chroma/muddy-midpoint 9.1%; chroma/saturation-range 9.1% |
| synthetic-model-b | with-skill | 7 | hue/narrow-arc 42.9%; chroma/banding 14.3%; chroma/dead-zone 14.3%; chroma/muddy-midpoint 14.3%; hue/wide-arc 14.3% |
| synthetic-model-b | baseline | 6 | chroma/muddy-midpoint 33.3%; chroma/saturation-range 33.3%; hue/wide-arc 33.3%; lightness/reversal 33.3%; chroma/dead-zone 16.7% |
| synthetic-model-a | baseline | 11 | chroma/saturation-range 36.4%; hue/wide-arc 36.4%; lightness/reversal 36.4%; hue/direction-reversal 27.3%; chroma/dead-zone 18.2% |

## How much would refine change the colours

Mean OKLAB distance between the original and the refined stops (black to white is 1.0), over gradients whose colours refine would change. A change of 0.05 or more is counted as large; that cut is a reporting bucket, not a quality threshold.

| Model | Condition | Scored gradients | Colours changed | Mean ΔE (changed) | Large (>= 0.05) | Mean score gain per gradient |
| --- | --- | --- | --- | --- | --- | --- |
| synthetic-model-a | with-skill | 11 | 90.9% | 0.040 | 20.0% | +2.6 |
| synthetic-model-b | with-skill | 7 | 100.0% | 0.037 | 14.3% | +4.9 |
| synthetic-model-b | baseline | 6 | 100.0% | 0.107 | 83.3% | +9.2 |
| synthetic-model-a | baseline | 11 | 90.9% | 0.111 | 70.0% | +9.0 |

## Limits

- Smoothness by the v1 definition only; it has not been validated against human judgement (PLAN D5).
- Unit of analysis is the brief. Gradients the extractor cannot parse or the scorer skips (var(), alpha, radial, Tailwind palette classes without a palette, ...) lower the scorable ratio and are not scored.
- The brief set was written by one team and is small; see docs/bench.md for prompt-set bias.
