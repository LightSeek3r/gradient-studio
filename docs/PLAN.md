# Gradient Studio — Ecosystem Plan

Status: proposal for owner review · 2026-11-15
Method: two Haiku code audits → four Sonnet research slices → Fable architecture/roadmap → Opus adversarial review → this revision. Evidence is in [`docs/plan-research/findings.md`](plan-research/findings.md). Items marked **(U)** are unverified and gated in §8.

---

## 1. Thesis

Gradient Studio is today an algorithm plus a web page. The plan: make it **the quality metric and linter for gradients, wherever gradients are authored, reviewed or generated** — one deterministic scorer that says *how good* (0–100), *why* (coded, located issues) and *what to do* (a refinement), exposed as a library, CLI, lint rules, editor hints, agent tools and, later, design-tool and browser plugins. The web app stays as the playground and docs for the metric.

**Why this survives native `linear-gradient(in oklch, …)`** (Baseline "newly available" since 2024-06; "widely available" about now): browsers can now *interpolate* well but cannot *judge* — which stops, how much hue/chroma travel, dead zones, banding, gamut, which space and hue path to pick. Nobody else scores: culori / Color.js / chroma.js are colour math; postcss-easing-gradients and Josh Comeau-style recipes give fixes without diagnosis.

**Honest caveat that shapes the whole plan:** nobody has yet checked that this score matches human judgement. Until that's done (the optional Phase 0.5 survey, currently passed on), it is a "smoothness metric by our definition", not a quality oracle, and must not be sold as one.

**Principles.** Core = pure functions, zero runtime deps, no network/storage/DOM/Node globals. Deterministic *within one JS implementation*; ports conform on non-boundary vectors (see §3.3). Explainable: every point lost maps to a published, coded rule. No telemetry in any product surface; any research data collection is separate, explicit and documented. MIT.

---

## 2. Where the code stands (audit, verified)

| Finding | Where | Consequence |
|---|---|---|
| Engine + formats are pure TS (no DOM/Node/random); only `clipboard.ts` is browser-bound | `src/gradient-engine.ts` (713 L), `color-formats.ts` (483 L), `clipboard.ts` | Ideal core; clipboard becomes an app adapter |
| No tests, no test script | `package.json` | Tests are the first deliverable |
| Mixed units (RGB 0–255, `linearToSrgb` 0–1→0–255, HSL 0–100, position 0–100, weight 1–100 unenforced); hex-string-only inputs | engine:52–85, formats | Public API needs one units policy |
| Score = integer step penalties at hard thresholds (~35 magic numbers; weights 30/30/20/20) | `scoreGradient` 167–498 | Boundary sensitivity; ports need care (§3.3) |
| Issues are 22 free-text strings, **and four penalties emit no issue at all** (arc <15° −5; edge gap >10 −3; span <40 −4; cv >0.25 −4) | engine:313–315, 459–460, 469–470, 488–489 | Breaks "every point maps to a rule" |
| Invalid hex scores 100; `refine` yields `#NaNNaNNaN` | `Math.max(0, NaN)` ≈ engine:231 | Must return `unscorable` |
| Alpha not modelled (black→transparent reads as `#000→#000`, "invisible", 79) | — | Scrims are false positives |
| Hard stops (stripes) penalised; `refine` smooths them away; achromatic stops get recoloured (`#808080`→`#d99100`) | engine:540, 551–554 | `refine` must not "improve" by destroying intent |
| `interpolateGradient`: for t before the first stop frac goes negative; after the last stop it interpolates first↔last, skipping middle stops | engine:683–700 | Real bug (stops at 20/80: `#2300ff` instead of `#0000ff` at t=1) |
| `parseName("constructor")` returns an `Object` member | formats:405 | Use `Object.hasOwn`/`Map` |
| Already guarded (regression tests, not fixes): `n<=1` early return, `avgV>0`, `>0.04`, `avgGap>0`, `span===0` | engine:676, 274, 401, 480, 700 | — |
| Only the 3c muddy-midpoint check (≈386–412) and its rationale are sRGB-specific; everything else measures OKLAB stop-to-stop | engine | "v1 assumes sRGB" is only partly true |
| Score is computed on the stop list, but `App.tsx:82–83` renders the alpha-layered multi-direction stack | App.tsx | Today's score doesn't describe exactly what the user sees |
| Web app: six `useState`s, no document type, no persistence/URL state/undo; `App.tsx` not reusable; global CSS leaks; stop bar & compass mouse-only; no `:focus-visible`; dark-only | App.tsx, App.css | Needs a `GradientDocument` and a11y pass |
| CI: lint + build only; Cloudflare Pages deploy config not in repo | `.github/workflows/ci.yml` | Add tests, release, deploy-as-code |

---

## 3. Architecture

### 3.1 Hub and spoke

```
              ┌────────────────────────────────────────────┐
              │ SPEC + GOLDEN VECTORS (the contract)       │
              │ spec/scoring-v1.md · spec/vectors/*.json   │
              └───────────────────┬────────────────────────┘
                                  │ generated from / verified against
              ┌───────────────────▼────────────────────────┐
              │ @scope/core   (pure TS, zero deps)         │
              │ .  ./color  ./names  ./css (parser)        │
              └──┬──────────────┬──────────────┬───────────┘
                 │              │              │
        ┌────────▼──┐   ┌───────▼───────┐  ┌───▼───────────────┐
        │ CLI       │   │ apps/web      │  │ ports (on demand) │
        └──┬─────┬──┘   │ playground +  │  │ read vectors only │
           │     │      │ docs          │  └───────────────────┘
   ┌───────▼─┐ ┌─▼────────────┐
   │stylelint│ │Action·hooks  │   Agent surfaces: Skill → MCP (stdio → Worker)
   └─────────┘ └──────────────┘   Later: VS Code · DevTools ext · Figma
```

Rule: a spoke contains adapters and UI, **never scoring logic**.

### 3.2 Repo layout (npm workspaces — the repo already uses npm)

```
packages/core/   packages/cli/   packages/stylelint-plugin/   packages/mcp/
apps/web/        (current app, private, Cloudflare Pages)
spec/            scoring-v1.md, vectors/
skills/          gradient-quality/SKILL.md
```

### 3.3 Contract: spec + vectors (revised after review)

The score is a sum of integer penalties at hard thresholds (`de>0.15`, `cv>0.8`, `enclosingArc>180`, `worstDip>0.5`…). A 1-ulp difference at a threshold can move a score 8–20 points, and JS/Python differ in `Math.pow`/`atan2` precision and rounding (`Math.round` half-up vs Python banker's). Therefore:

- Vectors store **intermediate measurements** (maxΔE, velocity CV, arc, worstDip, banding steps) with a tolerance, **plus** the final integers and CSS/hex strings.
- The generator marks any case within ε of a threshold `boundary: true`. Ports must match **exactly on non-boundary cases**; boundary cases check intermediates only.
- Principle reworded accordingly. Drop "±0.5 before rounding" (there is no pre-rounding score).

### 3.4 Core API sketch (1.0 target)

```ts
type ColorInput = string | { l: number; c: number; h: number; alpha?: number };
interface Stop { color: ColorInput; position?: number /*0–1*/; id?: string }
interface GradientDocument {
  kind: 'linear'; angle: number /*deg, CSS*/; stops: Stop[]; repeating?: boolean;
  interpolation?: { space: 'srgb'|'oklab'|'oklch'; hue?: 'shorter'|'longer'|'increasing'|'decreasing' };
}
interface Issue { code: string; severity: 'error'|'warning'|'info';
  dimension: 'lightness'|'chroma'|'hue'|'spacing'; stopIndex?: number;
  range?: { start: number; end: number }; message: string; penalty: number }
type ScoreResult =
  | { status: 'ok'; score: number; dimensions: Record<Issue['dimension'], number>; issues: Issue[]; scoringModel: 'v1'|'v2' }
  | { status: 'unscorable'; reason: string };

parseGradient(css): { gradients: { document|null, range, stopRanges, skipped? }[] }   // never throws
score(doc, { scoringModel? }): ScoreResult
refine(doc): { document, before, after }   // guarantees after.score >= before.score, else returns input unchanged
toCSS(doc, { fallback?: boolean }): string
bakeStops(doc, n): Stop[]                  // pre-sampled, gamut-mapped, alpha-aware
complement(color): string
```

**Units policy:** sRGB channels 0–1; L 0–1, C ≥ 0, hue [0,360); alpha 0–1; positions 0–1; angles in CSS degrees; direction weight 0–1 and validated. Percent/0–255 appear only in CSS strings. Failures are values (`null`/`unscorable`/`skipped`), never sentinels like `"#ccc"` or `"#NaNNaNNaN"`.

### 3.5 Scoring-model versioning (revised)

- **v1 input domain: opaque `#rrggbb` stops, ≥ 2 stops.** Anything else → `unscorable` (or a structured parser skip). Alpha-varying, hard-stop and `repeating-*` gradients are skipped by lint by default.
- **v1 = today's behaviour, frozen as characterised by vectors** — but *known defects are fixed first, once, before freezing* (Phase 0 task 9–12): NaN/invalid input, the four silent penalties get `info` codes, the `interpolateGradient` bracket bug. Freezing bugs would bake them into a public contract.
- **v2 (interpolation-aware) is research, not refactoring, and is NOT in Phase 1.** Concept: sample the rendered path (N points in the document's space, gamut-mapped per CSS Color 4) and compute every dimension on the samples. Open problems: muddy-midpoint rule is moot under `in oklch`; the ">180° arc" rule must be redefined per hue path (a shorter path can't exceed 180°); banding uses 8-bit sRGB deltas; new failure modes (mid-path gamut excursion, unexpected hues, powerless hue on greys). Timeboxed spike → `spec/scoring-v2.md` → decide.
- **One rule (D8):** core ships v1-only until v2 vectors exist; the model is always echoed in results/CLI JSON; no silent default flip within a major. The web app pins v1 until it ships a visible interpolation selector.
- `refine` guarantees: never lowers the score, keeps hard stops, keeps achromatic stops achromatic — otherwise returns the input unchanged.

---

## 4. Decisions

**D1. Naming — decided (working name), pending availability and trademark checks.**
"Gradient Studio" is generic and already in use (a Peerlist project, Taskade templates, a near-identical ChatGPT app "Gradients Studio"); agent directories are exactly where we want to be found. `@unit42/*` is **avoided**: Unit 42 is also Palo Alto Networks' threat-intelligence brand. The owner proposed **`@opal42`**, and it is adopted as the publisher scope: it keeps the "42" tie to the owner's Unit42 brand without the "Unit" overlap, and an opal's play of colour is an apt image for gradients.
- **App and repo:** stay "Gradient Studio".
- **Packages (working names):** `@opal42/gradient` (core), `opal42` (CLI; `npx opal42 score …`, bin `opal42`), `@opal42/stylelint-plugin`, `@opal42/mcp`. The metric is called the **Opal score** (descriptive fallback: "gradient smoothness score").
- **Not yet verified (the owner must do the first, I can't from this environment):** (a) the `@opal42` npm org/scope is actually claimable — unscoped names `opal42`, `opal-gradient`, `opalgrade`, `chromalint`, `gradelint`, `oklint`, `gradescore` returned 404 on the npm registry, which is *not* proof the scope is free; the GitHub API was blocked here, so the `opal42` GitHub org/user is unchecked too; (b) "Opal" is a crowded word in software — notably **Opal, the Ruby-to-JavaScript compiler** (its own CLI is `opal`, hence the bin name `opal42`), plus consumer apps — so run an INPI/EUIPO/USPTO check (software classes 9/42) before the first publish; (c) JSR scope.
- **Fallback:** `@lightseek3r/*`. Do **not** squat PyPI/crates.io placeholders (crates.io policy; PyPI PEP 541). Below, `@scope/…` = `@opal42/…` while the working name holds.

**D2. Browser extension — Phase 3 at most, DevTools panel only.** Reach is real (D report), but it needs the parser proven on real CSS, and a store account is the juiciest phishing target a solo maintainer can own. Needs hardware-key 2FA + dedicated publisher account first. Popup/context menu/EyeDropper cut from v1 (the web app is the editor).

**D3. Break the API once, now.** The package is `private` at 0.1.0 with no consumers. Publish `0.x` until the stylelint plugin and MCP server both consume it; 1.0 only then.

**D4. No public REST product.** One stateless Worker later, solely for remote MCP. Hosted privacy wording: "stateless: no storage, no request-body logging, no cookies; Cloudflare, as processor, still sees IP addresses (personal data under GDPR)". Disable Workers Logs/observability/Logpush explicitly. "Nothing leaves your device" is reserved for app, library, CLI, extensions.

**D5. Be honest about an unvalidated metric.** Owner passed on the validation survey for now (Phase 0.5 is optional). Until a human-agreement result exists: no default `min-score` threshold, neutral wording in the UI/CLI/Skill ("smoothness score", not "quality"), and the bench is labelled as smoothness-only. If the survey is run later, publish its result before adding defaults.

**D6. Capacity cap:** at most **six maintained surfaces through Phase 2** — core, CLI, stylelint plugin, MCP+Skill (counts as one), web app, GitHub Action. JSR, PWA, Worker, bench, pre-commit are folded in or moved later (see roadmap). A surface missing its continue-gate is archived with a README note.

**D7. Parser scope (1.0):** hex / rgb / hsl / named / oklab / oklch, `linear-gradient` incl. `to <side>`, missing/double positions, hints, `in <space>` clauses, `repeating-*` (parsed, skipped for scoring). **Structured skip** for: `var()`, `calc()`, `currentColor`, `color-mix()`, relative colour syntax, `color(display-p3…)`/`lab()` (wide-gamut, can't be judged by sRGB v1), `transparent`/alpha (premultiplied interpolation), radial/conic, `-webkit-linear-gradient` (different angle convention) and `-webkit-gradient()`, multi-layer `background` shorthand with `url()`. **Stated coverage gap:** Tailwind classes and CSS-in-JS gradients are outside stylelint's reach.

**D8. v2 rule** — see §3.5.

**D9. Resolve the "widely available" row now:** `toCSS` sRGB fallback **off by default**, opt-in.

---

## 5. Surface portfolio

Effort: S ≤ 1 wk · M 2–4 · L > 4 (solo). Value 1–5.

| Surface | Tier | Eff | Val | Depends on | Note |
|---|---|---|---|---|---|
| Tests + frozen v1 vectors | **NOW** | S | 5 | — | Safety net for all |
| Core package (npm) | **NOW** | M | 5 | tests, defects fixed | Root dependency |
| Parser with source ranges | **NOW** | M-L | 5 | core | Hardest piece; own line item |
| Launch write-up ("why your gradient looks muddy") + shareable playground URLs | **NOW** | S | 4 | web app URL state | Cheapest demand probe, before the CLI |
| Metric validation survey | OPTIONAL | S-M | 5 | — | Owner passed for now; D5 labelling rules apply instead |
| CLI (`score`/`refine`/`--json`/`--min-score`) | **NOW** | S | 5 | parser | Substrate for Action/hooks |
| Stylelint plugin (+autofix, opt-in) | NEXT | M | 5 | parser ranges | Best differentiation; no default threshold (D5) |
| GitHub Action + pre-commit recipe | NEXT | S | 4 | CLI | Thin wrappers |
| Agent Skill → MCP stdio | NEXT | S-M | 4 | CLI/core | Strongest niche; no hard-coded threshold (D5) |
| Web app: URL state, paste-CSS import, a11y, PWA SW | NEXT | M | 4 | core | App = docs/demo |
| JSR publish | NEXT | S | 2 | explicit return types | Near-free |
| Remote MCP (stateless Worker) | LATER | S | 3 | MCP stdio, privacy wording | |
| GradientBench ("smoothness by our metric", not validation) | LATER | M | 3 | CLI, Skill | Awareness; labelled smoothness-only (D5) |
| VS Code (+Open VSX (U)) | LATER | M | 4 | parser ranges, stylelint proof | |
| Chrome/Edge+Firefox DevTools panel (WXT) | LATER | M | 4 | core 1.0, account security | D2 |
| Figma plugin | LATER | M | 4 | `bakeStops`, matrix helper | Figma lacks interpolation spaces |
| Tailwind export, native templates (SwiftUI/Compose/Flutter/Godot via pre-sampled stops) | LATER | S | 3 | `toCSS`/`bakeStops` | Start as web-app export formats |
| DTCG / Style Dictionary | LATER | S-M | 3 | read DTCG gradient shape (U) | |
| Web component, Raycast | ON DEMAND | S-M | 3 | core | Needs a requester |
| PostCSS, React hook, LSP, ESLint rule | ON DEMAND | S–L | 2 | | Stylelint `--fix` covers PostCSS |
| Python → Rust/Swift/Kotlin ports | ON DEMAND | S-M each | 2–3 | vectors | Permanent maintenance tax |
| REST API, Satori OG, Tauri, Win Command Palette, Obsidian/Alfred, Framer/Webflow/Canva/Penpot | ON DEMAND | | 1–3 | | Named requester first |
| Safari, Sketch/Adobe/Affinity/XD, Notion, bots, native OS plugins, mobile apps, Electron | **SKIP** | | 1 | | Fees, immaturity, no extension point, or breaks privacy story |

**Honest take on "OS plugin":** nothing OS-level beats an installable PWA + CLI. Native macOS/Linux plugins would require re-implementing the engine in Swift/Kotlin for ~no reach.

---

## 6. Roadmap (calendar weeks, solo part-time, ±50%; gates in weeks from project start)

### Phase 0 — Foundations (weeks 1–4)
Goal: engine tested, defects fixed, frozen as v1, in a workspace; web app unchanged except bugfixes.

1. **Pick the name (D1)**; run the trademark/registry search; claim the npm org/scope and JSR scope; hardware-key 2FA on npm + GitHub.
2. Add Vitest + `npm test`; add to CI. (`color-formats.ts` imports `./gradient-engine` extensionlessly → use Vitest/vite-node, not bare Node.)
3. Characterisation harness: dump `scoreGradient`, `suggestGradient`, `buildGradientCSS`, `interpolateGradient` over a ~300-gradient corpus (hand-picked, preset-like, seeded random) **against the unmodified engine**, including intermediate measurements and `boundary` flags.
4. Hue-wraparound tests: `oklabToLch` (147–151), hue logic ≈301/331/526/543–544; 359°/1° pairs; opposed-hue circular-mean degeneracy.
5. Regression tests for the already-guarded divisions (276/401/480/700; `n<=1`).
6. `gamutFitOklch`: bisect convergence, L outside 0–1, identity for in-gamut.
7. `srgbToLinear`/`linearToSrgb`/`hexToRgb` with negative, >1, NaN, malformed.
8. `color-formats`: prototype keys (`parseName("constructor"|"toString"|"__proto__")`), `parseHsl` bare ≤1 heuristic, parse→format→parse round-trips.
9. **Fix defects before freeze:** invalid/NaN input → `unscorable`; `interpolateGradient` bracket search (clamp to end stops; correct lo/hi past the last stop); `parseName` own-property lookup.
10. Give the four silent penalties `info` issue codes; convert the 22 `push` sites to coded issues (keep English `message` so the app renders identically).
11. Extract the ~35 thresholds + 30/30/20/20 weights into one named `V1_MODEL` table.
12. Define and document the v1 input domain (opaque hex, ≥2 stops); add `refine` guarantees (never lower score, keep hard stops, keep achromatic stops achromatic). Document the 0.02 vs 0.04/0.08 achromatic gap as v1 behaviour.
13. Convert to npm workspaces: app → `apps/web`; engine/formats → `packages/core` (tsconfig `lib: ES2022`, **no DOM**); `clipboard.ts` stays in the app. Add `compat` in the app so `App.tsx` migrates incrementally.
14. Write `spec/scoring-v1.md` from the model table (one rule per code, with formula and penalty).
15. `SCOPE.md`, `PRIVACY.md`; Cloudflare Pages deploy config in repo; CODEOWNERS + branch protection; check whether Pages Web Analytics is on for the current site.

Exit: vectors replay green; core typechecks without DOM; app numerically identical (except fixed bugs, noted in changelog). Gate: names claimable (else fallback scope).

### Phase 0.5 — Validate the metric (OPTIONAL — owner chose to pass for now)
~40 gradient pairs, 20+ raters, **run as an offline/opt-in survey** (this is data collection: needs consent text and retention rules, kept separate from the product). Report rank correlation (Spearman/Kendall) between human preference and score, per dimension.
**If skipped (current decision), D5 becomes a labelling rule instead of a gate:** the score is always described as a *smoothness score by our definition, not a quality verdict*; `min-score` has **no default threshold** (users must choose one); the Skill ships without a hard-coded "refine if < 70"; GradientBench is labelled as measuring smoothness only; the UI drops verdict words like "Excellent" in favour of neutral bands. Revisit when there is user demand for a defensible threshold.

### Track U — Web app UX (parallel to Phases 0–2; details in [`UX-REVIEW.md`](UX-REVIEW.md))
The app review found real bugs (silent wrong import of pasted CSS, a position field that re-sorts mid-keystroke, Export CSS that disagrees with the visible stops while a suggestion is shown, a no-op "Re-suggest"), measurable accessibility failures (74 contrast failures, 31 of 92 tab stops with no visible focus, mouse-only stop handles, no `aria-live`) and a layout that puts the score ~1,700 px away from the stops it scores.
- **U0 (1–2 days, no dependencies):** quick wins and bugfixes — `color-scheme`, `:focus-visible`, contrast tokens, font weights, hex export, `<main>`/`aria-live`, add-stop sampling + cap, parser rejects `gradient(`, position commit-on-blur.
- **U1 (2–3 weeks):** two-column sticky layout + mobile sheet, selected-stop inspector, pointer/keyboard handles, `GradientDocument` + undo/redo, URL-hash + autosave, paste-anywhere CSS import, honest Suggest compare.
- **U2 (after Phase 0 task 10 — coded, located issues):** issue lane, points ledger, per-issue "Fix this" with ghost preview, sparklines, delta badge.
- **U3:** export tabs, issue-code preset gallery, recent history, EN/FR, SVG icons, design-token extraction.
U0 can start before Phase 0 finishes; U1's import should reuse the Phase 1 parser (a minimal stops/angle parser can ship earlier); U2 shares its deliverable with the core API.

### Phase 1 — Library, parser, CLI (weeks 5–10)
Deliverables: new API (§3.4, v1 model only); `parseGradient` per D7 with a real-world corpus harvested from popular OSS CSS and a fuzz suite with a **time budget** (ReDoS; Worker 10 ms CPU (U)); `toCSS`, `bakeStops`; CLI (stdin/files, `--json`, `--min-score`, documented exit codes, stable JSON schema); exports map, `sideEffects:false`, size-limit/publint/arethetypeswrong (budgets from first measurement; targets ≤4 KB core / ≤3 KB colour+names gz are unmeasured); changesets + npm Trusted Publishing with provenance; app migrated via `compat`. **Launch write-up** with shareable playground URLs.
Exit: `0.x` published with provenance; parser passes corpus; CLI schema documented.
Gate (≈ week 18): any outside signal (stranger issue, dependent repo, downloads not explained by CI). None → keep going but lead Phase 2 with the Skill/awareness work rather than more tooling.

### Phase 2 — Lint and agents (weeks 11–17)
Stylelint plugin (rules: `min-score` with no default threshold (D5), per-code rules; skips alpha-varying/hard-stop/repeating by default; autofix opt-in); GitHub Action (composite over CLI) + pre-commit recipe; Agent Skill `gradient-quality` (no hard-coded threshold; D5); `@scope/mcp` stdio with `score_gradient`, `refine_gradient`, `complement`, `render_preview` (**escape/allow-list all SVG inputs**); MCP Registry entry; web app URL-hash state, paste-CSS import, PWA service worker, a11y fixes (§7). **Core 1.0** only after stylelint + MCP both consume it.
Exit: stylelint runs on two third-party codebases without false-positive storms; MCP works in two different clients.
Gate: choose the stronger track by evidence (lint adoption vs agent attention) to lead Phase 3.

### Phase 3 — Reach (weeks 18–26, at most two)
From: VS Code (CodeLens "Score 72 — refine", diagnostics, CodeAction), remote MCP Worker, GradientBench (with caveat), DevTools-panel extension via WXT (no host permissions; Firefox data-collection `"none"`), Figma plugin (8–16 baked stops, angle→matrix), Tailwind/native export templates, EN/FR. Exit: store listing + privacy statement + automated release per surface. 3-month gate per surface: under ~200 installs/active users and no issues → freeze.

### Phase 4 — Ecosystem (open-ended, demand-driven)
v2 research spike outcome, Python port if a user exists, DTCG, web component, second maintainer/recovery contact, sponsorship. Each item needs a named requester.

---

## 7. Cross-cutting

- **Testing.** Unit + golden vectors (regenerated only by an explicit, reviewed script). Property tests (fast-check, dev only): hue rotation by 360° invariance; score always integer 0–100 and never NaN; `gamutMap` idempotent and in gamut; `parseGradient(toCSS(doc))` round-trips; parser never throws. Visual regression for the web app (few Playwright shots) plus a check that `bakeStops` matches the browser's `in oklab` render within tolerance.
- **Release.** Changesets; Trusted Publishing (OIDC) with provenance, no long-lived tokens; SHA-pinned actions (already so); Node 24 + oldest supported Node for the CLI.
- **Docs.** The web app is the docs site: a permalink per issue code with a live example from the URL hash, generated from the spec; CLI/lint messages link there.
- **Accessibility and UX (web app).** Measured in [`UX-REVIEW.md`](UX-REVIEW.md) (axe: 74 contrast failures, 3 label/name mismatches, no `<main>`; 31 of 92 tab stops without visible focus; 104 of 106 touch targets under 44 px; 320 px input clipping — but no page-level overflow). Fixes are tracked as Track U in §6; add `eslint-plugin-jsx-a11y` and an axe check to CI.
- **i18n.** Issue codes are the stable layer; English messages + override hook in core; EN/FR catalogue in the web app first.
- **Security / supply chain.** Hardware-key 2FA everywhere; dedicated store publisher account; manifest permission diff in CI; zero runtime deps in core. No third-party colour-name lists (ntc etc.) without attribution — the 148 CSS names are spec facts, no licence issue.
- **Governance.** `SCOPE.md` (no colour-space race with culori/Color.js; new rules need spec + vectors). Public roadmap = §5.
- **Sustainability.** GitHub Sponsors; optional keyed hosted tier only if D4 demand appears, never called by the web app. Success measured without telemetry: registry downloads, stars, dependents, store installs.

---

## 8. Risks and verification checklist

**Risks.** (1) Metric credibility — published spec, neutral wording (D5), optional Phase 0.5 survey if a defensible threshold is ever needed. (2) Parser scope creep — D7 skip list + corpus. (3) Score drift — versioned models + vectors. (4) Solo burnout/sprawl — D6 and freeze gates. (5) Account takeover — §7. (6) Platforms catch up (DevTools/CSS add hints) — spec, validation data and agent tooling are harder to commoditise than the editor. (7) v2 underestimated — it's a research spike, not on the critical path. (8) Circularity — the bench uses the same metric `refine` optimises, so it cannot validate it.

**(U) items — verify before the phase named**

| Fact | Gates |
|---|---|
| npm org / JSR scope claimable; registry/trademark search for the chosen name | Phase 0 task 1 |
| `@unit42` conflict (Palo Alto Networks brand) | D1 — conclusion stands regardless |
| Size budgets achievable | Phase 1 |
| Scoring CPU time vs Workers free-plan limits | Remote MCP |
| MCP spec rev, stateless handler guidance, registry flow, directory submission; Agent Skill field details | Phase 2 MCP/Skill |
| Open VSX / Cursor coverage | VS Code |
| Chrome fee ($5) / review time (3–7 business days, unofficial); WXT status; Firefox data-collection rule | Extension |
| Figma gradient API, no interpolation-space support, Community review, Dev Mode codegen/Make/Sites | Figma |
| SwiftUI / Compose / Flutter / Godot interpolation behaviour | Native templates |
| Tailwind v4 plugin mechanics; Style Dictionary API; DTCG gradient type | Exports |
| Web app at 320 px | Phase 2 a11y |
| Windows signing price, Apple fee, winget/Homebrew process | Only if Tauri un-shelved |
| ESLint version/EOL | Only if an ESLint rule is requested |

---

## 9. Deliberately not doing

A colour library; text-to-gradient, palette-from-image, wallpaper generators, Lottie; telemetry, accounts, cloud sync; a public REST product, bots, Zapier-style integrations (until asked); Electron, native mobile apps, native OS plugins; Safari/Sketch/Adobe/Affinity/XD/Notion; WASM/UniFFI bridges and speculative ports; five framework-wrapper packages; scoring radial/conic in 1.0 (parsed and reported unsupported); fixing v1 quirks in place *after* freeze (improvements land in v2).
