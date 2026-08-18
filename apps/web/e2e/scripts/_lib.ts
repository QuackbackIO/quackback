/**
 * Shared helpers for the e2e CLI scripts. Each script runs as a standalone
 * `bun --env-file` process (see e2e/utils/db-helpers.ts), so these own the
 * env guards and connection lifecycles the scripts would otherwise repeat.
 */
import postgres from 'postgres'
import Redis from 'ioredis'

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
 * Drop the Redis-cached tenant settings ('settings:tenant') so a running dev
 * server sees a raw-SQL settings mutation immediately instead of after the
 * cache TTL. No-op when REDIS_URL is unset.
 */
export async function bustTenantSettings(): Promise<void> {
  if (!process.env.REDIS_URL) return
  const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 5000 })
  try {
    await redis.connect()
    await redis.del('settings:tenant')
  } finally {
    redis.disconnect()
  }
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
