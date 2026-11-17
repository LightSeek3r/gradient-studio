# Status — what is built, what is verified, what needs you

Updated 2026-11-17. Everything below is on `master` (the repository's default branch). Nothing is published, submitted or deployed by this work.

## Built

| Area | Where | Tests (Node 22 and 24) |
|---|---|---|
| Web app: U0 quick wins, U1 layout/undo/URL state/import, U2 explainable score, EN/FR, PWA, export tabs | `apps/web` | 337 |
| Core engine, document API, CSS gradient parser, fixes, exports, experimental v2 | `packages/core` | 3,869 |
| CLI | `packages/cli` | 186 |
| Stylelint plugin, GitHub Action, pre-commit hook | `packages/stylelint-plugin`, `actions/score`, `.pre-commit-hooks.yaml` | 186 |
| MCP server, Agent Skill | `packages/mcp`, `skills/gradient-quality` | 236 |
| Remote MCP Worker (not deployed) | `apps/worker` | 194 |
| VS Code extension (.vsix builds, not published) | `apps/vscode` | 233 |
| Browser DevTools extension (Chrome, Edge, Firefox zips build, not submitted) | `apps/extension` | 354 |
| Figma plugin (bundle builds, not submitted) | `apps/figma` | 195 |
| Web components | `packages/element` | 253 |
| Style Dictionary transforms | `packages/style-dictionary` | 112 |
| GradientBench | `packages/bench` | 200 |
| Python port of scoring v1 | `ports/python` | 58 tests; 1,740 vector cases, 0 mismatches |

Scoring v1 is frozen and defined by `spec/scoring-v1.md` and `spec/vectors/` (every change since freezing is accounted for in `spec/vectors/CHANGES-v1.md`). v2 (`spec/scoring-v2.md`) is a research document and an opt-in prototype only.

## Verified, and how

- Lint, typecheck, all test suites, builds, `npm audit` (0 vulnerabilities), size budgets, publint and attw: run for every merge, locally on Node 22 **and Node 24** (the CI matrix since the determinism fix).
- Real browsers (Playwright/Chromium): the web app (axe 0 violations at 320/360/1440, offline mode, CSP headers), the web components, the browser extension (including one run inside real DevTools under xvfb).
- Cross-runtime determinism: found by CI (Node 24 produced different fix choices than Node 22 for near-equal values), fixed once with a shared tolerance rule, documented in `docs/DETERMINISM.md`.

## Not verified (labelled in each surface's docs)

- The Figma plugin has never run inside Figma; the `gradientTransform` convention and undo behaviour are unverified.
- The extension has not run in a real Firefox or Edge; the VS Code extension has only run against a stub of the `vscode` API.
- The MCP server has not been tried in a real MCP client; the Worker's CPU time has not been measured inside workerd, so the Free-plan fit is unverified (`REFINE_MAX_STOPS` is 8).
- Native export snippets (SwiftUI, Compose, Flutter, Godot, Android) and the DTCG gradient shape are unverified against devices and the normative spec text.
- **The score itself has not been validated against human judgement** (the optional survey in the plan was skipped). It is a smoothness measure by this project's definition, and the UI, CLI, Skill and bench all say so. There is no default `min-score` threshold anywhere.
- CI results beyond what GitHub reported at the time of writing.

## What needs you (nothing here can or should be done by an agent)

1. **Names.** Claim the `@opal42` npm scope (the registry check only showed unscoped names are free, not the scope), the JSR scope, and check trademarks for "Opal" (note the Ruby compiler Opal). Fallback is `@lightseek3r`. See plan D1.
2. **Publishing.** All packages are `"private": true`. Follow `docs/RELEASING.md`: remove `private`, set npm trusted publishing, run the release workflow in dry-run first.
3. **Stores.** VS Code Marketplace and Open VSX, Chrome Web Store, Firefox Add-ons, Edge, Figma Community: accounts with hardware-key 2FA, listings, privacy text. Drafts are in each surface's docs. Fees and review times quoted in the research are unverified.
4. **Cloudflare.** The Pages project name is not recorded in the repo, so `wrangler.jsonc` ships only as `docs/deploy/wrangler.example.jsonc`. `apps/web/public/_headers` (strict CSP) is live on the next Pages deploy. The Worker needs a deploy, a domain and a rate-limiting rule (`docs/worker.md`).
5. **GitHub settings.** If branch protection requires status checks, the names changed: `verify (Node 22)`, `verify (Node 24)`, and `python-port (Python 3.12|3.13)`.
6. **A second maintainer or recovery contact**, and sponsorship, per the plan.

## Known issues and open questions

- Fixes and refinement can change colours a lot (they remove a finding outright). Use `--dry-run`/preview first; the UI and editors show the change before applying.
- v2 open questions for you (`docs/v2-experiments.md`): penalise mid-path gamut excursion? waive `longer`-hue rainbows? the muddy middle is partly double-counted.
- Not fully deterministic across engines: the lightness reversal count compares neighbouring lightness exactly (it decides the score; no vector is affected), and 8-bit rounding landing exactly on .5. Scores at rule thresholds can flip on tiny differences by design (`boundary` cases in the vectors).
- `parseGradient` alone is about 9.8 kB gzip and grew when `proposeFixes` was added: a likely tree-shaking leak (`docs/PACKAGING.md`).
- The Python port covers scoring, refinement, CSS and colours; its parser and exporters are not ported.
- The VS Code extension bundles `apps/web/src/explain` directly; the hue curve in the app is jittery on near-grey gradients.
- The plan's 3-month "freeze unused surfaces" gates only start once something is published.
