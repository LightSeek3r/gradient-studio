import { defineConfig } from "wxt";
import { buildManifest, type Target } from "./manifest";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  // A single codebase, MV3 on both targets (see docs/extension.md).
  manifestVersion: 3,
  manifest: ({ browser }) => buildManifest(browser as Target),
  // Don't open a browser on `wxt` (dev): developers load .output by hand.
  webExt: { disabled: true },
  zip: {
    name: "opal42-gradient-score",
    // AMO needs the sources of a bundled/minified add-on. The extension builds from
    // the whole npm workspace (it bundles packages/core), so the sources zip is the
    // repository without dependencies, build output, history and screenshots.
    sourcesRoot: "../..",
    excludeSources: [
      "**/node_modules/**",
      "**/.output/**",
      "**/.wxt/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "**/dist/**",
      "**/.git/**",
      "docs/screenshots/**",
      "docs/social-preview.png",
    ],
  },
  suppressWarnings: {},
  vite: () => ({
    // The workspace package exposes its TypeScript under the `source` condition.
    resolve: { conditions: ["source"] },
    build: {
      target: "es2022",
      sourcemap: false,
      // Vite's modulepreload polyfill calls fetch(); every browser this extension
      // supports preloads natively, and the CSP (connect-src 'none') would block it.
      modulePreload: { polyfill: false },
    },
  }),
});
