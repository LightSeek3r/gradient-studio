# Gradient Studio — App UX, ergonomics and styling review

Date: 2026-11-15 · Scope: the web app at `src/` (v0.1.0), built and driven in Chromium at 320–1440 px.
Method: three independent reviews merged here — **measurement** (axe-core 4.14, keyboard walk, geometry, contrast), **visual/CSS** review, and a **workflow** review that performed ten real user tasks. Every "measured" item was observed on the running build; nothing here is a guess unless marked.

The editing primitives are good (every colour notation per stop, the compass, complements). The problems are around them: the score — the product's differentiator — is far from the thing it scores, can't say what to fix, and the app forgets everything.

---

## 1. Bugs (fix regardless of redesign)

| # | Bug | Evidence |
|---|---|---|
| B1 | **Silent wrong import.** Pasting `linear-gradient(90deg,#f00,#00f)` into a stop's Paste button shows the green "pasted" tick and sets the stop to `#5A0000` ("90" parsed as a bare red channel). | `color-formats.ts` ≈426–431 (`parseAnyColor` bare-number fallback) |
| B2 | Clearing a position field snaps the stop to 0; typing "75" passes through 7, re-sorts mid-keystroke and the card renumbers under the cursor. | `StopCard.tsx:86–88` (`Number("")===0`) |
| B3 | While "Suggested" is shown, preview, score and **Export CSS** show the suggestion but the bar and stop cards show the original — you can copy CSS that matches no visible stop. | `App.tsx:81–85` |
| B4 | "Re-suggest" is deterministic → always identical output (a no-op button). Editing a position keeps a stale suggestion; editing a colour discards it. | `App.tsx:119–125` |
| B5 | "+ Add stop" always inserts `#a78bfa`; 8 adds → a flat lavender wash, score 61, 8 identical cards. No stop cap. | `App.tsx:106` |
| B6 | Direction-count presets 1–7 reset every angle and re-enable muted layers — unrecoverable (no undo). | `DirectionsPanel.tsx:199–210` |
| B7 | The score ignores directions and blend mode (95 before and after 3 layers + `screen`) with no label saying so. The export panel mentions OKLAB while the CSS is plain sRGB interpolation. | observed; `App.tsx:82–83` |
| B8 | A red "⚠ Uneven saturation" warning appears under a 95 "Excellent" score. Score colour/label thresholds disagree (75/50 vs 80/65/45 vs 75/45). | `App.tsx:35,119` |
| B9 | Export always emits `rgba(r,g,b,1)` instead of hex when alpha is 1; one long unwrapped line (794 px of content in a 290 px box on mobile). | `App.tsx` export |
| B10 | Font weights requested but not loaded (Space Grotesk 800; JetBrains Mono 600/700) → faux bold; unused Mono 300/300-italic files ship. | `main.tsx:3–8` vs `App.css` |

## 2. Accessibility — measured

- **axe:** 74 contrast failures (serious); 3 `label-content-name-mismatch` (`.btn-swap` visible "↔ Use this instead" vs aria-label "Replace this stop with its complement"); no `<main>` landmark; 74 nodes outside landmarks; export `<pre>` scrolls but is not focusable.
- **Contrast** (computed): `--text-muted` #334d70 = **2.17:1**, `%`/`×` glyphs **2.06:1**, placeholders 2.3:1, `--text-dim` 3.5:1, borders 1.2:1; ~19 declarations at 9–10 px.
- **Keyboard:** 92 tab stops per cycle ("Suggest" is #91). **31 of 92 stops show no visible focus change** (`outline:none` on inputs/sliders, `App.css:283,704`). Stop-bar handles, compass handle/hub, complement swatches are mouse-only. Tab order jumps from "+ Add stop" down to "Direction 1 angle" then back up to "+ Direction"; "Suggest" precedes "How does this work?".
- **Touch (400 px):** 104 of 106 interactive elements are under 44×44, 31 under 24×24 (remove ×15×15, stop handles 20×20, presets 22×22, sliders 3 px tall, compass hub 5.6 px). Touch-dragging a stop handle does nothing (mouse events only). Inputs are 11 px → iOS zooms on focus.
- **Screen reader:** no `aria-live`/`role=status` anywhere — score changes and "copied" are silent; RGB/HSL inputs are labelled just "R"/"H" with no stop number; all paste buttons share one name; no skip link; no `prefers-reduced-motion` (14 transitions).
- **Overflow:** no page-level horizontal scroll at any width, but at 320 px the R/G/B/H/S/L inputs (52 px) overflow their 28 px cells by 33 px and colour-name inputs clip; the tick bar overhangs by up to 10 px at 360/400.
- **Theme:** dark-only with no `color-scheme` → native `<select>`, `<input type=color>`, datalist and scrollbars render light under a light OS scheme.

## 3. Layout and information architecture

**Problem (measured at 1440×900):** preview at y≈120; stops, directions, export and finally Analysis/Suggest at y≈1574–1726. Clicking Suggest changes a preview you can no longer see. Mobile page is ~3,100 px tall and the preview scrolls away immediately. ~250 px of dead gutter each side at 1440.

**Proposal**
- **Desktop ≥1100 px:** two columns. *Left (fluid):* sticky preview → stop bar with issue lane → selected-stop inspector → Directions (collapsed to "135°, 1 layer"). *Right rail (≈360 px, sticky):* score ledger → issues with fixes → Original/Suggested + Apply → Export tabs. Header: title, Import, Undo/Redo, Share.
- **Mobile:** sticky 96 px preview with the stop bar fused to its bottom edge and a score chip overlay; body shows only the selected stop; fixed bottom tab bar *Stops · Score · Directions · Export* as sheets (Score badge = issue count).
- **One selected-stop inspector** (bar handles select) with the others collapsed to chips (swatch · hex · %) cuts ~92 tab stops to ~25 and the page height by about half. Complement `<details>` closed by default (currently open → ~230 px per card). A `HEX | RGB | HSL | NAME` segmented control replaces four stacked notations.

## 4. Making the score explainable (the differentiator)

Prerequisite: `score()` returns **coded, located issues** `{code, severity, pointsLost, stops | segment, dimension}` — this is already Phase 0 task 10 and the core API in `PLAN.md` §3.4, so the app UX and the library share one deliverable.

1. **Issue lane** under the stop bar: coloured brackets over the offending segment / rings on the offending handle; hovering an issue row ↔ its bracket.
2. **Points ledger** instead of four anonymous 3 px bars: "100 − 12 lightness reversal − 20 hue arc > 180° − 10 muddy midpoint = 58", sorted by loss, worst row pre-expanded. Neutral icon (not red ⚠) at ≥ 80.
3. **Per-issue "Fix this (+12)"** with ghost preview on hover (split preview, ghosted handle), applying only that change — a granular alternative to all-or-nothing Suggest. Optionally a *strength* slider for Suggest (the 0.3/0.7 mix at `gradient-engine.ts:514`) — only then is "Re-suggest" meaningful.
4. **Curves, not adjectives:** three small sparklines (L, C, hue) aligned to the bar's x-axis from `interpolateGradient`; a lightness reversal is a visible dip, a muddy midpoint a chroma trough.
5. **Live delta badge** ("+3 / −7") following a dragged handle, so users learn the metric by feel.
6. **Honest scope labelling:** "Scores the stops; directions and blend are not scored" and call it a *smoothness score* rather than "Excellent" (consistent with the plan's validation caveat).
7. **Permalink per issue code** → playground preloaded with a triggering example (doubles as docs).

## 5. Table stakes

| Priority | Feature | Notes |
|---|---|---|
| P0 | **Paste-anywhere CSS import** + "Import CSS" field | Global `paste` listener; parse stops/angle; offer "Replace gradient (3 stops, 135°) — Undo". Make `parseAnyColor` reject strings containing `gradient(`. This is the playground's front door and reuses the Phase 1 parser. |
| P0 | **State in URL hash + localStorage autosave** | `#g=…` via debounced `replaceState`; fixes sharing, reload and "come back tomorrow" at once (today `localStorage.length === 0`). |
| P0 | **Undo/redo** | One history reducer over `{ticks, directions, blend}`; coalesce drags; 5 s "Undo" toast after destructive actions. Needs the `GradientDocument` type from the plan. |
| P0 | **Pointer + keyboard handles**, click-bar-to-add | `setPointerCapture`, `touch-action:none`, `role="slider"`, arrows 1 %, Shift 10 %, Delete removes. Add-stop samples the gradient's interpolated colour; cap at 10. |
| P1 | Export tabs | CSS (hex), modern `in oklab`, Tailwind, SCSS, CSS variables, later SwiftUI; labelled **Copy CSS** button; wrapped code; "Copy link". |
| P1 | Presets gallery (~12) | Chosen to trigger each issue code → doubles as docs. |
| P1 | Local "Recent" (last 20, thumbnail + score), shortcuts (`?` sheet), duplicate/reverse stops | |
| P2 | Seeded random/"inspire" (in URL), per-stop alpha (+ checkerboard), WCAG text-contrast overlay, PNG/SVG download | |
| Defer | Radial/conic | Parsed but "not scored" until the metric supports them. |

## 6. Styling and design system

- **Tokens to introduce** (all in `index.css`, so `body` stops duplicating `#060a12`): `--font-ui`/`--font-mono`; type scale `--fs-xs:11 … --fs-display:56`; 4 px spacing scale; radii `6/10/16/999` (today: 2/4/5/6/9/16/20); `--on-accent`, `--accent-hover`, `--score-good/warn/bad`; motion `--dur-fast:120ms`. Replace hard-coded `#4ade80/#facc15/#f87171`, `#08091a` (×3), `#9099ff`.
- **Contrast fix** (≈6:1 / ≈9:1): `--text-muted:#7f97bd`, `--text-dim:#9fb3d3`, `--border:#26344f`, `--border-hi:#3a4c70`; 11 px floor for labels, 12 px for body.
- **Typography:** prose in Space Grotesk 13–14 px / 1.55; JetBrains Mono only for values, hex, CSS (+ `tabular-nums`). Fix font weights (B10).
- **Theme:** `:root{color-scheme:dark}` + `<meta name="color-scheme">`; global `:focus-visible{outline:2px solid var(--accent);outline-offset:2px}`; honour `prefers-reduced-motion`. A light theme is not warranted yet; a more useful second theme is **neutral grey** (no blue cast), because the navy chrome biases how designers judge blues and purples.
- **Components to unify:** one `<Button variant size>` (replaces the `.btn-*` family), one `<Surface>` (replaces `.controls-surface`, `.panel`, `.stop-card`), `<Field>`+`<NumberInput>`+`<Slider>`, `<Segmented>` (presets, toggles, export tabs), `<Score>` with a single threshold function in the engine, an inline-SVG `<Icon>` set (Unicode glyphs ⧉ ⎘ ✦ ⟳ render differently per platform and copy/paste are indistinguishable at 12 px).
- **CSS hygiene:** delete the no-op `.gradient-preview{transition:background}` (gradients don't transition), the 12 `filter:none` overrides undoing `.btn:hover{filter:brightness}`, `transition:all`, and the Chrome-only `transition:r`.
- **Small layout fixes:** hide Blend when there is only one direction; label presets "Spread: 1…7" (they read as pagination); compass 140 px with no dead space; preview `aspect-ratio:16/9; min-height:220px; max-height:50vh` with optional shape toolbar; footer with "Runs entirely in your browser. Nothing is uploaded · version · GitHub · scoring method"; microcopy ("Use this instead" → "Replace stop with complement", "~midnightblue" → "nearest: midnightblue"); inline hint under invalid fields instead of red-then-revert.

## 7. Suggested sequencing

**U0 — quick wins, no dependencies (≈ 1–2 days total, each <1 h):** `color-scheme:dark`; global `:focus-visible`; contrast tokens; font-weight fix; complement `<details>` closed; `pre-wrap` export + hex when alpha=1; labelled **Copy CSS**; delete dead CSS; hide Blend for 1 direction; 320 px input widths; add-stop samples the gradient + cap 10; `<main>` landmark, `aria-live` on the score, stop-qualified aria-labels; fix B1 (reject `gradient(` in `parseAnyColor`) and B2 (commit position on blur/Enter, never on empty).

**U1 — structure (≈ 2–3 weeks, can run in parallel with plan Phase 0/1):** two-column sticky layout and mobile sheet; selected-stop inspector; pointer/keyboard handles; `GradientDocument` + history reducer (undo/redo); URL-hash + autosave; paste-anywhere import (best after the Phase 1 parser, but a minimal `linear-gradient` stops/angle parser can ship earlier); honest Suggest compare (B3/B4, scope labelling B7).

**U2 — explainability (depends on coded, located issues from `PLAN.md` Phase 0 task 10):** issue lane, points ledger, per-issue fix + ghost preview, sparklines, delta badge, issue permalinks.

**U3 — polish:** export tabs, presets gallery tied to issue codes, recent history, shortcuts, EN/FR, SVG icon set, design-token extraction.

## 8. What not to add

Accounts, cloud libraries, short-link services, telemetry; image-to-palette, text-to-gradient, mesh gradients, animation; more colour notations per stop or more blend modes; a large community gallery (keep ~12 curated, tied to issue codes); scoring directions/blend ad hoc or radial/conic before the v1 metric is validated; a second "AI suggest" — the deterministic refine is the product, so make it steerable and partial instead.

## 9. Not covered

A real screen reader (VoiceOver/NVDA), the light theme beyond OS-scheme rendering, and iOS/Android hardware. Re-test after U0/U1.
