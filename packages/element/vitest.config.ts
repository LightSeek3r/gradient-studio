import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Resolve the workspace core package to its TypeScript source (package.json
  // `source` condition), so tests do not need a built dist.
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    // Most tests need a DOM and opt in with `@vitest-environment jsdom`;
    // tests/ssr.test.ts must run without one.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
