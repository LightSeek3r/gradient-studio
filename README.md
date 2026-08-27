# Gradient Studio

A CSS gradient editor that scores what you build against real perceptual color
science (OKLAB/OKLCH), then offers a one-click fix — plus every color-entry
format at once, per-stop complements, and up to seven simultaneous gradient
directions.

## Features

### Perceptual quality analysis

Every gradient is scored 0–100 across four dimensions, computed in [OKLAB](https://bottosson.github.io/posts/oklab/) rather than raw sRGB so the score tracks what the eye actually perceives:

- **Lightness flow** (30 pts) — penalizes lightness reversals, Helmholtz–Kohlrausch brightness wobble (saturated colors *look* brighter than their measured lightness), near-invisible low-contrast stops, abrupt jumps squeezed into a small span, and uneven perceptual "speed" between stops.
- **Hue arc** (30 pts) — rewards a tight hue arc (<120°) and a consistent rotation direction; wide arcs (>180°) risk clashing, unexpected in-between hues.
- **Chroma balance** (20 pts) — penalizes saturation spikes, a desaturated stop stranded among vivid ones, muddy/grey midpoints from sRGB interpolation, and 8-bit banding risk.
- **Stop rhythm** (20 pts) — penalizes stops that don't reach the edges, a transition squeezed into a narrow band, or unevenly clustered spacing.

Each deduction surfaces as a specific, actionable issue rather than just a number.

### One-click perceptual refinement

**✦ Suggest** interpolates your existing stops through OKLAB→LCH: it smooths the lightness curve monotonically, compresses the hue arc to avoid muddy midpoints, applies a gentle chroma envelope, and redistributes stop positions evenly. Toggle **Original / Suggested** to compare before committing with **Apply**.

### Every color format, everywhere

Each stop is editable via its native color picker, hex, RGB, HSL, and the nearest CSS color name (148 named colors, with autocomplete) — all shown simultaneously and kept in sync. Every field has:

- **Paste** — accepts any notation from the clipboard (`#4f46e5`, `rgb(79 70 229)`, `hsl(243, 69%, 59%)`, `rebeccapurple`, or a bare `79, 70, 229`) and normalizes it automatically.
- **Copy** — puts that field's exact formatted value on the clipboard.

Editing HSL preserves full precision on the channels you *didn't* touch, so nudging hue repeatedly never lets saturation or lightness drift — integer HSL display is inherently lossy (~90% of colors don't round-trip exactly), but the editor never compounds that loss.

### Complementary colors

Each stop shows its complement: the opposite hue in OKLCH space at *matched* lightness and chroma, gamut-mapped back into sRGB by reducing chroma (not clamping RGB channels) so the hue never drifts. Copy any of its formats, or swap it straight into the stop.

### Multi-angle gradients

Project the same color stops through up to **7 simultaneous directions**, aimed with a draggable compass or per-direction angle/weight controls. In the default **average** blend, each direction's opacity is set to `wₖ / (w₁+…+wₖ)` painted back-to-front, which makes the composite the *exact* weighted mean of every direction — not an approximation. Eight alternative `background-blend-mode`s (screen, multiply, overlay, difference, …) are also available for more painterly composites. Any direction can be muted, reweighted, or removed independently.

### Export

The **Export CSS** panel always shows the exact `background` (and `background-blend-mode`, when it isn't the default) needed to reproduce your current configuration — stops, directions, weights, and blend mode included — ready to copy into a stylesheet.

## Getting started

```bash
npm install
npm run dev       # start the Vite dev server
npm run build     # type-check and build for production
npm run lint      # ESLint
npm run preview   # preview the production build
```

## Architecture

Zero runtime dependencies beyond React — all color math and scoring is pure, dependency-free TypeScript:

- **`src/gradient-engine.ts`** — OKLAB/OKLCH color conversions, the quality scorer, the OKLAB-based suggestion engine, and CSS composition (single-angle and multi-direction).
- **`src/color-formats.ts`** — parsing and formatting across hex/RGB/HSL/named colors, the CSS named-color table, gamut mapping, and complementary-color computation.
- **`src/clipboard.ts`** — clipboard read/write with a legacy `execCommand` fallback; every entry point resolves rather than throws.
- **`src/components/`** — `StopCard` (per-stop editor), `DirectionsPanel` (compass + direction rows), `fields.tsx` (shared paste/copy buttons and format-aware inputs).
- **`src/App.tsx`** — top-level state and layout.

## Brand assets & sharing previews

`index.html` ships a favicon (SVG + PNG fallbacks), an `apple-touch-icon`, a
`site.webmanifest`, a meta description, and Open Graph/Twitter Card tags for
link previews (`public/og-image.png`), pointed at
[gradient-studio-al4.pages.dev](https://gradient-studio-al4.pages.dev/).

If the deployment URL ever changes, update the `canonical`/`og:url`/`og:image`/`twitter:image`
tags in `index.html` to match — social platforms need absolute URLs to fetch preview images.

The icon mark and OG image are generated from two small HTML templates in
`scripts/brand/` (real CSS gradients + real fonts, screenshotted with
Playwright) rather than hand-encoded bitmaps, so they stay pixel-accurate to
the app's actual colors. To regenerate after a palette change:

```bash
npx playwright screenshot --viewport-size=1200,630 scripts/brand/og.html public/og-image.png
npx playwright screenshot --viewport-size=512,512   scripts/brand/icon.html public/icon-512.png
npx playwright screenshot --viewport-size=192,192   scripts/brand/icon.html public/icon-192.png
npx playwright screenshot --viewport-size=180,180   scripts/brand/icon.html public/apple-touch-icon.png
npx playwright screenshot --viewport-size=32,32     scripts/brand/icon.html public/favicon-32.png
```

(Requires Playwright; `favicon.svg` is hand-authored and doesn't need regenerating unless the palette changes — its gradient stops are inlined in the SVG itself.)

## Tech stack

React 19 · TypeScript · Vite 7 · the React Compiler (enabled via `babel-plugin-react-compiler`)
