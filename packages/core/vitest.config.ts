import { defineConfig } from 'vitest/config'

// Deliberately separate from vite.config.ts: the engine and colour formats are
// pure TypeScript, so tests need neither the React plugin nor a DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The corpus-wide contract tests (proposeFixes, export goldens) are exhaustive on
    // purpose and take a few seconds each; the 5 s default fails under parallel load.
    testTimeout: 30_000,
  },
})
