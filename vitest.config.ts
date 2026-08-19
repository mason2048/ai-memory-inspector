import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: [
        'src/analyzer.ts',
        'src/cleanup.ts',
        'src/corrections.ts',
        'src/custom-rules.ts',
        'src/exporter.ts',
        'src/importer.ts',
        'src/redaction.ts',
        'src/snapshot.ts',
        'src/storage.ts',
        'src/stream-importer.ts',
      ],
      thresholds: {
        branches: 80,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
  },
})
