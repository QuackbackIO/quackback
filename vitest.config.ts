import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**'],
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
      '@quackback/db/catalog': path.resolve(__dirname, './packages/db/src/catalog/index.ts'),
      '@quackback/db/tenant': path.resolve(__dirname, './packages/db/src/tenant/index.ts'),
      '@quackback/db/types': path.resolve(__dirname, './packages/db/src/types.ts'),
      '@quackback/db': path.resolve(__dirname, './packages/db/index.ts'),
      // Path alias for apps/web (matches tsconfig.json baseUrl: "./src" + "@/*": ["./*"])
      '@': path.resolve(__dirname, './apps/web/src'),
    },
  },
})
