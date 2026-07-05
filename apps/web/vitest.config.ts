import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    // The default 5s is too tight for a ~590-file suite run fully in parallel:
    // a test's first `await import()` of a heavy module graph pays that graph's
    // esbuild transform inside the timed body, and under CPU saturation that
    // alone can edge past 5s and flake. 15s gives headroom without hiding a real
    // hang for long. (Heavy suites additionally hoist their SUT to a static
    // import so the transform is paid at file load — see the changelog tests.)
    testTimeout: 15_000,
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    setupFiles: [path.resolve(__dirname, '../../vitest.setup.ts')],
    exclude: ['**/node_modules/**', '**/.output/**', '**/e2e/**'],
    env: {
      DATABASE_URL: 'postgresql://postgres:password@localhost:5432/quackback_test',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
