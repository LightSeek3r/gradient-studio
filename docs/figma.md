# Figma plugin: Opal42 Gradient Score (working name)

`apps/figma`, a private workspace package. A Design Mode plugin that scores the
linear gradients in your selection for smoothness, explains each finding in plain
language and writes refined gradients back. Local only: the manifest declares
`networkAccess: { allowedDomains: ["none"] }`, and nothing is bundled from a remote
host.

## Read this first: it has NOT been run inside Figma

Everything below was built and tested offline, with no Figma account, desktop app
or Dev Mode. What exists and what does not:

| Claim | Status |
|---|---|
| Logic (reading paints, scoring, fixes, apply plans, message validation) | Unit-tested with plain objects (195 tests in `apps/figma/tests`). |
| The sandbox handlers (`selectionchange` -> analysis, apply -> `node.fills = [...]`, undo, export, create) | Tested against a **stub** `figma` object I wrote from the typings. The stub is my reading of the API, not Figma. |
| The UI | Tested in jsdom (DOM, keyboard, messages). Never rendered in Figma's iframe; layout at 320x480 is unseen. |
| The bundle (`dist/manifest.json`, `code.js`, `ui.html`) | Builds; contains no remote URLs, `fetch`, fonts or external scripts (a test checks). Whether Figma's sandbox accepts the ES2017 output is **not verified**. |
| `@figma/plugin-typings` 1.142.0 | Installed as a dev dependency (audit clean). It is the source for every API shape below. `figma.apiVersion` is typed `'1.0.0'`, which the manifest `api` matches (tested). |
| `gradientTransform` convention | **Unverified.** The typings only say "the positioning of the gradient within the layer" and give `Transform` as a 2x3 array. Core's convention (identity = left to right, the matrix maps the layer's unit box into gradient space) is derived, see [`exports.md`](exports.md). The plugin therefore never builds a new matrix from an angle for existing layers: it keeps the layer's own matrix and replaces only the stops. Only **Create from CSS** uses core's derived matrix, so check one created rectangle against the CSS first. |
| Undo | The typings say plugin actions are not in Figma's undo history unless `figma.commitUndo()` is called, and that an undo then reverts back to the last commit. The plugin calls `commitUndo()` before each write so that Edit > Undo should revert exactly one action. **Not seen working.** |
| `themeColors: true` | In the typings (adds CSS variables to the iframe). The variable names (`--figma-color-bg`, `--figma-color-text`, ...) are **not** in the typings; they are from memory, each with a fallback, plus `prefers-color-scheme`. |
| Manifest keys other than `documentAccess: "dynamic-page"` | `name`, `id`, `api`, `main`, `ui`, `editorType`, `networkAccess` are **not described by the typings**. Their shape is from memory of Figma's manifest documentation. The `id` is a placeholder: Figma assigns the real one (see the checklist). |
| Display P3 files | The typings expose `documentColorProfile` (`LEGACY`, `SRGB`, `DISPLAY_P3`). Channels are read as sRGB values; how Figma converts is not verified. The plugin tells you when a file uses Display P3. |

## Features

**Selection analysis.** On every selection change the plugin walks the selected
layers and everything inside them (at most 1500 layers and 40 gradients, with a
note when it stops) and lists every gradient fill and stroke:

- `GRADIENT_LINEAR` paints become a core document (`fromFigmaPaint`: angle from
  `gradientTransform` in the layer's real aspect ratio, 8-bit hex colours, stop alpha)
  and are scored by the v1 model: a **smoothness score** from 0 to 100, with the
  coded findings, each with its points, the stops it names and the one-sentence
  explanation from `apps/web/src/explain`. No pass/fail, no verdict colours.
- Radial, angular and diamond paints are listed as "Not scored" with the reason.
- Paints with a variable bound to a stop are left alone ("Not scored", because a write
  would unbind it). Image, solid, video and pattern paints are only counted.
- Transparent stops are listed as "Not scored" (the v1 model judges opaque stops
  only), but can still be copied. A paint's own `opacity` is not part of the score;
  it is kept on every write and multiplied into the copied CSS.
- Hard stops (stripes) are not scored, as in the other surfaces.
- Layers with mixed fills (text with several colours) are skipped with a note.

**Actions** (each recomputed in the sandbox from the live paint; the UI only names an
action and never sends colours to write):

- **Apply refined (+N)**: the core refinement, pre-sampled into about the chosen
  number of stops (slider, 2 to 16, default 8). "Figma blends in RGB, so we
  pre-compute OKLAB stops." 2 keeps just the refined stops. The count is "about":
  every original stop is kept and the samples are shared between segments.
- **Apply fix: <label> (+N)**: one button per `proposeFixes` entry. Fixes change
  only the stops they name and are not baked.
- **Copy CSS** and **Copy as ...**: any export format of
  [`@opal42/gradient/export`](exports.md) for the gradient as Figma shows it, in the
  layer's box. Copying uses a hidden textarea and `execCommand("copy")`, then
  `navigator.clipboard`; if both are refused, the text is shown selected for Ctrl+C.
- **Undo last change**: restores the paints the plugin replaced, but only while the
  layer still holds what the plugin wrote; otherwise it refuses and points you to
  Figma's own Edit > Undo.
- Layer name: selects the layer on the canvas.
- Warnings are shown before you act: component instance (or inside one), main
  component, locked (or inside a locked layer; the typings say plugins can still
  write to it), and layers that use a paint style (whether the link survives a
  write is not verified).
- A write that would change nothing (already refined, same stops) is not made.

**Create gradient from CSS.** The "From CSS" tab takes pasted CSS, runs core's
`parseGradient`, and on the explicit button creates one 320x200 rectangle per linear
gradient (at most 10) at the viewport centre. Skipped gradients (radial, conic,
repeating, `var()`, ...) are listed with core's reason. OKLAB/OKLCH gradients are baked
with the same slider; plain sRGB ones are written exactly.

**Accessibility and design.** Native buttons, a tablist with arrow keys, a live
status region, visible focus, focus kept across re-renders, labelled controls, a
resize grip that works with the pointer and the arrow keys (Shift for bigger steps).
Default size 320x480, resizable within 280-720 by 320-900. Colours follow Figma's
theme variables with light and dark fallbacks. No external fonts; CSS is inline.

## Not included

- **Dev Mode.** The typings do document `figma.mode`, `figma.codegen` and an
  `editorType` of `dev`, but the manifest keys for codegen and inspect plugins are
  not in the typings, so they could not be verified. The plugin is Design Mode only
  (`editorType: ["figma"]`).
- FigJam, Slides, Buzz.
- Scoring of radial or angular gradients (the v1 model has no such rules).
- Reading Figma styles or variables (a variable-bound gradient is skipped).

## Architecture

```
src/messages.ts       typed UI <-> sandbox protocol + validators (pure)
src/paint-adapter.ts  Figma paint <-> core document (pure)
src/analyze.ts        selection walk, scoring views, apply plans, exports (pure)
src/sandbox.ts        everything that touches figma.*  (start(api, html))
src/code.ts           manifest "main": start(figma, __html__)
src/ui.ts             the window (DOM only), ui-main.ts the transport, ui.template.html the shell
scripts/build.mjs     esbuild -> dist/{manifest.json, code.js, ui.html}
```

Scoring logic lives in core; this package adds adapters and UI only (see
[`SCOPE.md`](../SCOPE.md)). Messages from the UI are validated strictly (unknown
types, extra fields, bad ids, out-of-range numbers are rejected); messages from the
sandbox are validated before rendering, and a swatch is only accepted if it is a plain
`linear-gradient(...)`. The UI does not check `event.source`, because the shape of
Figma's message envelope was not verified; validation is the defence.

## Development

```bash
npm install
npm run build:figma            # apps/figma/dist/{manifest.json,code.js,ui.html}
npm test -w opal42-figma       # 195 tests
npm run typecheck -w opal42-figma
```

Load it in Figma (desktop app): **Plugins > Development > Import plugin from
manifest...**, choose `apps/figma/dist/manifest.json`. Select a layer with a gradient
and run it from Plugins > Development. Rebuild and re-run after changes.

First things to check in a real file (none has been seen):

1. A default linear gradient: is the angle shown right (identity matrix = left to right)?
2. A rotated, flipped and handle-resized gradient: is the angle plausible, and does
   "Apply refined" keep the handles?
3. Apply refined, then Edit > Undo in Figma: does one undo revert it?
4. A non-square layer: does the created gradient from CSS match the CSS box?
5. Resize grip and the theme variables in light and dark.

## Privacy

No network (`allowedDomains: ["none"]`), no analytics, no storage; nothing leaves the
plugin. See [`PRIVACY.md`](../PRIVACY.md). The plugin does not read or send file
content anywhere; it reads the selected layers' paints only to score them.

## Owner's submission checklist (later; nothing here was submitted)

- [ ] Create the plugin in Figma (Plugins > Development > New plugin) to get the real
      `id`, and put it in `manifest.json`. Do not publish with the placeholder.
- [ ] Decide the final name (working name "Opal42 Gradient Score"; check trademarks
      and that it does not imply Figma endorsement).
- [ ] Publisher profile in Figma Community (name, contact, support URL, terms).
- [ ] Run through the "first things to check" above in a real file, on Mac and Windows,
      in light and dark themes, with a large selection.
- [ ] Re-verify the manifest keys against Figma's current manifest documentation.
- [ ] Cover image/icon, description, tags, and screenshots (made from a real run).
- [ ] Privacy and network statement for the listing: no network access, no data
      collected; matches `PRIVACY.md`.
- [ ] Figma's review: expect questions on network access and on how writes are made.
      Review times and any fees for paid plugins were not verified (PLAN §6).
- [ ] Release automation: build from a tag, attach `dist/` to the release.
