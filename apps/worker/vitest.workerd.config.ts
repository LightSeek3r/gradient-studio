import { defineConfig } from 'vitest/config'

// Opt-in suite against the real workerd runtime (starts `wrangler dev --local`).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests-workerd/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
