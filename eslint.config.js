import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'coverage/**',
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'src-tauri/target/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['src/custom-rules.ts', 'src/redaction.ts'],
    rules: { 'no-control-regex': 'off' },
  },
  {
    files: ['src/importer.ts'],
    rules: {
      'no-useless-escape': 'off',
      'preserve-caught-error': 'off',
    },
  },
  {
    files: ['tests/**/*.ts', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.js', '*.config.mjs'],
    languageOptions: { globals: globals.node },
  },
)
