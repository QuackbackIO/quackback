import { defineConfig } from 'vitest/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Minimal .env loader so the app config (validated on first access) is populated
 * inside the Vitest workers. `bun --env-file` only seeds the parent process;
 * vitest's `test.env` is what reaches each worker. In CI the vars come from the
 * job env instead (this returns {} when there is no .env file).
 */
function loadDotenv(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!fs.existsSync(file)) return out
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (key) out[key] = val
  }
  return out
}

/**
 * Standalone Vitest project for the Quinn golden eval set (QUINN-TWO-AGENT-SPEC
 * §7). Deliberately NOT picked up by `bun run test`:
 *
 *  - The root and app vitest configs glob `**\/*.test.ts`; eval scenarios use
 *    the `.eval.ts` suffix, which neither default config matches, so the golden
 *    set never runs in the normal unit-test job. It only runs when this config
 *    is named explicitly (see the run command in the harness README / CI).
 *  - It hits the REAL configured dev model (OpenRouter etc.) and a REAL Postgres
 *    (every write rolls back), so it is slow and resource-gated by design.
 *
 * Run it from the repo root with the app's env file so the AI + DB config is
 * populated:
 *
 *   bun --env-file=.env vitest run --config apps/web/evals/vitest.config.ts
 *
 * Filter to a subset with `-t`, e.g. `-t "01"` or `-t "customer_support"`.
 */
const evalsDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(evalsDir, '../../..')
const webSrc = path.resolve(repoRoot, 'apps/web/src')
const dotenv = loadDotenv(path.resolve(repoRoot, '.env'))

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: evalsDir,
    include: ['**/*.eval.ts'],
    // Real model turns take several seconds each; a judged contrast runs two
    // turns plus a judge call. Generous per-test and per-hook budgets keep a
    // slow-but-healthy run from flaking, while a genuine hang still fails.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // The db-test-fixture is one-per-file and its transaction slot is module
    // global; a single worker keeps files from contending for it.
    fileParallelism: false,
    setupFiles: [path.resolve(repoRoot, 'vitest.setup.ts')],
    // Populate the app config inside each worker (see loadDotenv). Real process
    // env still wins for anything already set (CI job env, an explicit export).
    env: dotenv,
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        useDefineForClassFields: false,
      },
    },
  },
  resolve: {
    alias: {
      '@quackback/db/client': path.resolve(repoRoot, 'packages/db/src/client.ts'),
      '@quackback/db/schema': path.resolve(repoRoot, 'packages/db/src/schema/index.ts'),
      '@quackback/db/types': path.resolve(repoRoot, 'packages/db/src/types.ts'),
      '@quackback/db': path.resolve(repoRoot, 'packages/db/index.ts'),
      '@': webSrc,
    },
  },
})
