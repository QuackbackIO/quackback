import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // GitHub-hosted ubuntu-latest is 4 vCPU. Default maxWorkers is ~50% of
    // cores, which leaves half the runner idle. Pin to 4 in CI; locally leave
    // headroom for the rest of the machine. Isolation stays on: turning it
    // off leaked vi.mock state across files (~200 failures on a shard).
    maxWorkers: process.env.CI ? 4 : undefined,
    fileParallelism: true,
    pool: 'forks',
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
    ],
    // Use ts-node or vite's transformation instead of stripping
    typecheck: {
      enabled: false,
    },
    env: {
      DATABASE_URL: 'postgresql://postgres:password@localhost:5432/quackback_test',
    },
    deps: {
      optimizer: {
        ssr: { enabled: true },
      },
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
      '@quackback/db/schema-version': path.resolve(
        __dirname,
        './packages/db/src/schema-version.ts'
      ),
      '@quackback/db/schema-ops': path.resolve(__dirname, './packages/db/src/schema-ops.ts'),
      '@quackback/db/migrate': path.resolve(__dirname, './packages/db/src/migrate-runtime.ts'),
      '@quackback/db/schema': path.resolve(__dirname, './packages/db/src/schema/index.ts'),
      '@quackback/db/types': path.resolve(__dirname, './packages/db/src/types.ts'),
      '@quackback/db': path.resolve(__dirname, './packages/db/index.ts'),
      // Path alias for apps/web (matches tsconfig.json baseUrl: "./src" + "@/*": ["./*"])
      '@': path.resolve(__dirname, './apps/web/src'),
    },
  },
})
