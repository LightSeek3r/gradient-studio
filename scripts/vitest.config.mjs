import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['scripts/tests/**/*.test.mjs'], root: new URL('..', import.meta.url).pathname },
})
