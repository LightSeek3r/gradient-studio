import { defaultClientConditions, defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string
}

// https://vite.dev/config/
export default defineConfig({
  build: {
    // Cloudflare Pages builds with `npm run build` and serves `dist/` at the
    // REPO ROOT, so the app emits there rather than into apps/web/dist.
    outDir: fileURLToPath(new URL('../../dist', import.meta.url)),
    emptyOutDir: true,
  },
  resolve: {
    // Workspace packages expose their TypeScript source under the `source`
    // condition; the `default` condition is the built dist, which only exists
    // after `npm run build -w @opal42/gradient`.
    conditions: ['source', ...defaultClientConditions],
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
  ],
})
