# VS Code extension

`apps/vscode` is the editor surface of the smoothness score: a CodeLens, diagnostics, quick fixes and a hover above every linear CSS gradient. Working id **`opal42.gradient-score`** (publisher `opal42` is a placeholder until the owner creates the account, see the checklist). It is a private workspace package and **nothing is published yet**.

It is a thin adapter over `@opal42/gradient` (scoring model v1, [`spec/scoring-v1.md`](../spec/scoring-v1.md)). All logic that does not need the editor is in plain modules testable on strings; only `src/extension.ts` imports `vscode`.

The number is a **smoothness score by our definition** (PLAN D5): neutral wording, no verdict words, no default pass/fail threshold.

## Features

| Feature | Behaviour |
|---|---|
| Code lens | `Smoothness 72 - 2 issues` above each scorable gradient (one lens per gradient, also several on a line). Click: moves the cursor in and shows the hover. Gradients that are not scored get **no** lens unless `opal42.showSkipped` is on (`Not scored - uses var()`). |
| Diagnostics | One per finding, `source: opal42`, `code` = the finding code (`lightness/reversal`, ...), range = the offending stops (the whole gradient when the finding names none). Severity: information or warning from the finding (a finding of severity `error` shows as warning). **Error only** when `opal42.minScore` is set and the gradient's score is below it. |
| Quick fixes | `Apply fix: <label> (+N)` for each entry of `proposeFixes` (one per finding) and `Refine whole gradient (+N)`. Only the colour-stop arguments are rewritten: not the direction, the `in oklch` clause, comments or the code around the gradient. Each rewrite is re-parsed and re-scored from the rewritten text and offered only if it reaches the promised, strictly higher score. When a moved stop would shift an automatically placed neighbour, positions are written explicitly. They are standard `WorkspaceEdit`s with a label: use the code-action menu's "Show preview" (`Ctrl+Shift+Enter`) to see them as a diff before applying. |
| Hover | Score, the four dimensions (`Lightness 18/30 · Hue 10/30 · Chroma 10/20 · Spacing 20/20`), one plain-language paragraph per finding (the rule texts of `apps/web/src/explain/explain.ts`, imported and bundled, so the app and the editor use the same words), an inline SVG swatch of the gradient and of the best proposed fix as a `data:` markdown image, and a link that runs `Open in Gradient Studio`. |
| Score current file | Command `Opal42: Score current file`: line:column, score and findings per gradient in the `Opal42` output channel. |
| Open in Gradient Studio | Command `Opal42: Open in Gradient Studio`: the gradient under the cursor (or a pick when the cursor is on none of several) as `<studioUrl>#v1;s=...;d=...;b=normal` ([`URL-FORMAT.md`](URL-FORMAT.md)), opened with `env.openExternal`. Up to 10 stops (the link format's limit); otherwise a warning. |

The swatch SVG is built from a fixed template; the only dynamic values are colours matching `/^#[0-9a-f]{6}$/i` and numbers written with `toFixed`, so nothing a document contains can reach the markup. It is drawn the way CSS renders the gradient (sRGB, or the gradient's own `in` space), in a 240x28 box with the exact CSS gradient-line geometry.

### What is not scored

`var()`, `calc()`/math functions, `env()`, `currentColor`, `color-mix()`, relative and wide-gamut colours, template/preprocessor expressions (`${...}`, `$x`, `@x`, `#{...}`), vendor-prefixed and legacy syntax, radial and conic, repeating, transparent stops, **hard stops** (two stops at one position: stripes), fewer than two stops. Same skip list as the CLI and the Stylelint plugin (parser codes in [`spec/parser.md`](../spec/parser.md)). A gradient with a colour hint, a double-position stop or a translucent stop is never rewritten.

### Languages

Activation (not `*`): `css`, `scss`, `less`, `html`, `vue`, `svelte`, `astro`, `javascriptreact`, `typescriptreact`, `javascript`, `typescript`, `markdown`, `mdx`. In JS/TS/HTML/Markdown a gradient inside a string, template literal or code block is found. In `css`/`scss`/`less` a gradient inside a quoted string (`content: "linear-gradient(...)"`) is not a gradient and is ignored, as in the Stylelint plugin. Tailwind classes and CSS-in-JS built from expressions are outside the reach of a text scanner.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `opal42.minScore` | **unset** | Score (0-100) below which a gradient's diagnostics become errors. No default (D5). Changes severity only: lens, findings and fixes stay the same. A score equal to the value is not below it. |
| `opal42.showSkipped` | `false` | Lens and hover for gradients that are not scored. |
| `opal42.codeLens.enabled` | `true` | |
| `opal42.diagnostics.enabled` | `true` | |
| `opal42.maxFileSizeKB` | `500` | Documents above this UTF-8 size are not analysed (10-2000). |
| `opal42.studioUrl` | `https://gradient-studio-al4.pages.dev/` | Base address for the Studio command. Must be `http(s)://`; anything else falls back to the default. |

## Performance

- Analysis is debounced by 300 ms per document after edits, runs only for the changed document, and is cached by document version and settings (lens, hover and code-action requests in between hit the cache; closing a document drops it).
- Size cap (500 KB by default, measured in UTF-8 bytes; a longer string is rejected without being encoded), at most 1500 gradients per document, and a 250 ms time budget per analysis. A cap or budget hit yields a partial result (the output channel report says so); the host is never blocked on huge files.
- Fixes are computed on demand for the gradient under the cursor or hover, not for the whole file, and cached per document version.
- The parser is a single linear pass with bounded nesting; pathological input is covered by the core's fuzz tests and the extension's own tests.
- Everything registered in `activate` is disposed through `context.subscriptions`, pending timers and caches included.

## Privacy

**No network access and no telemetry.** The extension reads the text of the documents you open, computes in the extension host and shows the result. It makes no network request, uses no telemetry API, has no runtime dependencies (the core is bundled into `dist/extension.js`) and persists nothing. The single outward action is `env.openExternal` in `Opal42: Open in Gradient Studio`, executed only when you run that command (a hover link or the palette entry); the gradient travels in the URL fragment, which browsers do not send to servers. Tests assert that the bundle requires nothing but `vscode`, contains no network or telemetry API, and that `openExternal` appears in exactly one place. It declares support for untrusted and virtual workspaces because it only reads text. VS Code's own telemetry setting is separate. See [`PRIVACY.md`](../PRIVACY.md).

## Build, test, package

```sh
npm run build   -w gradient-score   # esbuild -> apps/vscode/dist/extension.js (CJS, bundles @opal42/gradient)
npm test        -w gradient-score   # vitest: analysis, fixes, hover/SVG, Studio links, manifest, bundle smoke test
npm run package -w gradient-score   # typecheck + build + vsce package -> apps/vscode/gradient-score-0.1.0.vsix
npm run ls      -w gradient-score   # the exact file list of the .vsix
```

The `.vsix` (about 41 KB) contains only `dist/extension.js`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE` and `images/icon.png` (`.vscodeignore` is an allow-list). It stays untracked (`*.vsix` is git-ignored). `npm run icon -w gradient-score` regenerates the 128x128 icon from the web app's `icon-512.png`.

The smoke test bundles the extension, loads the bundle in plain Node against a stub `vscode` module and drives activation, the providers, the commands and disposal. No real VS Code is downloaded. It does not replace trying the `.vsix` in a real editor once before the first release.

Dev dependencies: `@types/vscode` is pinned to `1.90.0` (the oldest supported engine; `vsce` rejects newer types), `@vscode/vsce` ^4, `esbuild`. A root `overrides` entry pins `minimatch` for `@vscode/vsce` to `^11.0.1` so `npm audit` stays clean.

## Install from a .vsix

Command Palette: `Extensions: Install from VSIX...`, or `code --install-extension apps/vscode/gradient-score-0.1.0.vsix` (`cursor` / `codium` for Cursor / VSCodium). It uses only the public VS Code API.

## Limits

- Scores only what scoring model v1 scores (opaque `#rrggbb`-expressible stops, at least two). It measures the stops, not the rendered path.
- Quick fixes change colours (they are the same edits the web app's Suggest makes); review them. Corner keywords (`to top right`) are scored as for a square box.
- Hover images need a client that renders `data:` images in markdown (VS Code does; some forks may not).
- Not tested in a real editor in CI (stub-based smoke test only); only the 1.90 API surface is used.

## Publishing checklist (owner steps, NOT done)

1. **Name and trademark**: settle D1 (the "Opal" word is crowded; run the INPI/EUIPO/USPTO check for software classes 9/42) before the first listing. The id `opal42.gradient-score` and the display name are working names.
2. **Marketplace publisher**: create a publisher in the Visual Studio Marketplace (Azure DevOps / Microsoft Entra account, hardware-key 2FA, a dedicated account per PLAN D2/§7). Check that the id `opal42` is free, or change `publisher` in `apps/vscode/package.json`.
3. **Personal access token** for `vsce` (scope: Marketplace, Manage); `npx vsce login <publisher>`. Keep it out of the repo; later automation should use a protected CI environment secret.
4. **Open VSX** (Cursor and VSCodium read it, not the Marketplace): create an account at open-vsx.org, sign the publisher agreement, create the namespace (`npx ovsx create-namespace opal42 -p <token>`), create a token.
5. Bump `version` and the `CHANGELOG`, add a screenshot or GIF to the README (none is included) and confirm that the README text and the privacy statement are what the listing should say. The workspace package is `private: true` (it is never published to npm); `vsce` packages it regardless.
6. Try the `.vsix` once in a real VS Code and in Cursor or VSCodium (lens, hover with images, a quick fix with "Show preview", the Studio command).
7. Publish: `npm run package -w gradient-score` then `npx vsce publish --no-dependencies --packagePath apps/vscode/gradient-score-<version>.vsix` (add `--pre-release` for a first preview) and `npx ovsx publish apps/vscode/gradient-score-<version>.vsix -p <token>`.
8. After listing: add the store links to the root README and this page; apply the PLAN §6 gate (under about 200 installs and no issues after three months: freeze).
