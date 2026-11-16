# @opal42/stylelint-plugin

Stylelint rules for the **smoothness score** of CSS gradients, with an opt-in
`--fix`. Working package name; not published yet. Requires Stylelint 16.14+
and Node 22+.

```js
// stylelint.config.js
export default {
  plugins: ['@opal42/stylelint-plugin'],
  rules: {
    'opal42/min-score': 70, // required, no default: choose your own number
    'opal42/no-finding': [['hue/wide-arc']],
    'opal42/valid-gradient': true,
  },
};
```

- `opal42/min-score`: reports gradients scoring below the minimum.
- `opal42/no-finding`: forbids specific coded findings, located on the offending stops.
- `opal42/valid-gradient`: reports gradients with a syntax error.

The score is a smoothness score by our definition, not a quality verdict.
`--fix` only rewrites a single, fully scorable gradient when the rewrite
strictly raises its score, and it can change colours. Everything runs locally:
no network, no telemetry.

Full reference (options, positions, SCSS/Less, autofix rules):
[docs/stylelint.md](https://github.com/LightSeek3r/gradient-studio/blob/master/docs/stylelint.md).
