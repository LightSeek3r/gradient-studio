# @opal42/element

Custom elements that show the **smoothness score** of a CSS gradient:
`<opal42-gradient-score>` (score, coded findings in plain language, skip
reasons, optional suggested-fix preview) and `<opal42-gradient-preview>` (just a
swatch). Platform only: open shadow DOM, no framework, no runtime dependencies,
no network, no telemetry. Working package name; private, not published yet.

```html
<script type="module" src="./node_modules/@opal42/element/dist/opal42-element.js"></script>
<opal42-gradient-score css="linear-gradient(90deg, #ff0000, #0000ff)" show-fix></opal42-gradient-score>
```

```js
import { defineElements } from "@opal42/element"; // no side effects; SSR-safe
defineElements();                                  // idempotent; tag names can be overridden
```

- Attributes: `css` (or child text), `index`, `show-issues` (default on),
  `show-fix`, `compact`, `label`, `messages`, `debounce`. Property `result`,
  method `refine()`. Events `opal42-score` and `opal42-error` (composed).
- Theming: `--opal42-bg`, `--opal42-fg`, `--opal42-accent`, `--opal42-radius`;
  follows `prefers-color-scheme`, safe in forced-colors, respects reduced motion.
- Safe by construction: swatches are rebuilt from the parsed document and
  allow-list checked, never copied from the input; input is capped at 20 KB.
- The score is a smoothness score by our definition, not a quality verdict.

Full reference, security notes and the relationship to the web app:
[docs/element.md](https://github.com/LightSeek3r/gradient-studio/blob/master/docs/element.md).
Demo: `demo/index.html` (after `npm run build:packages`).
