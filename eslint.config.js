import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '**/dist', '**/node_modules', '**/coverage', '.changeset']),
  {
    // Every workspace: base JS + TypeScript rules.
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
    },
  },
  {
    // The web app runs in the browser and is the only place React rules apply.
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Core tests, vector scripts and tool configs run in Node, not the browser.
    files: [
      'packages/*/tests/**/*.ts',
      'packages/*/scripts/**/*.ts',
      'packages/*/vitest.config.ts',
      'packages/*/tsdown.config.ts',
      'packages/cli/src/**/*.ts',
      'apps/web/vite.config.ts',
      'apps/web/vitest.config.ts',
      'apps/web/tests/**/*.ts',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
])
