import js from '@eslint/js'
import globals from 'globals'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '**/dist', '**/node_modules', '**/coverage', '.changeset', '**/.output', '**/.wxt', '**/playwright-report', '**/test-results']),
  {
    // Every workspace: base JS + TypeScript rules.
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
    },
  },
  {
    // The web app and the extension panel run in the browser and are the only places React rules apply.
    files: ['apps/web/**/*.{ts,tsx}', 'apps/extension/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite, jsxA11y.flatConfigs.recommended],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // ColorTextField renders the <input>; a <label> that wraps it is a real association.
      'jsx-a11y/label-has-associated-control': ['error', { controlComponents: ['ColorTextField'] }],
    },
  },
  {
    // Core tests, vector scripts and tool configs run in Node, not the browser.
    files: [
      'packages/*/tests/**/*.ts',
      'packages/*/scripts/**/*.ts',
      'packages/*/vitest.config.ts',
      'packages/*/tsdown.config.ts',
      'packages/bench/src/**/*.ts',
      'packages/cli/src/**/*.ts',
      'packages/mcp/src/**/*.ts',
      'packages/stylelint-plugin/src/**/*.ts',
      'packages/style-dictionary/src/**/*.ts',
      'apps/web/vite.config.ts',
      'apps/web/vitest.config.ts',
      'apps/web/tests/**/*.ts',
      'apps/extension/{tests,scripts,e2e}/**/*.{ts,tsx}',
      'apps/extension/*.ts',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
])
