import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Resolve workspace packages to their TypeScript source (`source` condition),
  // so tests do not need a built dist. The SDK is resolved with the workerd
  // conditions first to match what the bundled Worker uses.
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
