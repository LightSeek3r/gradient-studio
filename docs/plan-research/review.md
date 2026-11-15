# Review of plan-draft.md (skeptical pass)

I checked the plan against `src/gradient-engine.ts`, `src/color-formats.ts`, `App.tsx` and `package.json`, and ran the unmodified engine on sample inputs with `node --experimental-strip-types` (script: scratchpad/probe.ts).

## Blockers

**1. The determinism and port-conformance story does not work (§1 non-negotiables, §2.5.4, §6 Testing).**
The score is a sum of integer step penalties at hard thresholds: `de > 0.15` (engine:252), `cv > 0.8` (279), `enclosingArc > 180` (307), `worstDip > 0.5` (406). There is no continuous "score before rounding", so "within ±0.5 before rounding" is meaningless. A 1-ulp difference at a threshold moves the score by 8–20 points. ECMA-262 lets `Math.pow`/`cbrt`/`atan2`/`sin` be approximated by each implementation, so even JS engines can differ, never mind Python, whose `round()` uses banker's rounding where JS `Math.round` rounds half up (rgbToHex:79). The plan also contradicts itself: "same score on every platform" vs "±0.5".
*Fix:* vectors store the intermediate measurements (maxΔE, velocity CV, arc, worstDip, rgbSteps) with a tolerance, plus the final integers. The generator flags any case within ε of a threshold as `boundary: true`, and those are excluded from cross-language exact checks. Reword the non-negotiable to "deterministic within one JS implementation; ports conform on non-boundary vectors".

**2. Nothing checks that the metric is valid, and GradientBench is circular (§4 GradientBench row "validates the metric publicly", §5 Phase 4, Risk 1).**
The bench scores LLM output with the same metric, and `refine` is tuned to that metric, so "with Skill" is better by construction. In the probe, red→blue goes from 87 to 100, and red/grey/green goes from 68 to 100 because `#808080` is recoloured to `#d99100`. A human-judgement study sits in the open-ended Phase 4, after the plan has already asked strangers to put `min-score` in CI.
*Fix:* add Phase 0.5, a 1–2 week pairwise survey (about 40 pairs, 20+ raters, rated offline or with explicit opt-in) and report rank correlation. Gate: no `min-score` lint default and no bench leaderboard until the correlation is published. Rewrite the bench row to "measures smoothness by our metric; not validation".

**3. Freezing v1 bit-exactly also freezes defects that real CSS hits on day one (§2.5.1, Phase 0 tasks 11/14, Phase 2 stylelint).**
- Invalid input gets a perfect score: `#zzzzzz`/`#abc` scores **100**, and refining it gives `#NaNNaNNaN`. `Math.max(0, NaN)` swallows the NaN at 231.
- Some penalties produce no issue text: arc < 15° −5 (313–315), edgeGap > 10 −3 (459–460), span < 40 −4 (469–470), cv > 0.25 −4 (488–489). A dark→light blue scores 95 with **zero issues**. This breaks "every point lost maps to a published rule", and task 14 only converts the 22 `push` sites.
- Alpha is not modelled. A standard scrim, black→transparent, is read as `#000000→#000000`: score 79, "gradient is invisible".
- Intentional hard stops (stripes) are penalised (71), and `refine` smooths them away (82). Achromatic stops keep an arbitrary hue but get `avgC` chroma (540, 551–554), so greys turn colourful.
*Fix:* define the v1 input domain as "opaque `#rrggbb`, ≥2 stops". Outside it, core returns `unscorable`. Add `info` codes for the four silent penalties. The lint rule skips alpha-varying, hard-stop and `repeating-*` gradients by default. Autofix is opt-in. `refine` must guarantee `after.score ≥ before.score`, keep hard stops and keep achromatic stops achromatic, or else return the input unchanged.

## Major

**4. Factual errors about the code (Phase 0 tasks 6, 7, 10; §2.5 table).**
- Task 6: "`interpolateGradient(ticks, 1)` (`t = i / (n - 1)` divides by zero)" is false. engine:676 returns early when `n <= 1`. The four "division guards" are already guarded (274 `avgV > 0`, 401 `> 0.04`, 480 `avgGap > 0`, 700 `span === 0`). Reframe these as regression tests, not fixes.
- Task 7 is incomplete. If t falls before the first stop, the code takes lo=0, hi=1 with a *negative* frac. If it falls after the last stop, it uses lo=0, hi=last, which interpolates first↔last and skips the middle stops. Probe: stops at 20/80 red→blue give `#2300ff` at t=1 instead of `#0000ff`.
- Task 10: the `HEX_TO_NAME` prototype risk does not exist, because keys are hex strings and line 210 looks them up by canonical hex. The real case is `parseName` (405): `parseName("constructor")` returns `Object`'s constructor function.
- "v1 always evaluates as if interpolation were sRGB": only check 3c (386–412) and the reasoning behind 2b are sRGB-specific. Everything else measures OKLAB stop-to-stop. Also, App.tsx:82–83 scores the stop list but renders the alpha-layered, blend-moded multi-direction stack, so today's score does not describe what the user sees.

**5. v2 is under-specified and contradicts itself (§2.5.2, D8, Risk 7, Phase 1).**
"Default in core 1.0 is v2" (2.5.2), "until then core exports only v1" (D8), and "ship v1-only core if it slips" (Risk 7) conflict, yet v2 sits inside the 4–5 week Phase 1. The concept also needs rethinking. Under `in oklch`:
- the muddy-midpoint check (3c) is mostly moot;
- a single segment on the "shorter" path cannot exceed 180°, so the "arc > 180° clash" rule needs redefining per hue path;
- banding (3d) uses 8-bit sRGB endpoint deltas, which are wrong for non-sRGB paths;
- new failure modes appear: gamut excursions mid-path, unexpected hues on the path, powerless hue on grey stops.

*Fix:* v2 = sample the rendered path (N points in the document's space, gamut-mapped per CSS Color 4) and compute every dimension on the samples. Spec it as a research doc. Remove v2 from Phase 1 and ship 0.x as v1-only, with D8 as the single rule.

**6. Capacity arithmetic does not add up (D6, §4, §5).**
D6 caps maintained surfaces at six. Phases 1–2 ship twelve: core, CLI, JSR, stylelint, Action, pre-commit, Skill, MCP stdio, MCP Worker, bench, web app, PWA. The parser, the hardest piece, has no row of its own, yet the CLI is rated "S" on top of it. The Phase 1 gate lands "8 weeks after first publish", which is in the middle of Phase 2.
*Fix:* Phase 1 = parser + CLI + 0.x core. Move the Worker, JSR, PWA and bench out of Phase 2. Express gates as weeks from project start.

**7. Parser scope is optimistic (Phase 1 deliverables, Risk 2).**
Missing from the list:
- `-webkit-linear-gradient` (different angle convention) and legacy `-webkit-gradient()`;
- multi-layer `background` shorthand mixed with `url()`;
- `transparent` (premultiplied interpolation);
- relative colour syntax.

`color(display-p3 …)`/`lab()` bring wide-gamut colours that the sRGB-based v1 cannot judge, and they pull core toward the colour library §8 rules out. Tailwind classes and CSS-in-JS, where many gradients now live, are out of stylelint's reach.
*Fix:* 1.0 parses hex/rgb/hsl/named/oklab/oklch. Everything else is a structured skip. State the Tailwind/CSS-in-JS coverage gap explicitly.

**8. Naming (D1): rejecting `@unit42` is right, keeping "Gradient Studio" for the metric is not.**
Unit 42 is Palo Alto Networks' threat-intelligence brand, so this is a real trademark-confusion risk, not only "the scope may be taken". Keep it as a verify item, but the conclusion stands. The plan says the artefacts (spec, codes, bench) must be distinctive, then names them all `gradient-studio`. The findings record a near-identical "Gradients Studio" ChatGPT app, and agent directories are exactly where the plan wants to be found.
*Recommendation:* keep "Gradient Studio" for the web app and repo. Pick a distinctive coined name for the metric/packages/CLI *before the first publish* (renaming after publish is the expensive step). Run a quick npm/GitHub/USPTO/EUIPO/INPI search before publishing; don't wait for Phase 3. Fall back to `@lightseek3r/*`. Do not squat PyPI/crates.io placeholders: crates.io policy forbids squatting and PyPI has PEP 541.

**9. Privacy, security and legal gaps (D4, §6, Phase 4).**
- Worker: wrangler templates may enable `observability`/Workers Logs. Disable it explicitly, add no body logging and no Logpush, and name Cloudflare as processor in PRIVACY.md. IP addresses are personal data under GDPR, which applies to an EU maintainer.
- The Phase 4 ratings study "with opt-in submission" is data collection. It contradicts "no telemetry anywhere" and needs a backend, consent text and retention rules. Reword the non-negotiable to "no telemetry; any research collection is separate, explicit and documented".
- MCP `render_preview` builds SVG from user strings. Escape them or allowlist values, or clients that render it are open to injection.
- Parser fuzzing needs a time budget, for ReDoS and the 10 ms Worker CPU limit.
- Check whether Cloudflare Pages Web Analytics is on for the current site.
- The 148 CSS colour names are spec facts, so there is no licence issue. Forbid importing third-party name lists (e.g. ntc, CC-BY) without attribution.

## Minor

**10.** There is no distribution plan. Add a launch write-up ("why your gradient looks muddy") with the playground and URL-shareable scores before the CLI. This is the cheapest demand probe.

**11.** "Widely available ~Dec 2026" is two weeks away. Resolve the §7 row now: `toCSS` fallback off by default, opt-in.

**12.** `color-formats.ts` imports `./gradient-engine` without an extension, so `gen-vectors.ts` needs tsx/vite-node. Minor, but task 3 says "start tomorrow".

**13.** "Refine if < 70" in the Skill is an arbitrary threshold. Derive it from the validation study.

## Top 5 changes before the user sees this plan

1. **Add a metric-validation step (Phase 0.5)** and gate lint defaults and the bench on it. Remove "validates the metric" from the bench row.
2. **Restate the vector contract:** intermediate values with tolerances, boundary cases flagged, a defined v1 input domain (opaque `#rrggbb`), invalid input → `unscorable`. Drop "±0.5 before rounding".
3. **Take v2 out of Phase 1** and redesign it as "score the sampled rendered path". Make D8 the single rule and delete the 2.5.2 contradiction.
4. **Correct the code claims** (task 6 n=1, already-guarded divisions, task 7 mechanics, HEX_TO_NAME vs parseName, "v1 = sRGB"). Add the four silent penalties, the alpha/hard-stop false positives and the grey-recolouring `refine` as Phase 0 issues, with a non-regression guarantee for `refine`.
5. **Fix the capacity and naming decisions:** Phase 1 = parser + CLI only, gates in absolute weeks, stay within D6's six surfaces. Give the metric a distinctive name before publishing, keep "Gradient Studio" for the app, avoid `@unit42` (Palo Alto Networks trademark), and run the trademark search before the first publish.
