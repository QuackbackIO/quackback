import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
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
