import { defineConfig } from "vitest/config";

// Pure logic + component tests; no WXT plugin and no browser. The Playwright
// suite (e2e/) is separate and runs with `npm run test:e2e`.
export default defineConfig({
  // Workspace packages expose their TypeScript under the `source` condition.
  resolve: { conditions: ["source"] },
  esbuild: { jsx: "automatic" },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    // tests/manifest.test.ts builds both targets with WXT.
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
