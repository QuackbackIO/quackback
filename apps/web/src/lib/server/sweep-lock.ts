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
import { runFleetPass } from '@/lib/server/workspaces/fleet'
import { isPooledTenancy } from '@/lib/server/workspaces/mode'
import { getWorkspaceScope } from '@/lib/server/workspaces/workspace-context'
import { WorkspaceKeyedCache } from '@/lib/server/workspaces/workspace-keyed'

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
  // Under pooled tenancy a sweeper tick has no workspace, and `db` refuses to
  // resolve without one. Fan the tick out across the fleet here rather than at
  // each of the ten call sites: every scheduled sweeper in `startup.ts` and the
  // telemetry claim already funnel through this function, so one seam scopes
  // all of them, and no caller changes.
  //
  // The lock itself needs no workspace segment. `sweep_lock` lives in the workspace's
  // OWN database, so once `db` is scoped the lock is already per-workspace — which
  // is exactly the semantics wanted: two workspaces must sweep independently, and
  // two replicas must not sweep the same workspace concurrently.
  if (isPooledTenancy() && !getWorkspaceScope()) {
    await runFleetPass('sweep', () => acquireAndRun(name, ttlMs, fn, opts))
    return
  }
  await acquireAndRun(name, ttlMs, fn, opts)
}

async function acquireAndRun(
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

/**
 * The in-process half of the same guard, partitioned by workspace.
 *
 * `withSweepLock` stops two *replicas* sweeping one workspace. A sweeper also
 * needs to stop *itself* re-entering — the long AI sweeps overlap their own
 * schedule (`startup.ts` fires each at boot and again every 30 minutes, and a
 * fleet pass over N workspaces is serial), so a second tick can begin while the
 * first is still working.
 *
 * That guard used to be a module-scope `let _sweepInProgress`, which is
 * correct only while a process serves one workspace. Under pooling, `runFleetPass`
 * walks the fleet through the same function: with a shared boolean the first
 * workspace to start the sweep suppresses it for **every other workspace** for as
 * long as it runs, and the suppression is invisible — the sweep simply returns,
 * nothing is logged, and the only symptom is that some workspaces' summaries
 * silently stop refreshing.
 *
 * Keyed per workspace and per sweep name, so two sweeps never share a latch either.
 */
const inFlightSweeps = new WorkspaceKeyedCache<true>(4_096)

export async function withWorkspaceSweepReentrancyGuard(
  name: string,
  fn: () => Promise<void>
): Promise<void> {
  if (inFlightSweeps.has(name)) return
  inFlightSweeps.set(name, true)
  try {
    await fn()
  } finally {
    inFlightSweeps.delete(name)
  }
}

/** Test seam: forget the active workspace's in-flight latches. */
export function __resetSweepReentrancyForWorkspace(): void {
  inFlightSweeps.clearWorkspace()
}
