# Web components: `<opal42-gradient-score>` and `<opal42-gradient-preview>`

`@opal42/element` (working name, private, not published: [`RELEASING.md`](RELEASING.md))
shows the **smoothness score** of a CSS gradient in any page. It is two custom
elements built on the platform only (custom elements, open shadow DOM,
`CustomEvent`, `MutationObserver`): no Lit, no React, no runtime dependencies.
It is an adapter over `@opal42/gradient`: all scoring, parsing, fixing and CSS
printing is the core's (scoring model v1, [`scoring-v1.md`](../spec/scoring-v1.md)),
the element only renders results. PLAN §5 lists the web component as "on
demand"; this is the one component that row allows.

The number is a smoothness score by our definition, not a quality verdict (PLAN
D5). The element shows no verdict words and **no default threshold**.

## Use without a bundler

Build once (`npm run build:packages`), then load the single self-contained file
(core is bundled in, about 27 kB gzip, no other files needed):

```html
<script type="module" src="./packages/element/dist/opal42-element.js"></script>

<opal42-gradient-score show-fix
  css="linear-gradient(90deg, #ff0000 0%, #00ff00 50%, #0000ff 100%)"></opal42-gradient-score>

<!-- or child text, e.g. a whole rule; a <script type="text/plain"> is never executed or shown -->
<opal42-gradient-score index="1">
  <script type="text/plain">
    .a { background: linear-gradient(90deg, #111, #eee); }
    .b { background: linear-gradient(120deg, #7c3aed, #f97316); }
  </script>
</opal42-gradient-score>

<opal42-gradient-preview css="linear-gradient(90deg in oklab, #0ea5e9, #f43f5e)"></opal42-gradient-preview>
```

`packages/element/demo/index.html` is a static demo (no CDN) that loads the file
this way.

## Use with a bundler

```js
import { defineElements } from "@opal42/element"; // no side effects, SSR-safe
defineElements();                                  // idempotent
// or: import "@opal42/element/define";            // registers on import
```

`defineElements({ scoreTag, previewTag, registry })` renames the tags (a second
tag for the same class gets a trivial subclass) and returns
`{ scoreTag, previewTag, defined }`. A tag that already holds these classes is
left alone; a tag held by something else throws. Without `customElements`
(Node) it returns `defined: false` and does nothing. Importing any entry reads no
DOM global; the classes extend `HTMLElement` only when it exists.

The package exports `.`, `./define`, `./standalone` (the single file),
`./package.json`.

## `<opal42-gradient-score>`

| Attribute / property | Meaning |
|---|---|
| `css` / `css` | CSS text containing one or more gradients. Wins over child text. Setting the property sets the attribute. |
| child text | Used when there is no `css` attribute (text node or `<script type="text/plain">`). Edits are picked up. |
| `index` / `index` | 0-based gradient to show. Default: the first scorable one, else the first. Out of range is an `invalid` state. |
| `show-issues` / `showIssues` | Findings list. **On by default**; off with `show-issues="false"` (also `0`, `off`, `no`). |
| `show-fix` / `showFix` | "Suggested fix" preview (the best `proposeFixes` fix and its gain). Off by default. A preview only; nothing is applied. |
| `compact` / `compact` | Smaller layout, findings collapsed, no sentences. |
| `label` / `label` | Accessible name prefix (default "Gradient"; `aria-label` is used as a fallback). |
| `messages` (JSON attribute) / `messages` (property) | Text overrides, see below. |
| `debounce` / `debounce` | Update delay in ms (default 50, `0` = immediate). |
| `result` (read-only) | `{ status, score, findings, gradients, index, truncated, css, stops, swatch, skipped, invalid, fix }`, frozen. `status` is `ok`, `skipped` (found, not scored: carries `skipped.code` and `reason`), `empty` or `invalid` (`no-gradient`, `index-out-of-range`, `internal`). |
| `refine()` | The one-click refinement of the shown gradient as a CSS string (never lower score; unchanged CSS when the refiner declines), or `null` when nothing is scorable. Does not touch the element. |
| `flush()` | Render now. |

States: scorable (swatch, score, findings), skipped (swatch when parseable,
the parser's reason and code, no number), empty, invalid, several gradients
("Showing gradient 2 of 3"), and a visible notice when the input was cut.

### `<opal42-gradient-preview>`

Only the swatch, from `css` (or child text, `index`). Same sanitising. Name:
`label`/`aria-label`, else "Gradient preview from #aaaaaa to #bbbbbb". Default
height `4rem`; size the host from outside.

### Events

Both bubble and are `composed`. Neither fires for the same result twice.

- `opal42-score`: `detail = { score, status, findings }` (`score` is `null`
  unless `status` is `ok`; each finding is `{ code, severity, dimension, pointsLost, message }`).
  The first one is delivered after a microtask, so a listener added right after
  the element is created hears it.
- `opal42-error`: `detail = { code, message }` for `no-gradient`,
  `index-out-of-range`, `too-large` (input cut at 20 KB; the rest still renders)
  and `internal`. Empty input and skipped gradients are not errors.

### Text and localisation

Rule names and sentences, severity words, labels and notices come from a small
English table (`DEFAULT_MESSAGES`, keyed by id; one name and one sentence per v1
finding code). Replace any entry:

```js
el.messages = { "score.name": "Indice de douceur", "rule.hue/wide-arc.name": "arc de teinte large" };
// or: messages='{"score.name":"Indice de douceur"}'
```

Only string values are used; `{name}` placeholders are filled in. Unknown
finding codes fall back to the code's last segment and core's English message.
Skip reasons are core's English text unless you set `skipped.<code>`.

**Relationship to `apps/web`.** The element does not import web-app source. The
web app has its own translated catalogue (`apps/web/src/i18n`) and plain-language
rule texts (`apps/web/src/explain`); the element carries its own English copy of
those rule sentences so the package stays self-contained. A test checks that
every v1 finding code has an entry. The two copies are maintained separately.

## Theming

The shadow root encapsulates styles: page CSS cannot reach in (tested, and
checked in a real browser with hostile `!important` rules). Four custom
properties inherit in and are the supported theming surface:

| Property | Default light / dark |
|---|---|
| `--opal42-bg` | `#ffffff` / `#16161c` |
| `--opal42-fg` | `#1a1a22` / `#ececf2` |
| `--opal42-accent` | `#2a4bd0` / `#9db1ff` |
| `--opal42-radius` | `10px` |

Defaults follow `prefers-color-scheme`. Under `forced-colors: active` the
element uses `Canvas`, `CanvasText` and `Highlight`, and swatches keep their
colours (`forced-color-adjust: none`) with a text-coloured border. Parts: `card`,
`swatch`, `score`, `issues`, `fix`, `skipped`. Needs `color-mix()` (baseline
2023) for the muted text colour and borders.

## Accessibility

- `role="group"` with an `aria-label` such as "Gradient: smoothness score 87 out
  of 100" (updated on change).
- One persistent polite live region (`role="status"`, `aria-live="polite"`,
  atomic) announces "Smoothness score 87 out of 100. 2 findings." when the text
  changes; the card body is rebuilt without replacing it.
- The findings are a native `<details>`/`<summary>`: keyboard focusable, with a
  visible focus ring. Its open state and focus survive updates.
- Swatches are `role="img"` named from validated hex colours; the decorative
  score bar is `aria-hidden`.
- Transitions run only under `prefers-reduced-motion: no-preference`.
- Checks: axe via `vitest-axe` in jsdom (structure, names, roles; 0 violations in
  every state) and `npm run browser`, which runs axe **with colour contrast** in
  Chromium in light, dark, forced-colors and a 360 px viewport.

## Security and privacy

- **No injection path.** The DOM is built with `createElement` / `textContent`;
  there is no `innerHTML` anywhere (a test greps the source). Input text is never
  copied into styles or attributes. The swatch is rebuilt from the *parsed
  document* with the core's `toCSS` (colours as `#rrggbb` or `rgb(r g b / a)`,
  numbers) and then matched against a strict allow-list regex; a value that fails
  is dropped. It is applied with `style.setProperty` (CSS object model), so a
  strict CSP without `'unsafe-inline'` for styles works; the stylesheet is a
  constructable one (a `<style>` element is the fallback).
- Tested with `</style><script>`, `url(javascript:...)`, `@import`, `expression()`,
  attribute and quote breakouts, null bytes, bidi and lone surrogates, huge
  numbers, 500 stops, comment and parenthesis bombs, multi-megabyte input: no
  `script`/`style`/event-handler is created, nothing throws, no network.
- **20 KB cap** (`MAX_INPUT_LENGTH`, 20 480 UTF-16 units): longer input is cut and
  a visible notice plus an `opal42-error` (`too-large`) say so. Messages are
  capped too (2 000 characters per entry, 20 KB for the attribute).
- Skip reasons come from the core and may quote a few characters of the input
  (for example an unknown colour name); they are rendered as text and cut at 200
  characters.
- **Zero network, no storage, no telemetry** ([`PRIVACY.md`](../PRIVACY.md)): no
  `fetch`, no storage, no clipboard, no remote CSS, fonts or images. A test greps
  the source and another stubs `fetch`/XHR.
- Each element runs the scorer on every update. Updates are debounced and the
  input is capped, but a page that renders hundreds of elements with
  `show-fix` should expect `proposeFixes` cost per element.

## Size

One self-contained file, minified, **27.25 kB gzip** (core included). Budgets (measured
+ about 10 %, `npm run size`): standalone file 30 kB; `import { defineElements }`
from the library entry 30.1 kB; `import { analyzeCss }` (pure analysis, no
elements) 25.9 kB. About 23 kB of this is the core's parser, scorer and
`proposeFixes` ([`PACKAGING.md`](PACKAGING.md)); the elements themselves are about 4 kB.
The library entries (`dist/index.js`, `dist/define.js`) are unminified and share
one chunk with core bundled in.

## Checks

`npm test -w @opal42/element` (vitest; jsdom for DOM tests, plain Node for the
SSR test), `npm run typecheck`, `lint:package` (publint), `attw`, `size`.
`npm run browser -w @opal42/element` is the real-browser check (local only, not
in CI): it serves the package on port 4203 (`PORT=` to change), loads the demo
in Chromium, fails on console errors, off-server requests, invisible swatches or
axe violations, and writes screenshots to `packages/element/demo/screenshots/`
(git-ignored). Chromium comes from `OPAL42_CHROME` or `/opt/pw-browsers/chromium`.
