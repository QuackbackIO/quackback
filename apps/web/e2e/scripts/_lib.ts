/**
 * Shared helpers for the e2e CLI scripts. Each script runs as a standalone
 * `bun --env-file` process (see e2e/utils/db-helpers.ts), so these own the
 * env guards and connection lifecycles the scripts would otherwise repeat.
 */
import postgres from 'postgres'

/** Open a postgres client, exiting with an error when DATABASE_URL is unset. */
export function openDb(): postgres.Sql {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required')
    process.exit(1)
  }
  return postgres(connectionString)
}

/**
 * Drop the cached workspace settings ('settings:workspace') so a running dev server
 * sees a raw-SQL settings mutation immediately instead of after the cache TTL.
 *
 * The cache is `kv_store` in the workspace's own database, so this is a DELETE
 * on the same connection the mutation used — no second service to reach, and
 * nothing to skip when an environment variable is unset.
 */
export async function bustWorkspaceSettings(sql: postgres.Sql): Promise<void> {
  await deleteCacheKeys(sql, ['settings:workspace'])
}

/**
 * Delete cache rows by logical key, across every workspace in this database.
 *
 * Not filtered by `workspace_key`: e2e runs one workspace, and a filter here would
 * need the namespace rule (`'_'` single-workspace, the workspace id otherwise)
 * duplicated in a test helper, where getting it wrong fails as a silent no-op
 * — a cache that was never busted looks exactly like a cache that was.
 */
export async function deleteCacheKeys(sql: postgres.Sql, keys: string[]): Promise<number> {
  const rows = await sql`DELETE FROM kv_store WHERE key = ANY(${sql.array(keys)}) RETURNING key`
  return rows.length
}

/** Parse a settings JSON text column, treating null/invalid as an empty object. */
export function parseJson(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>
  } catch {
    return {}
  }
}
