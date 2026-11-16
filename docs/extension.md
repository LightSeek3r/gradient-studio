# Browser extension: DevTools panel "Gradients"

`apps/extension` (private workspace package `@opal42/extension`, working name
**Opal42 Gradient Score**). One codebase, built with [WXT](https://wxt.dev) 0.21
(Vite) for **Chrome/Edge** and **Firefox**, both Manifest V3. PLAN D2: a DevTools
panel only. No popup, no side panel, no toolbar button, no content script, no
background script.

Open DevTools on a page, choose the **Gradients** tab. The panel scans the
inspected page and lists every CSS gradient with:

- a preview swatch and the **smoothness score** (0-100, the v1 definition in
  `spec/scoring-v1.md`; neutral wording, no verdict words, no pass/fail, no
  default threshold);
- the **issues** that lowered it, each with its coded rule name, points, the
  stops it concerns and a one-sentence plain-language explanation (the same
  texts as the web app's points ledger);
- **Copy CSS**, **Copy refined CSS (+N)** and one **Copy fix: <label> (+N)** per
  finding (all from `refine` / `proposeFixes` of `@opal42/gradient`);
- **Open in Gradient Studio**: a plain link to the web app with the gradient in
  the URL hash (`docs/URL-FORMAT.md`). Only on click; the address is a setting;
- where it is used: up to 5 element selectors (and rules) shown, the true count
  kept, each element with **Highlight** (temporary outline on the page) and
  **Elements** (selects it in the Elements panel via `inspect()`);
- gradients it cannot score, with the reason (var(), calc(), translucent stops,
  radial/conic, repeating, vendor-prefixed, wide-gamut colours, ...).

**Re-scan** button; automatic re-scan (debounced 700 ms) when the inspected page
navigates; a follow-up scan while the page still says it is loading.

## How it works

```
devtools page (devtools.html)   registers the panel "Gradients" -> panel.html
panel page (panel.html, React)  scan -> group/dedupe -> parse/score/fix (core) -> UI
        |  chrome.devtools.inspectedWindow.eval(<scanner text>(<request>))
        v
inspected page (main world)     scanPage(): reads computed styles + stylesheets, returns JSON
```

| File (`apps/extension/src/lib`) | Role |
|---|---|
| `scanner.ts` | `scanPage`: ONE self-contained function; its `toString()` is what is evaluated in the page. Stateless, read-only, never throws. Ops: `info`, `sheet`, `elements`. |
| `scan-types.ts` | Serialisable request/result types and the scan limits. |
| `scan-result.ts` | Validation of what the page returns (the page is untrusted). |
| `scan-runner.ts` | Drives a scan as many short in-page calls; caps; progress; cancellation. |
| `scan-controller.ts` | Scan lifecycle: first scan, re-scan, navigation debounce, loading follow-up. |
| `analyze.ts` | Parse + dedupe + score + explain + fixes + refine + copy text. No scoring logic. |
| `studio-link.ts`, `settings.ts` | URL-hash encoder, studio address validation, the one setting. |
| `highlight.ts`, `devtools-api.ts`, `copy.ts` | Page highlight/inspect expressions, typed slice of `chrome.devtools`, clipboard. |
| `rule-text.ts`, `reasons.ts`, `notices.ts` | Plain-language texts. `rule-text.ts` is a copy of the web app's table (tests check coverage of every code). |

### What the scanner reads

- computed style of every element: `background-image`, `border-image-source`,
  `mask-image` (and its `-webkit-` alias, once), `list-style-image`; `var()` is
  already resolved in computed values;
- `::before` / `::after` of elements that generate a box;
- custom properties whose value holds a gradient: those declared with a gradient
  in a stylesheet or inline, read through computed style, **reported only at the
  declaring element** (they inherit, so descendants are not repeated);
- same-origin stylesheets as written (`document.styleSheets` plus
  `document.adoptedStyleSheets`): style rules, `@media`/`@supports`/`@layer`/
  `@container`, CSS nesting (nested selectors are shown in full), `@keyframes`,
  same-origin `@import`; shorthand and longhand report one value.

Cross-origin stylesheets throw `SecurityError` on `cssRules`: they are skipped
without error and listed in a notice. Gradients they define still appear when an
element uses them (computed style).

The same gradient found in several places (rule + element, hex in the rule and
`rgb()` in computed style, many elements) is **one entry** (key: the normalised
`toCSS` of the parsed document, or normalised text for skipped ones) with a
usage list.

### Limits (all in `scan-types.ts`, shown as notices when hit)

| Limit | Value |
|---|---|
| Elements examined | 5000 (notice: "only the first 5,000 of N") |
| Elements per in-page call / in-page time budget | 250 / 12 ms |
| Stylesheets read / rules per stylesheet | 200 / 60000 |
| Characters kept of one value | 20000 (longer: listed as "too long", not parsed) |
| Hits collected overall | 20000 |
| Distinct gradients listed | 500 (rest counted in a notice) |
| Usages stored per gradient / shown by default | 100 / 5 |

Measured in real Chromium (e2e): a 20,000-element page is walked as 24 calls, the
slowest 3-5 ms in the page (budget 12 ms; test bound 100 ms).

**Not covered:** elements inside iframes and shadow roots (top document only;
open shadow roots are not entered), gradients created only in canvas/SVG
`<linearGradient>`, gradients in `<style>` of detached documents.

## Permissions: none

The built manifests contain **no** `permissions`, `optional_permissions`,
`host_permissions`, `content_scripts`, `background`, `action`,
`web_accessible_resources`. A DevTools page needs none to create a panel and to
call `inspectedWindow.eval`: access to the inspected page is granted by DevTools
being open on it, per tab, by the user. No `storage` (the single setting uses the
panel page's own `localStorage`), no `clipboardWrite` (writes happen in a click;
verified in Chromium and real DevTools), no `tabs` (the studio link is an `<a
target="_blank">`).

Chrome/Edge manifest keys: `manifest_version: 3`, `name`, `short_name`,
`description`, `version`, `icons`, `minimum_chrome_version: "111"` (oldest
Chrome with every API and CSS feature the panel uses; raise it if a newer
feature is adopted), `content_security_policy`, `devtools_page`.

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'
```

`connect-src 'none'` makes network access impossible even if code tried
(e2e proves a `fetch` and an inline script are blocked on the real build). The
panel sets styles through the CSSOM (`element.style`), which `style-src 'self'`
allows; no inline `style=` attribute or `<style>` exists in its HTML.

Firefox adds `browser_specific_settings.gecko`:

- `id`: a fixed GUID (MV3 on AMO needs an id). **Permanent after the first
  upload.**
- `strict_min_version: "142.0"`: first release where `data_collection_permissions`
  is supported on both desktop and Android (Firefox 140 desktop / 142 Android,
  per Mozilla's data-consent documentation as recalled when this was written (U:
  re-check)); the older key is ignored by older Firefox, but AMO's linter wants a
  minimum.
- `data_collection_permissions: { "required": ["none"] }`: the extension collects
  and transmits nothing. `web-ext lint` (10.8.0) accepts this shape (0 errors).

### The permission gate (CI-able)

- `tests/permissions-allowlist.json` is the complete list of what the manifests
  may contain (top-level keys, permission arrays = empty, Firefox block, file
  patterns).
- `scripts/manifest-check.ts` diffs a manifest against it; `npm run build` runs it
  on both outputs (`scripts/check-manifest.ts`) and **fails** if anything is added.
- `tests/manifest.test.ts` (in `npm test`) exercises the checker on synthetic
  manifests (every permission, host permission, content script, background script,
  CSP loosening, new key, stray file must fail) and then builds both targets for
  real with WXT into a temp directory and diffs them.
- Changing the allow-list is a security decision: review it as one.

Also checked in `npm test`: no network/dynamic-code API anywhere in `src`
(`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `eval`, `new Function`,
`innerHTML`, `dangerouslySetInnerHTML`, `chrome.tabs`/`runtime`/`storage`...),
HTML pages load only their own module script, and the built bundles contain no
network call (Vite's modulepreload polyfill, which calls `fetch`, is disabled).

## Security notes

- **The inspected page is untrusted.** It can patch `Array`, `JSON`,
  `getComputedStyle`. The scanner's output is validated field by field with
  bounds (`scan-result.ts`); a lying page can at worst make the scan fail
  ("returned data the panel could not read"). Tested against a page that
  proxies `getElementsByTagName` to report 10^12 elements.
- Page strings are only ever rendered as React text. Never `innerHTML`, never
  evaluated, never fetched.
- The preview swatch is built from `toCSS(document)` (hex/`rgb()` only) for
  parsed gradients, and from the raw text only for radial/conic gradients that
  pass a strict allow-list (letters, digits, `( ) , . % # + - /`, no `url`,
  `image`, `var`, quotes, `;`, `:` ...). The CSP `img-src 'self' data:` blocks any
  image load regardless.
- Selectors for Highlight/Elements come from the page, are length-bounded and
  passed to `document.querySelector` as a JSON string literal, never concatenated
  as code (tested with hostile selectors).
- **Highlight** draws a `position: fixed` box appended to `<html>` for 1.8 s; the
  element's own styles are never modified, nothing needs restoring.
- The studio address must be `https:` (or `http:` on localhost), no credentials;
  query and fragment dropped; the hash only contains hex colours, positions and an
  angle.
- The scanner reads only; it leaves no global, listener or DOM change behind
  (tested: outerHTML identical before and after).

## Build, run, package

```bash
npm ci
npm run build:extension          # .output/chrome-mv3 and .output/firefox-mv3 + permission check
npm run zip:extension            # + store-ready zips in apps/extension/.output/
npm run test:e2e:extension       # build Chrome + Playwright (needs a Chromium that loads extensions)
```

Load unpacked: Chrome/Edge `chrome://extensions` -> Developer mode -> Load
unpacked -> `apps/extension/.output/chrome-mv3`; Firefox `about:debugging` ->
This Firefox -> Load Temporary Add-on -> `.output/firefox-mv3/manifest.json`.
Development: `npm run dev -w @opal42/extension` (WXT dev server; dev builds add
permissions for hot reload, production builds never do).

Outputs (untracked, in `apps/extension/.output/`): `opal42-gradient-score-<v>-chrome.zip`
(Chrome Web Store and Edge Add-ons), `-firefox.zip` (AMO), `-sources.zip` (AMO
source upload: the repository without dependencies; `npm ci && npm run
build:extension` reproduces `.output/firefox-mv3` byte for byte, checked).

Why WXT: it installed from the npm proxy, `npm audit` stays at 0 vulnerabilities,
it builds both targets from one manifest function (`manifest.ts`), zips for the
stores and produces a reproducible bundle. The extension does not use WXT's
auto-imports or generated globals, only its build.

Why MV3 for Firefox: with no background script there is no MV2/MV3 difference in
code; MV3 is the direction of both stores; `devtools_page` is supported in
Firefox MV3. `web-ext lint` on the Firefox build: **0 errors, 0 notices, 2
warnings** (`UNSAFE_VAR_ASSIGNMENT`: `innerHTML` assignments inside the React DOM
bundle; tell the AMO reviewer, see below). **Not run:** Firefox itself (see
"Not verified").

## Tests

| Suite | Command | What |
|---|---|---|
| Vitest (jsdom/node), 350+ tests | `npm test -w @opal42/extension` (part of `npm test`) | Scanner source text is self-contained and read-only; scanner against jsdom pages; result validation; runner protocol/caps/failures; analysis/dedupe/caps/reasons; Studio hash (accepted by the web app's own decoder); settings; highlight; controller; the whole panel in jsdom (scanner text -> analysis -> UI); axe (structure); static no-network checks; manifest gate incl. real builds. |
| Playwright, real Chromium, 32 tests | `npm run test:e2e:extension` | The scanner against real pages (cross-origin sheet, `@layer`, nesting, adopted sheets, 20k elements timing, hostile page); the **built** extension loaded unpacked, panel page under the real CSP and real manifest with a mocked `chrome.devtools` bridged to another tab over CDP: results, no off-origin request, CSP enforcement, axe **with colour contrast**, keyboard + focus ring, clipboard, Highlight, studio link, setting, re-scan, navigation debounce, 320 px width. |
| Playwright, real DevTools, 1 test | `xvfb-run npm run test:e2e:extension` (skipped without `DISPLAY`) | Headed Chromium with DevTools auto-opened; the **Gradients** panel is shown through DevTools' internal tab manager and driven over CDP: real `inspectedWindow.eval`, panel registration, Highlight, `inspect()` switching to Elements, copy, the `target=_blank` studio link, re-scan on real navigation. Uses DevTools front-end internals, so it can break on a Chromium update. |

### Not verified (be explicit)

- **Firefox at runtime.** No Firefox in the build environment. Verified: both
  manifests, `web-ext lint`, same code path as Chrome through `chrome.devtools`.
  Not verified: that the panel registers, `inspectedWindow.eval` returns objects
  as in Chrome, `inspect()` exists in Firefox's eval, clipboard writes without
  `clipboardWrite`, and `target=_blank` from a panel. Check by hand with
  `about:debugging` before submitting to AMO.
- **Edge.** Same Chromium engine and the Chrome zip; not run.
- **Light DevTools theme.** The panel is dark only (as the web app); it is
  readable on a light DevTools theme but not themed to it.
- **Store forms and review times** (below) are from memory of the current store
  flows, not checked against live dashboards.
- The CI job `extension` is new and has not run on GitHub; its Chromium comes from
  `npx playwright install chromium` (channel `chromium`, new headless).
- Real-world accuracy of the score is the project's open question (PLAN D5), not
  the extension's.

## Privacy

Add to every store listing and keep in sync with `PRIVACY.md`:

> **Gradient Score does not collect, store, transmit or share any data.** It has
> no network access (its content security policy forbids it), no analytics, no
> telemetry, no accounts and no remote code. When you open its panel in DevTools
> it reads the styles of the page you are inspecting, in that tab only, and
> analyses them on your device. Nothing is sent anywhere. The only thing it
> remembers is one optional setting (the web address of Gradient Studio), kept in
> the panel's own local storage on your device. "Open in Gradient Studio" is a
> normal link you click; the gradient is in the part of the address after `#`,
> which your browser never sends to a server.

## Store listing draft

Working name **Opal42 Gradient Score** (D1: the name still needs the registry and
trademark checks; the Chrome/Edge/Firefox listing name must be settled first).

**Short description (Chrome limit 132 characters; 124 here)**

> List the CSS gradients on the page you inspect, with a smoothness score and fixes. Runs locally: no permissions, no network.

**Category:** Developer Tools.

**Detailed description**

> Gradient Score adds a **Gradients** tab to your browser's DevTools. Open DevTools
> on any page, switch to the tab, and it lists every CSS gradient it finds: in
> computed styles (background, border-image, mask, list-style-image), in custom
> properties, and in the page's same-origin stylesheets.
>
> For each gradient you get a preview, a **smoothness score from 0 to 100**, the
> specific things that lowered it (lightness reversals, wide hue arcs, muddy
> midpoints, banding risk, uneven stop spacing ...) with a plain-language
> explanation of each, and the elements that use it. One click copies the CSS, a
> refined version that scores higher, or a targeted fix for a single issue.
> "Highlight" outlines the element on the page. "Open in Gradient Studio" opens the
> gradient in the free web editor.
>
> The score is a smoothness measure by a published definition, not a judgement of
> design: a deliberate hard-edged or very vivid gradient may score low and still be
> exactly what you want.
>
> **Private by design.** No permissions are requested. The extension has no network
> access, no analytics and no tracking, and all analysis happens on your device. It
> only works in DevTools, only on the tab you are inspecting.
>
> Limits: the first 5,000 elements of a page are examined; cross-origin stylesheets
> are not readable (gradients they define still show up when an element uses them);
> iframes and shadow DOM are not entered; radial/conic, repeating and translucent
> gradients are listed but not scored.
>
> Open source (MIT): https://github.com/LightSeek3r/gradient-studio

### Permission justification (paste into each store's form)

**Chrome Web Store: "Single purpose"**

> Show the CSS gradients of the page being inspected, with a smoothness score and
> suggested fixes, in a DevTools panel.

**Chrome Web Store: permission justifications.** The Permissions tab has nothing
to justify: the extension declares no permissions and no host permissions. If the
dashboard asks about the DevTools page:

> `devtools_page`: adds one panel ("Gradients") to DevTools. It uses
> `chrome.devtools.inspectedWindow.eval` to read computed styles and stylesheet
> rules of the inspected tab, which DevTools grants while it is open on that tab. No
> host permission, content script or background script is used.

**Remote code:** "No, I am not using remote code." (All JavaScript is in the
package; CSP `script-src 'self'`.)

**Data usage (Privacy practices tab):** collects none of the listed categories;
certify: not sold, not used for unrelated purposes, not used for creditworthiness.
Privacy policy URL: the repository's `PRIVACY.md` (or a published page with the text
above).

**Edge Add-ons:** same package, same text. "Permissions": none. Notes for
certification: "DevTools-only extension; open DevTools on any page, choose the
Gradients tab."

**Firefox (AMO)**

- Data collection: the manifest declares `data_collection_permissions.required =
  ["none"]`; in the submission form state that no data is collected or transmitted.
- Permissions: none requested.
- **Source code upload** (required because the bundle is minified): upload
  `opal42-gradient-score-<v>-sources.zip`.
- **Notes to the reviewer:**

> Build: Node 22+ and npm 10+. `npm ci`, then `npm run build:extension`; the
> submitted add-on is `apps/extension/.output/firefox-mv3`. The build is
> reproducible (identical output). The extension only registers a DevTools panel.
> `web-ext lint` reports two UNSAFE_VAR_ASSIGNMENT warnings for `innerHTML`: both are
> inside React DOM's own code (`react-dom`, unmodified; the extension's source never
> assigns `innerHTML`, enforced by a test). The panel evaluates a fixed scanner
> function in the inspected page with `devtools.inspectedWindow.eval`; the function
> only reads styles and returns JSON; the panel validates it and never executes or
> renders page data as markup. No network requests (CSP `connect-src 'none'`).
> To test: open DevTools on any page with CSS gradients, open the "Gradients" tab.

### Screenshot checklist (do not fabricate: capture from the real extension)

Chrome: 1280x800 (or 640x400) 24-bit PNG/JPEG, no alpha, up to 5; Edge: similar;
AMO: any reasonable size, at least 1. Capture from the **real DevTools** with the
build loaded (not from the test harness's mocked page), on a page you may show.

- [ ] Panel docked right, a page with several gradients visible, results list with
      scores and one expanded issue list (the main shot).
- [ ] An issue list open next to the swatch (explanations).
- [ ] "Copy refined CSS" / "Copy fix" buttons visible with their gains.
- [ ] "Highlight" in action: outline visible on the page behind the panel.
- [ ] "Not scored" section expanded (reasons), to show honest limits.
- [ ] Settings open (studio address).
- [ ] Small promo tile 440x280 and marquee 1400x560 (optional): the brand gradient
      on the dark background; no claims, no ratings, no competitor names.
- [ ] Re-check every screenshot and the listing text for verdict words, invented
      numbers and user data (page content, URLs, selectors from private pages).
- Store icon: `public/icon/128.png` (generated by `scripts/make-icons.ts`).

## Release checklist (owner steps, not automated)

1. Settle the name (D1) and update `manifest.ts` (`name`, `short_name`).
2. Dedicated publisher accounts with **hardware-key 2FA** for Chrome Web Store
   (one-time fee) and AMO; Edge Add-ons account. Never upload from a personal or
   shared account (PLAN D2, §7).
3. `npm run zip:extension`; verify the zips contain only the allow-listed files.
4. Smoke-test the exact zip contents: Chrome/Edge load unpacked; Firefox
   `about:debugging` (this has never been done, see "Not verified").
5. Upload; paste the texts above; attach screenshots.
6. After approval, record the install URLs, store ids and the Firefox add-on id in
   this file. 3-month gate per surface (PLAN §6 Phase 3): under about 200 installs
   and no issues: freeze.

Versioning: `version` comes from `apps/extension/package.json`; each store upload
needs a higher number.
