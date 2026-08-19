/**
 * Lightweight cross-instance mutex for scheduled maintenance tasks.
 *
 * Uses a Postgres table as a distributed lock so daily sweepers
 * (audit log prune, invite expiry) execute at most once across all
 * replicas in a multi-instance deployment.
 *
 * Mechanism: INSERT ON CONFLICT DO UPDATE with a `setWhere` expiry
 * guard. The first instance that inserts a row for a given lock name
 * wins; others get zero rows returned via `.returning()` and skip.
 * On the next interval tick the existing row has expired, so the
 * INSERT succeeds for whoever claims it first.
 *
 * Two modes, selected by `opts.keepUntilExpiry`:
 *  - Default (mutex mode): the lock row is deleted once `fn` finishes,
 *    so it only guards against concurrent execution. If a process dies
 *    mid-sweep, the TTL auto-releases the lock so the next interval
 *    tick proceeds — no orphaned locks left behind.
 *  - `keepUntilExpiry: true` (claim mode): the lock row is left in
 *    place until its TTL lapses, so it doubles as a "ran recently"
 *    marker. Use this for tasks that must run at most once per TTL
 *    across all replicas (e.g. once per day), rather than merely once
 *    at a time — tick more frequently than the TTL so another replica
 *    picks the task up within one tick after a dead winner's claim
 *    lapses.
 */
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'sweep-lock' })

/**
 * Execute `fn` if no other instance currently holds the named sweep lock.
 *
 * @param name   - unique lock name (e.g. 'audit_prune', 'invite_sweep')
 * @param ttlMs  - how long the lock is held before auto-expiry. Must be
 *                 longer than the expected runtime of `fn`.
 * @param fn     - the sweeper to run. Called only when the lock was acquired.
 * @param opts.keepUntilExpiry - skip releasing the lock after `fn` completes,
 *                 so the row persists as a "ran recently" marker until the
 *                 TTL lapses. See module header for mutex vs. claim mode.
 */
export async function withSweepLock(
  name: string,
  ttlMs: number,
  fn: () => Promise<void>,
  opts?: { keepUntilExpiry?: boolean }
): Promise<void> {
  // INSERT ON CONFLICT DO UPDATE with setWhere: only take over an expired
  // row. The first INSERT wins; subsequent callers get zero rows returned
  // because the existing row hasn't expired yet.
  const result = await db.execute(sql`
    INSERT INTO sweep_lock (name, acquired_at, expires_at)
    VALUES (${name}, now(), now() + make_interval(secs => ${ttlMs / 1000}))
    ON CONFLICT (name) DO UPDATE
      SET acquired_at = now(),
          expires_at = now() + make_interval(secs => ${ttlMs / 1000})
      WHERE sweep_lock.expires_at < now()
    RETURNING name, acquired_at
  `)

  const rows = getExecuteRows(result) as Array<{ acquired_at: Date | string }>
  if (rows.length === 0) return // Another instance owns this lock

  const acquiredAt = rows[0]?.acquired_at

  try {
    await fn()
  } finally {
    if (!opts?.keepUntilExpiry) {
      // Release the lock so the next interval tick isn't blocked for the full
      // TTL after a transient failure. Guard on acquired_at so we don't clobber
      // a lock another instance took over after our TTL expired mid-fn.
      try {
        await db.execute(sql`
          DELETE FROM sweep_lock
          WHERE name = ${name} AND acquired_at = ${acquiredAt}
        `)
      } catch (err) {
        log.error({ err, name }, 'lock release failed')
      }
    }
    // else: leave the row in place — it doubles as a "ran recently" marker
    // until its TTL expires, per claim mode above.
  }
}
