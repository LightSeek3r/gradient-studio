import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts: the tested modules (state, codec, import
// parser, suggestion compare) are pure TypeScript and need neither the React
// plugin nor a DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
