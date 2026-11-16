import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts: the tested modules (state, codec, import
// parser, suggestion compare) are pure TypeScript and need neither the React
// plugin nor a DOM.
export default defineConfig({
  // Resolve workspace packages to their TypeScript source (see vite.config.ts).
  resolve: { conditions: ['source'] },
  // Component tests (tests/a11y.test.tsx) use JSX without the React plugin.
  esbuild: { jsx: 'automatic' },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
