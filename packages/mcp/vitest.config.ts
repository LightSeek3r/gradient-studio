import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Resolve the workspace core package to its TypeScript source (package.json
  // `source` condition), so tests do not need a built dist.
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
