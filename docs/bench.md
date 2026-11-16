# GradientBench v0

`packages/bench` (`@opal42/bench`, working name, private workspace package).
A model-agnostic, fully **offline** harness: it takes the answers some system
gave to a fixed set of UI design briefs, finds the CSS gradients in them, scores
each one with the Opal42 v1 smoothness metric, and writes a JSON summary, a
Markdown report and a static HTML leaderboard.

It never calls a model, never touches the network, and needs no API key. You run
the prompts yourself, with whatever model, agent or tool you want to test, and
hand the answers back as a JSONL file.

## What it measures, and what it does not

**It measures** how smooth the gradients in the answers are, by the Opal42 v1
definition ([`spec/scoring-v1.md`](../spec/scoring-v1.md)): lightness, chroma,
hue and spacing findings on the colour stops, in OKLAB/OKLCH. Plus bookkeeping
statistics: did the answer contain a gradient at all, how many could be scored,
which finding codes are common, and how far refine would move the colours.

**It does not measure** aesthetics, brand fit, usability, accessibility,
originality or human preference. A gradient can be perfectly smooth and ugly,
or off-brand, or unreadable under its text. Briefs with brand or contrast
constraints are in the set so that you can *see* what the answers do, but the
score does not check the constraints.

### The circularity caveat

The score that GradientBench reports is the same score that the `refine` step
(and therefore the `gradient-quality` skill) optimises. A condition that runs
the skill is, by construction, expected to score higher. **A with-skill gain is
not evidence that the metric is right.** It shows only that an agent can follow
instructions that reduce the findings of a function, which is the thing the
function was built to enable. Validating the metric needs human judgements
(see the companion study below), and PLAN D5 stays in force: until such a
result exists the score is called a *smoothness score by our definition*, there
is no default threshold, and no leaderboard of real models is published or
implied by this repository.

Every report therefore carries this block, verbatim, at the top, and no option
removes it:

> Measures perceptual smoothness by the Opal42 v1 definition - not aesthetics,
> brand fit or human preference; the same metric drives the refine step, so
> with-skill gains are expected by construction and are not validation of the
> metric.

Reports also carry provenance: bench version, scoring model (`v1`), core
version, the brief-set name, version and hash, bootstrap settings and the source
file names. Results scored against different brief sets cannot be merged.

## Quick start (from a checkout)

```sh
npm ci
npm run build -w @opal42/gradient -w @opal42/bench      # the CLI runs from dist/
alias opal42-bench='node packages/bench/dist/cli.js'    # or: npm run bench -- <command>

opal42-bench validate-briefs
opal42-bench prompts --condition baseline --with-skill --out prompts.jsonl
# ... run prompts.jsonl through YOUR model or agent, outside this repository ...
opal42-bench score results.jsonl --out summary.json
opal42-bench report summary.json --out report/
```

`report/` then holds `summary.json`, `report.md` and `leaderboard.html`.

The folder [`packages/bench/examples/`](../packages/bench/examples/) holds a
**synthetic** run: `synthetic-results.jsonl` (38 hand-written answers, every line
marked `"synthetic": true`) and the three outputs derived from it in
`synthetic-report/`. They exist to test the harness and show the formats. They are
not model results, and the reports built from them say so in a banner.

## Commands

| Command | What it does |
|---|---|
| `validate-briefs [file]` | Checks a brief set against the schema (default: the shipped set). |
| `prompts [options]` | Prints the briefs as JSONL `{briefId, category, condition, prompt}`, one line per brief and condition. |
| `score <results.jsonl or ->... [options]` | Extracts and scores the answers; prints (or writes) summary JSON. |
| `report <summary.json>... --out <dir>` | Merges summaries and writes `summary.json`, `report.md`, `leaderboard.html`. |

`prompts` options: `--briefs <file>`, `--condition <name>[=<file>]` (repeatable),
`--with-skill` (shorthand for `--condition with-skill`), `--prefix <file>`,
`--template <file>`, `--out <file>`.
`score` options: `--briefs <file>`, `--tailwind-palette <file>`, `--out <file>`,
`--strict`. `-` reads standard input.

Exit codes: `0` success; `1` unusable input or data (unreadable or invalid files,
no valid records, mismatched brief sets, unwritable output; with `--strict` also
any diagnostic); `2` usage error. `run(argv, io)` never throws; it is exported
with an injectable `io` (stdout, stderr, file system, stdin) for tests.

## The brief set

`prompts/briefs.json`: 100 briefs, ten categories of ten, each
`{ id, category, brief, constraints?, brandColors? }`. Schema:
`prompts/briefs.schema.json`; the same rules are enforced by
`opal42-bench validate-briefs` and by the tests.

| Category | What it probes |
|---|---|
| `saas-hero` | Large hero backgrounds behind a headline. |
| `ecommerce-banner` | Promotional strips and seasonal banners. |
| `dashboard-card` | Subtle card and widget fills. |
| `mobile-splash` | Full-screen portrait backgrounds. |
| `dark-mode-button` | Small controls on dark pages. |
| `dataviz-heat-strip` | One-dimensional ordered colour scales. |
| `marketing-landing` | Section backgrounds on landing pages. |
| `game-ui` | Bars, frames and overlays. |
| `brand-constrained` | A brief with `brandColors` the answer should stay inside. |
| `accessibility-constrained` | Contrast and colour-vision constraints in `constraints`. |

**Authoring policy** (also in the file's `authoringPolicy` field):

- Written by the Opal42 maintainers for this project. No third-party copy is
  copied or paraphrased.
- Company, product and brand names are invented. Any resemblance to a real
  organisation is coincidental; no endorsement is implied. A test rejects a list
  of well-known brand names and any URL, e-mail address or trademark sign.
- A brief describes a situation, never a gradient: no `gradient(` in the text,
  so every model chooses its own colours. Hex values appear only as
  `brandColors` or as stated text colours in constraints; they are arbitrary
  design values, not anyone's trademarked palette.
- Changing a brief changes the **brief-set hash** (SHA-256 of the canonical JSON
  of the `briefs` array, first 16 hex digits). A test pins the hash, so a change
  is a deliberate act and old results stop being comparable by design. Bump the
  `version` field when you do.

### Prompts and conditions

`prompts` renders each brief into a prompt with `DEFAULT_TEMPLATE` (a short
designer instruction, the brief, its constraints and brand colours, and a request
to write out every gradient in full). Placeholders in templates and prefixes:
`{{id}}`, `{{category}}`, `{{brief}}`, `{{constraints}}`.

A **condition** is a name plus optional text appended to the prompt.

- `baseline`: no extra text.
- `with-skill`: appends an instruction to read
  `skills/gradient-quality/SKILL.md` and follow it. The text points at the skill
  in this repository; how your system gives the model access to it, and to the
  `opal42` tools, is up to you. Say in your own write-up what the model could
  actually run.
- Any other name needs its text: `--condition my-prompt=my-prompt.txt` appends
  the file's contents. Use this for system-prompt variants, different tools,
  few-shot examples, a different skill, and so on. Add as many as you like; the
  report compares each against `baseline`.

Use the same `model` string for the conditions of one model: pairing is per
model.

## The results file

One JSON object per line, produced by whatever runs your prompts:

```json
{"briefId":"saas-hero-01","model":"my-model-2026-01","condition":"baseline","output":"...the full answer text..."}
```

Optional fields: `"sample"` (non-negative integer, default 0, for repeated
samples of the same brief; samples are averaged per brief before pairing) and
`"synthetic": true` (marks hand-written test data and switches on the SYNTHETIC
banner). `model` and `condition` are 1 to 100 characters of letters, digits and
`_ . : / @ + space -`. Blank lines are ignored. Bad lines, unknown brief ids and
duplicate `(briefId, model, condition, sample)` keys become *diagnostics*, which
are printed, stored in the summary and shown in the reports; the record is left
out. Briefs absent from a file are simply not scored (the report shows coverage).

## Extraction

`extractGradients(output)` finds gradients in arbitrary text using core's
`parseGradient` (a scanner, not a CSS parser: spec/parser.md) plus the layers
below. It never throws and is deterministic. What is supported, exactly:

| Form | Handled |
|---|---|
| CSS in prose, inline code, fences of any language, HTML `style`, SCSS, Less, JS/TS strings, template literals, JSX style objects, styled-components | Yes, by `parseGradient`. |
| Valid JSON (the whole answer, or a ```` ```json ```` fence) | Parsed; every string value is scanned, escapes decoded exactly. |
| Text with JSON escapes (`\"`, `\n`, `\uXXXX`) but not valid JSON | A decoded copy is scanned and used when it finds at least as many parseable gradients as the raw text. |
| Tailwind arbitrary values `bg-[linear-gradient(to_right,#fff,#000)]`, `bg-[image:...]`, `[background-image:...]`, v4 `bg-linear-[25deg,red_5%,blue]` | Yes. `_` becomes a space, `\_` stays an underscore; variant prefixes (`dark:`, `md:`) are accepted. The bracket must close before whitespace or a quote. |
| Tailwind utilities `bg-gradient-to-<dir>` (v3), `bg-linear-to-<dir>`, `bg-linear-<angle>` (v4), with `from-` / `via-` / `to-` colour tokens and `from-10%` position tokens | Yes, for colours that can be resolved: arbitrary values (`from-[#ff0000]`), `white`, `black`, `transparent`, `current`, and opacity modifiers (`from-white/50` becomes an alpha colour, which the scorer then reports as unscorable). Interpolation modifiers (`/oklch`, `/srgb`, `/longer`, ...) are passed on. |
| Tailwind palette colours (`from-indigo-500`) | **Only if you supply a palette**: `score --tailwind-palette palette.json`, a JSON object `{"indigo-500": "#6366f1", ...}`. Without it the gradient is reported as skipped with code `tailwind-palette-colour`; the harness never guesses the palette. The number of entries is recorded in the provenance. |
| State variants (`dark:from-...`) | Each variant with its own stops is a separate gradient; parts it does not set are inherited from the unprefixed group. |
| `radial`/`conic` (CSS or Tailwind) | Found, reported skipped (`unsupported-kind`). |
| Variables | `--x` (as `var(--x)`, with or without fallback) or SCSS `$x` defined **exactly once** in the same answer with a literal colour is substituted. Defined twice (for example a dark-mode override), or not a colour, left as is: the gradient is skipped (`var`, `preprocessor`, ...). |
| Not supported | `@apply`, theme tokens or plugins that hide the colours, gradients assembled at run time, images, any Tailwind config that is not in the answer. One-sided Tailwind gradients (`to-*` only) are reported `tailwind-incomplete`. |

Counting rules, which affect every statistic:

1. **Identical gradients count once** per answer (same stops and angle, or the
   same skipped text), whether they appear in prose, in code, or in both.
   `duplicatesDropped` records how many were merged.
2. **Documentation placeholders** (`linear-gradient()`, `linear-gradient(...)`,
   `linear-gradient(<angle>, <color-stop-list>)`) are ignored.
3. **Vendor-prefixed** gradients (`-webkit-linear-gradient(...)`) are counted as
   found and reported skipped (`legacy-syntax`), as the parser reports them; they
   are not merged with their unprefixed twin, so an answer that adds fallbacks
   lowers its own scorable ratio.
4. Answers longer than 500,000 characters are cut (note `truncated`).

Each gradient is then either **scored** (core `score` returned a number),
**unscorable** (parsed, but core declines: alpha, repeating, ...) or **skipped**
(the parser declined: `var`, `calc`, radial, ...). The code is kept.

## Per-brief and aggregate statistics

For every `(brief, model, condition, sample)` record: `found`, `scored`,
`anyGradientFound`, `scorableRatio` (scored / found, null when none found),
`minScore`, `meanScore` (null when nothing was scored), `findingCodes` (count of
scored gradients carrying each v1 code, once per gradient) and the refine
statistics below.

**Would refine change the colours a lot?** For every scored gradient the harness
runs core `refine` and compares each original stop with its refined stop by
OKLAB Euclidean distance (ΔE; black to white is 1.0). Per gradient: the mean and
the maximum. A gradient counts as *colour-changed* when its maximum is above
0.0005 (refine also rewrites positions, which is not a colour change). The
aggregates are the share of gradients colour-changed, the mean ΔE over those,
the share of those with mean ΔE at or above 0.05 (a **reporting bucket, not a
quality threshold**, fixed in `constants.ts`), and the mean score gain per scored
gradient. These expose how drastic the fixes would be: a condition that scores
high because its colours are already smooth looks different from one that would
need big repairs.

Group aggregates (per model and condition, pooled per condition, pooled per
model) use the per-record `meanScore` as the unit: count, any-gradient rate,
micro scorable ratio (scored / found over all gradients), mean, median, standard
deviation, quartiles, min and max of the unit, the mean of per-record minima, a
10-bin histogram (`[0,10)` ... `[90,100]`), the finding-code frequencies (share of
scored gradients) and the refine block. Pooling over models is arithmetic
convenience, not a claim that the models are exchangeable.

## Paired comparison

For each model that has a `baseline` condition and at least one other, each
other condition is compared with the baseline on **briefs scored in both**
(samples averaged per brief; briefs missing on either side, or without a scored
gradient, are counted as *unpaired* and left out). With differences
`d = condition - baseline` in score points:

- **Mean difference** and a **paired bootstrap percentile interval**: resample
  the pairs with replacement 2,000 times with a seeded PRNG (mulberry32, seed
  fixed in `constants.ts`), take the mean each time, report the 2.5th and 97.5th
  percentiles (linear interpolation, R type 7). Implemented in
  `src/stats.ts`; no dependency.
- **Wilcoxon signed-rank p-value**, two-sided. Zero differences are dropped,
  `|d|` ranked with midranks. For up to 50 non-zero pairs the p-value is the
  exact permutation p-value given those ranks; above 50 it is the normal
  approximation with tie and continuity corrections. Reference values the tests
  check: the SciPy-documentation example (W+ = 40, W- = 5, two-sided p =
  0.0390625), and the smallest possible p for n = 5 (0.0625) and n = 6 (0.03125).
- better / tied / worse counts.

Read them with care. The brief set is small, so intervals are wide. The tests
are not corrected for multiple comparisons when you add conditions. Briefs are
treated as exchangeable draws, which they are not (categories differ). A narrow
interval around a positive difference for a with-skill condition says *the
function that the skill optimises went up*, which is what the circularity caveat
predicts.

## The reports

- `summary.json` (`schemaVersion: 1`): caveat, provenance, diagnostics, the
  group aggregates, pooled aggregates, pairs and all per-brief records with
  their per-gradient detail (gradient text is cut to 200 characters; the full
  answers are not stored). Numbers are rounded to 4 decimals so the file is
  byte-stable. It contains no dates, host names or absolute paths.
- `report.md`: the same content as tables, caveat first.
- `leaderboard.html`: one self-contained file. Inline CSS and a small inline
  script (theme toggle and sortable columns; everything is readable without it);
  no external assets, fonts, links or network calls (a test scans for any URL,
  `src`/`href`, `url(`, `@import`, `fetch`, storage). Light and dark follow
  `prefers-color-scheme`, with a toggle. Semantics: landmarks, one `h1`, a skip
  link, captions and scoped headers on every table, every SVG chart has an
  accessible name and description, and the numbers are always in the adjacent
  tables. A vitest-axe run over the generated page passes (jsdom cannot measure
  colour contrast; the palette was checked by hand: body text 15.9 to 17.4:1,
  muted text 8.9 to 9.4:1, chart colours at least 6.1:1, in both themes).

The leaderboard is sorted by mean score, highest first. That ranks smoothness by
one definition and nothing else; the caveat sits above it.

Reports are deterministic: same results and same versions give the same bytes.
`report` merges any number of summaries from the same brief set; duplicate
records across them are dropped with a diagnostic. The synthetic example's
outputs are golden files in the tests (`UPDATE_GOLDEN=1 npx vitest run
tests/report.test.ts` rewrites them after an intended change).

## Running it against your own model, outside this repository

1. `opal42-bench prompts --condition baseline --with-skill --out prompts.jsonl`
2. Write a small script in your own project that reads each line, sends `prompt`
   to your model or agent (with your own credentials, in your own environment),
   and appends `{ briefId, model, condition, output }` to `results/<run>.jsonl`.
   Nothing in this repository does that for you, deliberately: no model client, no
   key handling, no network code.
3. For a with-skill condition, give the model whatever the skill needs (the
   skill file, a shell with `npx opal42`, or the MCP server) and record in your
   write-up exactly what it had.
4. Use a sensible number of samples (`sample`) if the model is stochastic.
5. `opal42-bench score results/<run>.jsonl --out summary.json`, then `report`.
6. Publish the `summary.json` and the brief-set hash with any claim you make, and
   keep the caveat.

## Limitations

- **One metric, not validated.** See above. Smoothness is a defensible
  perceptual property of a colour ramp; whether people prefer smooth gradients is
  a separate question.
- **Prompt-set bias.** 100 briefs written by one team in one sitting over-
  represent the situations its authors imagine (English, Western web UI, light
  copy). Briefs do not ask for unusual gradients (hard stops, stripes, glassy
  multi-layer effects) so the set under-samples where the metric is least
  meaningful. The number 100 gives wide intervals. The wording ("Calm,
  trustworthy") nudges toward certain palettes; different wording may change
  results.
- **Extraction is part of the measurement.** What the extractor cannot parse
  lowers the scorable ratio and is invisible to the score. Tailwind palette
  classes need your palette; other build-time indirection is not resolved.
- **Skipped is not bad.** `var()`, alpha fades, radial and conic gradients are
  legitimate and common; they are not judged. A model that uses them more will
  look "less scorable".
- **No semantic checks.** Brand, contrast, colour-blindness and text legibility
  constraints in the briefs are shown to the model but not verified.
- **Unit of analysis.** One number per brief hides how many gradients an answer
  had; the per-gradient detail is in `summary.json`.
- **v1 ignores interpolation space and angle.** The score looks at the stops
  only (spec/api.md); two answers that differ only in `in oklch` score the same.
- **Core drift.** Scores come from the installed `@opal42/gradient`; the version
  is in the provenance. Compare only runs scored with the same scoring model.

## Recommended companion study (not run)

Before anyone treats a GradientBench number as quality, run a human-preference
study and publish it first (PLAN D5, optional Phase 0.5): sample gradients from
answers across the score range for the same brief, show pairs (or small sets)
to raters blind to model, condition and score, in a neutral layout and in
context (a mock of the component, not the bare ramp), ask for preference and, 
separately, for visible banding or "muddiness", and compare rater agreement with
the score ordering (rank correlation, and the rate at which the smoother
gradient is preferred, with intervals). Pre-register the analysis, include
rater-agreement baselines, recruit across design experience and colour vision,
and report the cases where the metric and the raters disagree. Nothing of this
has been done; no result of it is claimed anywhere in this repository.

## Privacy

The harness reads the files you name and writes the files you name. There is no
telemetry and no network code. Results files contain model answers; treat them as
you would any prompt log. `summary.json` stores gradient snippets (at most 200
characters each), model and condition names, and counts, not full answers.
