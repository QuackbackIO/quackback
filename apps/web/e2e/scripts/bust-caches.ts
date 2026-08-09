/**
 * CLI: delete the given cache keys so a running dev server picks up raw-SQL
 * mutations immediately.
 *
 * The cache is `kv_store` in the workspace's own database, so this is a DELETE
 * over the same DATABASE_URL every other e2e script already uses — which is
 * also why it works in CI, where there is no docker exec to fall back on.
 *
 * Usage: bun bust-caches.ts <key> [key...]
 */
import { openDb, deleteCacheKeys } from './_lib'

const keys = process.argv.slice(2)
if (keys.length === 0) {
  console.error('Usage: bun bust-caches.ts <key> [key...]')
  process.exit(1)
}

const sql = openDb()

try {
  const deleted = await deleteCacheKeys(sql, keys)
  console.log(JSON.stringify({ deleted }))
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
} finally {
  await sql.end()
}
