# Scope

Gradient Studio is a **deterministic smoothness metric and linter for CSS
gradients**: one scorer that says how smooth a gradient is (0–100), why (coded,
located findings) and what to change (a refinement). The web app is the
playground and the documentation for that metric. The plan behind this is
[`docs/PLAN.md`](docs/PLAN.md).

## The core

The core is `packages/core/src/gradient-engine.ts`, `color-formats.ts` and the scoring
model `scoring-model-v1.ts`. It is:

- **pure functions** — same input, same output; no clock, no randomness, no
  global state, no mutation of arguments;
- **free of I/O** — no network, no storage (cookies, `localStorage`, files), no
  DOM, no Node globals; browser- or platform-bound code (e.g. `clipboard.ts`)
  lives in the app or in an adapter, never in the core;
- **zero runtime dependencies**;
- **explainable** — every point the score takes off maps to one published,
  coded rule in [`spec/scoring-v1.md`](spec/scoring-v1.md), with its thresholds
  in the frozen `V1_MODEL` table.

Spokes (CLI, lint rules, editor and agent integrations, the web app) contain
adapters and UI, **never scoring logic**.

## What is in scope

- Scoring, explaining and refining linear CSS gradients within a documented
  input domain (v1: opaque `#rrggbb` stops, at least two, positions 0–100;
  everything else is reported as unscorable rather than guessed at).
- Parsing gradient CSS well enough to score it, with structured "skipped"
  results for what the model cannot judge.
- The colour conversions the metric needs (sRGB, OKLAB, OKLCH, the CSS named
  colours), and no more.

## What is out of scope

- **A colour library.** We do not race culori, Color.js or chroma.js on colour
  spaces, gamut-mapping variants or format coverage. A new colour space or
  format is added only when a scoring rule or the parser needs it.
- Text-to-gradient, palette-from-image, wallpaper generators and other
  generative features.
- Telemetry, accounts and cloud sync (see [`PRIVACY.md`](PRIVACY.md)).
- Anything listed under "Deliberately not doing" in `docs/PLAN.md` §9.

## Changing the metric

The characterisation vectors in `spec/vectors/` are the contract.

- **A new rule, threshold or weight needs a spec section and vectors.** Add the
  rule to the model table, document it in the spec (what it measures, formula,
  constants, penalty, location, a worked example) and add vectors that exercise
  it on both sides of each threshold.
- **v1 is frozen.** Its known defects were fixed once before the freeze
  ([`spec/vectors/CHANGES-v1.md`](spec/vectors/CHANGES-v1.md)); from now on,
  changes to scoring behaviour land in a new model version (v2) with its own
  spec and vectors, never by editing v1 in place.
- Regenerating vectors is a reviewed act: run `npm run vectors`, then
  `npm run vectors:diff`, and account for every changed case.
