# v1 vectors: changes from the pre-freeze defect fixes

The v1 vectors were first generated from the unmodified engine (commit
`cdfc480`). Before freezing v1 (PLAN §6 Phase 0, tasks 9–12), the known defects
were fixed **once**, and the vectors were regenerated with `npm run vectors`.
This file accounts for every vector that changed.

**How it is checked.** `npm run vectors:diff` (`scripts/vector-diff.ts`)
compares every case on disk with the same case at a git ref (default `HEAD`),
by `name` (by kind + input for colour cases). Each changed case must be explained
by a defect, decided from **input predicates** (and, for D5, the old vector's own
scores), never from the new output, plus field-level rules (below). Unchanged
cases are compared as serialised JSON; since the files hold one case per line,
an unchanged case is a byte-identical line. The script exits 1 on any
unexplained change, a removed case, or any change at all to the CSS or colour
vectors; it was checked to fail on a hand-edited non-defect case.

## Summary (against `cdfc480`)

| file | cases | byte-identical | changed | added | D2 | D4 | D5 | D6 | D7 | unexplained |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| v1-score.json | 316 | 226 | 75 | 15 | 0 | 57 | 0 | 25 | 0 | 0 |
| v1-suggest.json | 316 | 229 | 72 | 15 | 0 | 0 | 51 | 17 | 9 | 0 |
| v1-interpolate.json | 316 | 222 | 79 | 15 | 79 | 0 | 0 | 0 | 0 | 0 |
| v1-css.json | 319 | 304 | 0 | 15 | 0 | 0 | 0 | 0 | 0 | 0 |
| v1-color.json | 156 | 148 | 0 | 8 | 0 | 0 | 0 | 0 | 0 | 0 |
| v1-findings.json | 316 | — | — | 316 (new file) | | | | | | |

A case explained by two defects counts in both columns. Every one of the 301
original corpus cases (and all 304 CSS and 148 colour cases) that is not listed
as changed is byte-identical. Only the file headers' `note` / `defectNote` text
changed besides cases.

**Added cases** (appended after the random corpus so the original cases keep
their index): 15 corpus cases (`D1 …` invalid inputs and a single stop,
`domain upper-case hex`, `D5 hard stop 0.5% apart`, `D5 grey middle among warm`,
`D6 unsorted with tie`, `D7 opposed 4 balanced`) in score/suggest/interpolate/css,
and 8 `parse` cases for prototype keys (D3) in the colour vectors.

**New file** `v1-findings.json`: per corpus case the status, coded and located
findings, the full `ScoreMeasurements` and a `boundary` flag over all of them
(`boundaryHits`; 41 of 316 cases are boundary, 33 of those only because a
segment gap equals 10 or 25 exactly). `v1-score.json` keeps its original
measurement set and boundary flag; its flag is now computed from
`V1_BOUNDARY_TABLE` restricted to those measurements and is unchanged for every
case.

## Per defect

### D1 — invalid input (`unscorable`, never NaN)
**Changed: 0.** All valid inputs are unaffected. 10 invalid / too-short inputs
were added; they score `status: "unscorable"` with a reason, and the CSS,
interpolation and refine helpers skip or return them unchanged.

### D2 — `interpolateGradient` bracket search — **79 interpolate cases**
Rule: the case's stops do not span 0–100, or several stops share the last
position; only `samples` may change, never `colorAt` (the reference that
already clamped), and for spanning stops only the final (t = 1) sample may
move. `interpolateGradient` and `colorAtPosition` now share one helper.
- 78 × `samples` only (stops not spanning 0–100: samples before the first stop
  are now the first colour, after the last stop the last colour, and middle
  stops are no longer skipped);
- 1 × `samples` + `defects` (`random #30 (n=9)`, two stops at 100: the t = 1 sample
  is now the *last* of them, as CSS paints past the end; the D2 tag was extended
  to that case).

### D3 — `parseName` own-property lookup
**Changed: 0** (no prototype key was in the colour corpus). 8 parse cases added;
all return `null`.

### D4 — the four silent penalties get a message — **57 score cases**
Rule: one of the formerly silent conditions holds (arc < 15°, edge gap in
(10, 20], span in [20, 40), gap CV in (0.25, 0.5]); score and details must be
identical and `issues` must equal the old list once the four new messages are
removed (checked exactly when D6 does not also apply).
- 50 × `issues` only; 7 more coincide with D6 (below).

### D5 — refine guarantees — **51 suggest cases**
Rule: the input has an achromatic stop (C ≤ 0.02) or a hard stop (neighbours
≤ 1% apart), or the OLD refine lowered the score (old `scoreAfter <
scoreBefore`); in the last case alone the new suggestion must be the input
unchanged (declined). Never `scoreAfter < scoreBefore` in the new vectors.
- 17 × `suggested`, `scoreAfter`; 2 × `suggested` only;
- 29 × also `defects` (+1 with D6, +2 with D7): the D5 tag is now "achromatic
  stop, hard stop, or refine declined", so hard-stop and declined cases gained
  it.

### D6 — order dependence — **25 score cases, 17 suggest cases**
Rule: the input array is not sorted by position. In the score vectors only the
two rules that walked array order (lightness reversal, Helmholtz–Kohlrausch)
may change: hue/chroma/spacing details must be identical, the score must move
by exactly the lightness change, and issues may differ only in those two rules'
messages (and D4's).
- score: 11 × `score`, `details`, `issues`; 7 × `issues` only; 4 × with D4
  `score`, `details`, `issues`; 3 × with D4 `issues`. (10 further unsorted cases
  happened to score the same and are byte-identical.)
- suggest: 14 × `scoreBefore` only; 1 × with D5 (refine now declines because
  the corrected baseline is higher); 2 × with D7.

### D7 — opposed-hue circular mean — **9 suggest cases**
Rule: at least two chromatic stops whose mean resultant length is below
`refine.degenerateResultantBelow` (0.05) and whose arc exceeds 80° (so the
centre is actually used). The centre now falls back to the midpoint of the
shorter arc from the first to the last chromatic stop.
- 4 × `suggested`, `scoreAfter`; 1 × `suggested`; 2 × with D5; 2 × with D6.

## Not changed on purpose

- The 0.02 vs 0.04/0.08 "achromatic" thresholds (documented in
  `src/scoring-model-v1.ts` and `spec/scoring-v1.md`).
- `hexToRgb`/`rgbToHex` still map garbage to NaN / "NaN" text: they are low-level
  converters; every scoring/CSS entry point validates first.
- Positions outside 0–100 still render in CSS; they are only unscorable.
