# Opal42 Gradient Score

A smoothness score for CSS gradients, right in the editor. Working name; not published yet.

The score (0-100) comes from published, coded rules about lightness, hue, chroma and stop spacing in OKLAB/OKLCH. It is a **smoothness score by our definition**, not a verdict on the design, and there is no default pass/fail threshold.

## What you get

- **Lens** above each scorable gradient: `Smoothness 72 - 2 issues`. Click it to show the details.
- **Diagnostics** on the exact stops behind each finding (source `opal42`, code such as `lightness/reversal`). Information or warning by default; error only below the optional `opal42.minScore`.
- **Quick fixes** (`Ctrl+.` / `Cmd+.`): `Apply fix: Make stop 2 darker (+12)` for each finding, and `Refine whole gradient (+32)`. A fix rewrites only the colour stops of that gradient (never the direction, `in oklch` clause, comments or anything around it) and is re-scored from the rewritten text before it is offered. They are ordinary workspace edits, so the editor's "Show preview" shows them as a diff first.
- **Hover** with the score, the four dimensions, a plain-language line per finding, and swatches of the current gradient and of the best proposed fix.
- **Commands**: `Opal42: Score current file` (summary in an output channel) and `Opal42: Open in Gradient Studio` (opens the web app with this gradient).

Works in CSS, SCSS, Less, HTML, Vue, Svelte, Astro, JS/TS (and JSX/TSX) strings and template literals, Markdown and MDX. Uses only the standard VS Code API, so it runs in VS Code, Cursor and VSCodium.

## Not scored (no lens by default)

Gradients the v1 score cannot judge are left alone: `var()`, `calc()`, `currentColor`, `color-mix()`, wide-gamut colours, template or preprocessor expressions, transparent stops, hard stops (stripes), repeating, radial and conic gradients, vendor-prefixed syntax. Turn on `opal42.showSkipped` to see a `Not scored - ...` lens with the reason.

## Settings

| Setting | Default | |
|---|---|---|
| `opal42.minScore` | unset | Below this score diagnostics are errors. No default threshold. Changes severity only. |
| `opal42.showSkipped` | `false` | Lens for gradients that are not scored. |
| `opal42.codeLens.enabled` | `true` | |
| `opal42.diagnostics.enabled` | `true` | |
| `opal42.maxFileSizeKB` | `500` | Larger documents are not analysed. |
| `opal42.studioUrl` | `https://gradient-studio-al4.pages.dev/` | Opened only by the "Open in Gradient Studio" command. |

## Privacy

**No network access and no telemetry.** The extension reads the text of your open documents, scores it in the extension host and shows the result. It sends nothing anywhere, collects no usage data, uses no telemetry API and stores nothing. The one outward action is "Opal42: Open in Gradient Studio", which opens your browser on the web app with the gradient in the link's fragment, and only when you run that command. (VS Code's own telemetry setting is separate and unaffected.)

## Install from a .vsix

`Extensions: Install from VSIX...` in the Command Palette, or `code --install-extension gradient-score-0.1.0.vsix`.

More: [docs/vscode.md](https://github.com/LightSeek3r/gradient-studio/blob/master/docs/vscode.md) and the [scoring rules](https://github.com/LightSeek3r/gradient-studio/blob/master/spec/scoring-v1.md).
