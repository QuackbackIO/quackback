/**
 * Outbox relay leader election (EVENTING-V2 WO-3).
 *
 * Only one relay drains the outbox per instance, even with several worker
 * replicas. Leadership is a session-level Postgres advisory lock held on a
 * DEDICATED connection (a pooled connection can't hold a session lock reliably
 * across checkouts). Mirrors the migration lock in packages/db/src/migrate.ts;
 * the key is the neighbouring reserved value.
 */
import postgres from 'postgres'
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'outbox-relay-lock' })

/** Reserved advisory-lock key — MIGRATION_LOCK_KEY (4_820_231_099) + 1. */
export const OUTBOX_RELAY_LOCK_KEY = 4_820_231_100

export interface RelayLeadership {
  /** The dedicated connection holding the lock (also used for LISTEN). */
  sql: ReturnType<typeof postgres>
  /** Release the lock and close the connection. */
  release(): Promise<void>
}

/**
 * Try to become the relay leader. Returns a leadership handle if the advisory
 * lock was acquired, or null if another instance already holds it (this replica
 * then idles, retrying later). Non-blocking: uses pg_try_advisory_lock.
 */
export async function tryAcquireRelayLeadership(): Promise<RelayLeadership | null> {
  const sql = postgres(config.databaseUrl, { max: 1, idle_timeout: 0 })
  try {
    const rows = await sql<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(${OUTBOX_RELAY_LOCK_KEY}::bigint) AS locked
    `
    if (!rows[0]?.locked) {
      await sql.end({ timeout: 5 })
      return null
    }
    log.info('acquired outbox relay leadership')
    return {
      sql,
      async release() {
        try {
          await sql`SELECT pg_advisory_unlock(${OUTBOX_RELAY_LOCK_KEY}::bigint)`
        } catch (err) {
          log.warn({ err }, 'failed to release relay advisory lock (connection may be gone)')
        }
        await sql.end({ timeout: 5 }).catch(() => {})
      },
    }
  } catch (err) {
    await sql.end({ timeout: 5 }).catch(() => {})
    throw err
  }
}
