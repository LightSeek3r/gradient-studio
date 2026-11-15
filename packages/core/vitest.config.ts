import { defineConfig } from 'vitest/config'

// Deliberately separate from vite.config.ts: the engine and colour formats are
// pure TypeScript, so tests need neither the React plugin nor a DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
