// Used by CI after `npm run build:packages`: loads the built plugin through stylelint's CLI.
export default {
  plugins: [new URL("../dist/index.js", import.meta.url).pathname],
  rules: { "opal42/min-score": 0, "opal42/valid-gradient": true },
};
