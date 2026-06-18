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
      // Isolated git worktrees live here; they are separate checkouts with
      // their own deps and must not be run by the parent repo's suite.
      '**/.claude/**',
      '**/*-integration.test.ts',
      // Widget package has its own vitest.config.ts with happy-dom — run via
      // `bun run --cwd packages/widget test`. Don't double-run from the root.
      'packages/widget/**',
      // TanStack Router uses dots as path separators, so the route file for
      // POST /api/v1/webhooks/:webhookId/test is named `$webhookId.test.ts`.
      // That collides with the `*.test.ts` glob — it's a route module, not a
      // test suite. Real route tests live under routes/**/__tests__/.
      '**/routes/api/v1/webhooks/$webhookId.test.ts',
    ],
    // Use ts-node or vite's transformation instead of stripping
    typecheck: {
      enabled: false,
    },
    env: {
      DATABASE_URL: 'postgresql://postgres:password@localhost:5432/quackback_test',
      // Mirror CI's env so any test that transitively loads server config
      // (config.ts validates baseUrl/secretKey/redisUrl on first access) is
      // self-sufficient and does not depend on the developer's shell env.
      BASE_URL: 'http://localhost:3000',
      SECRET_KEY: 'test-secret-key-for-vitest-only-min-32-chars-long',
      REDIS_URL: 'redis://localhost:6379',
    },
    coverage: {
      // v8 instrumentation. Activated only with `--coverage`, so normal runs are
      // unaffected. The JSON reporter feeds scripts/diff-coverage.mjs, which
      // enforces 100% line/branch coverage on lines changed by this branch.
      provider: 'v8',
      reporter: ['text-summary', 'json', 'json-summary'],
      reportsDirectory: './coverage',
      // Instrument only files that tests actually load (all: false). Changed
      // files never loaded by any test surface as missing in the report and the
      // diff-coverage gate counts their changed lines as uncovered.
      all: false,
      include: ['apps/web/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/__tests__/**',
        '**/e2e/**',
        '**/*.d.ts',
        '**/types.ts',
        // Generated / declarative route trees and config — no behavior to cover.
        '**/routeTree.gen.ts',
        '**/*.config.{ts,js}',
        'apps/web/src/locales/**',
      ],
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
