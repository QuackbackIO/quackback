import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Many server tests do a first-time dynamic import() inside the test body
    // (the vi.mock factory pattern). Under parallel CPU contention that load
    // can exceed the 5s default — and a timeout firing mid-import() corrupts
    // the module graph for later tests. 20s gives headroom; genuine hangs
    // still fail well before the suite stalls.
    testTimeout: 20000,
    include: ['**/*.test.ts', '**/*.test.tsx'],
    setupFiles: [path.resolve(__dirname, './vitest.setup.ts')],
    exclude: [
      '**/node_modules/**',
      '**/.next/**',
      '**/e2e/**',
      '**/.output/**',
      '**/*-integration.test.ts',
      // Widget package has its own vitest.config.ts with happy-dom — run via
      // `bun run --cwd packages/widget test`. Don't double-run from the root.
      'packages/widget/**',
    ],
    // Use ts-node or vite's transformation instead of stripping
    typecheck: {
      enabled: false,
    },
    env: {
      DATABASE_URL: 'postgresql://postgres:password@localhost:5432/quackback_test',
    },
  },
  esbuild: {
    // Disable esbuild's strip-only mode to properly handle TypeScript features
    tsconfigRaw: {
      compilerOptions: {
        useDefineForClassFields: false,
      },
    },
  },
  resolve: {
    alias: {
      '@quackback/db/client': path.resolve(__dirname, './packages/db/src/client.ts'),
      '@quackback/db/schema': path.resolve(__dirname, './packages/db/src/schema/index.ts'),
      '@quackback/db/types': path.resolve(__dirname, './packages/db/src/types.ts'),
      '@quackback/db': path.resolve(__dirname, './packages/db/index.ts'),
      // Path alias for apps/web (matches tsconfig.json baseUrl: "./src" + "@/*": ["./*"])
      '@': path.resolve(__dirname, './apps/web/src'),
    },
  },
})
