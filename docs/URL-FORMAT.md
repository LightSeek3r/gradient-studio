# Gradient Studio link and autosave format (v1)

The editor keeps the current gradient in the page address (the URL fragment
after `#`) and autosaves the same text in `localStorage` under the key
`gradient-studio:document`. Nothing is sent anywhere: the fragment is never
transmitted to a server by browsers, and the app makes no network requests.

Implementation: `apps/web/src/persist/url-codec.ts` (tests in
`apps/web/tests/url-codec.test.ts`).

## Shape

```
#v1;s=<stops>;d=<directions>;b=<blend>[;lang=<locale>]
```

Example (the default gradient):

```
#v1;s=101b45@0,3f1d63@50,9333ea@100;d=135:100:1;b=normal
```

| Segment | Required | Format | Rules |
|---|---|---|---|
| `v1` | yes, first | literal | Version tag. Anything else is rejected; a future format gets a new tag. |
| `s=` | yes | `rrggbb@pos` joined by `,` | 2–10 stops. Colour: exactly 6 hex digits, no `#`, any case (written lowercase). Position: percent 0–100, at most 2 decimals (`33.33`). Order does not matter. |
| `d=` | no (default `135:100:1`) | `angle:weight:enabled` joined by `,` | 1–7 directions. Angle: integer 0–359 (CSS degrees, 0 = to top, clockwise). Weight: integer 1–100. Enabled: `1` or `0`. At least one must be enabled. |
| `b=` | no (default `normal`) | keyword | One of `normal screen multiply overlay soft-light hard-light lighten darken difference`. |
| `lang=` | no | `en` or `fr` | Interface language of the link (see below). Not part of the gradient. |

Each key may appear at most once; unknown keys are rejected. The whole
fragment is capped at 1024 characters (a maximal valid document is about 230).

## Interface language: `lang=`

`;lang=en` or `;lang=fr` may be appended to a document fragment (`#v1;…;lang=fr`) or an issue
permalink (`#issue=lightness/reversal;lang=fr`). It is the first step of the language detection
order: **`lang=` in the fragment, then the choice stored in `localStorage`
(`gradient-studio:lang`), then `navigator.languages` (`fr*` is French, anything else English).**

- It is **optional and compatible**: a link with and without `lang=` decodes to the same
  gradient, and `lang` is never part of the document (selection, undo and "same document"
  comparisons ignore it). Because it is a normal `key=value` segment, it may appear in any
  position after the version tag, at most once like every other key.
- An unsupported value (`lang=de`, `lang=`) is **ignored** rather than rejecting the link, so a
  future locale never breaks a gradient in an older build. Other unknown keys are still rejected.
- It is written to the address bar and to links made with **Copy link** (and "Copy link to this
  rule") **only when the language was asked for**: it came from the fragment or from the
  switcher. An auto-detected language is not written, so a link does not stamp the sharer's
  browser language on its readers.
- Changing the fragment of an open tab to one with a different `lang=` switches the interface.
- Old builds (before localisation) reject a fragment with a `lang` key as an unknown key; a link
  without it works everywhere.

Implementation: `decodeLang` / `encodeDocument(doc, lang)` in `apps/web/src/persist/url-codec.ts`,
`parseHashLang` in `apps/web/src/i18n/locale.ts`.

## Decoding rules

- Decoding is strict and never throws. Any violation (bad version, malformed
  number, out-of-range value, too many stops or directions, oversized input)
  rejects the whole fragment; the app then falls back.
- Restore priority on load: **URL fragment > localStorage > default gradient**.
  A broken link therefore shows your last autosaved gradient (or the default),
  and the address is rewritten to the gradient actually shown.
- Ids are not stored. On load, stops get ids 1..n in position order and
  directions 1..n in list order, so the same text always yields the same
  document.
- Editing in an open tab updates the fragment with `history.replaceState`
  (debounced ~300 ms), so it does not add browser-history entries. Changing the
  fragment by hand (or pasting another link into the same tab) loads it as an
  undoable import.

## Issue permalinks: `#issue=<code>`

A second fragment shape links to **one rule of the score** instead of a
gradient:

```
#issue=lightness/reversal
```

`<code>` is a finding code of scoring model v1 (`dimension/rule`, see
`spec/scoring-v1.md`). Opening such a link loads that rule's example gradient
(`apps/web/src/examples.ts`, one per code, each tested to trigger its rule) and
expands the rule's row in the points ledger. Every ledger row has a "Copy link
to this rule" button, and the "Examples" list in the app is made of these links.

- A language may follow: `#issue=<code>;lang=fr` (any other suffix makes the link invalid).
- It cannot be mistaken for a document: document fragments start with the
  version tag (`v1;`), issue fragments with `issue=`. Each decoder rejects the
  other's shape.
- The code may be percent-encoded (`lightness%2Freversal`). Matching is exact
  and case-sensitive. An unknown code, or anything longer than 128 characters,
  is ignored: the link then behaves like a broken document link (autosave or
  the default gradient is shown).
- An issue link wins over autosave on load. In an open tab it loads the example
  as an undoable import.
- The fragment stays `#issue=<code>` while the example is untouched; the first
  edit replaces it with the normal `#v1;…` document fragment.

Implementation: `apps/web/src/persist/issue-link.ts` (tests in
`apps/web/tests/explain.test.ts`).

## Not stored

Selection, the suggestion being compared, open dialogs and undo history are
session-only UI state.
