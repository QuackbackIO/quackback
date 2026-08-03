import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json', 'json-summary'],
      reportsDirectory: './coverage',
      all: false,
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**', '**/*.d.ts'],
    },
  },
})
