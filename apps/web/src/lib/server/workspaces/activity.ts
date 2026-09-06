/**
 * Which pooled workspaces are worth running background work for.
 *
 * ## The measurement
 *
 * A fleet of 111 active registry workspaces had 6 with any users. The job worker
 * ran a poll loop for all 111 — a scope open, a schedule tick and a `job_queue`
 * claim every few seconds, plus a dozen cron enqueues an hour, plus every fleet
 * sweep (`runFleetPass`) opening every database twice an hour — and the 105 that
 * nobody had visited in weeks cost the same as the 6 that were in use. On the
 * primary that was most of the connection churn and most of the hot page cache.
 *
 * ## The rule
 *
 * A workspace is **dormant** when no HTTP request has reached it for
 * `config.workspaceDormantAfterHours` (default seven days). Dormant workspaces
 * get no job loop and are skipped by fleet passes. The next request wakes them:
 * the request path stamps `cp_workspace_activity`, the worker's next refresh
 * (≤ 60s) sees the stamp and starts the loop again.
 *
 * Idle is decided by *requests*, not by pool usage, because the worker's own
 * loop keeps a pool warm — measuring that would keep every workspace awake
 * forever. Health probes never reach the request hook (`request-scope.ts`
 * `FLEET_PATHS`), so the platform's probing cannot wake anything either.
 *
 * ## What idleness is not allowed to skip
 *
 * "Nobody visited" is not the same as "nothing to do". A workspace can be idle
 * with a delayed job in its queue (a hook retry, a scheduled publish) or a
 * clock-driven deadline (a snoozed conversation, an SLA due-at). Those are the
 * two things the database already knows how to report — `earliestPendingJobAt`
 * and `earliestWorkspaceDeadline` — so the worker asks both before it parks a
 * loop, and keeps the loop for any workspace that answers. That check needs the
 * workspace's own database, so it lives in the worker (`worker.ts`), and the
 * result is published here (`hasStandingWork`) so a fleet pass in the same
 * process honours the same exception.
 *
 * ## Where the stamp lives
 *
 * `cp_workspace_activity` is a control-plane table (CP migration 0089) written
 * by this app from the request path, on the same footing as
 * `cp_workspace_schema_state`. It has to be shared storage rather than process
 * memory: the web replica sees the requests and the worker replica owns the
 * loops. Writes are throttled to one per workspace per `STAMP_INTERVAL_MS`, so
 * a busy workspace costs one tiny control-plane UPDATE every five minutes and a
 * quiet one costs nothing.
 */
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import { getControlSql } from './registry'

const log = logger.child({ component: 'workspace-activity' })

/** Minimum gap between two activity stamps for the same workspace. */
export const STAMP_INTERVAL_MS = 5 * 60_000

const lastStampedAt = new Map<string, number>()

/** Workspaces the worker found idle but kept awake for pending or deadline work. */
const standingWork = new Set<string>()

/** Workspaces the worker has parked. Read for status; the decision is the worker's. */
const dormant = new Set<string>()

/**
 * Is a workspace with this last-activity stamp past the dormancy threshold?
 *
 * Null (no stamp) is *active*: the row is missing for a workspace the control
 * plane minted before the table existed and the migration backfill missed, or
 * the table is not there yet. Both are "unknown", and unknown must not park a
 * workspace that may have real users.
 */
export function isPastDormancyThreshold(
  lastActiveAt: Date | null,
  now = Date.now(),
  thresholdHours = config.workspaceDormantAfterHours
): boolean {
  if (thresholdHours <= 0) return false
  if (lastActiveAt === null) return false
  const ms = lastActiveAt.getTime()
  if (Number.isNaN(ms)) return false
  return now - ms > thresholdHours * 3_600_000
}

/**
 * Record that a request reached this workspace. Fire-and-forget: the request
 * must never wait on, or fail because of, the control plane.
 *
 * Returns the write promise (resolved on skip) so tests can await it.
 */
export function noteWorkspaceActivity(workspaceKey: string, now = Date.now()): Promise<void> {
  // Everything — config, throttle, the write — sits behind one async boundary so
  // that nothing here can throw into the request path synchronously.
  return stampIfDue(workspaceKey, now).catch((err: unknown) => {
    // Try again on the next request rather than in five minutes.
    lastStampedAt.delete(workspaceKey)
    log.warn(
      { err, workspaceKey },
      'could not stamp workspace activity; the worker may park this workspace as dormant'
    )
  })
}

async function stampIfDue(workspaceKey: string, now: number): Promise<void> {
  if (!config.isPooledTenancy) return
  const last = lastStampedAt.get(workspaceKey)
  if (last !== undefined && now - last < STAMP_INTERVAL_MS) return
  lastStampedAt.set(workspaceKey, now)
  await stamp(workspaceKey)
}

async function stamp(workspaceKey: string): Promise<void> {
  await getControlSql().unsafe(
    `INSERT INTO cp_workspace_activity (workspace_key, last_active_at)
     VALUES ($1, now())
     ON CONFLICT (workspace_key) DO UPDATE SET last_active_at = now()`,
    [workspaceKey]
  )
}

export function markStandingWork(workspaceKey: string, has: boolean): void {
  if (has) standingWork.add(workspaceKey)
  else standingWork.delete(workspaceKey)
}

export function hasStandingWork(workspaceKey: string): boolean {
  return standingWork.has(workspaceKey)
}

export function markDormant(workspaceKey: string, is: boolean): void {
  if (is) dormant.add(workspaceKey)
  else dormant.delete(workspaceKey)
}

export function isMarkedDormant(workspaceKey: string): boolean {
  return dormant.has(workspaceKey)
}

export function dormantCount(): number {
  return dormant.size
}

export function listDormantWorkspaces(): string[] {
  return [...dormant]
}

/**
 * Should a fleet pass skip this workspace right now?
 *
 * Past the threshold and not kept awake for standing work. A pass in a process
 * without a job worker (the one-shot `QUACKBACK_CRON_JOB` entry point) has an
 * empty standing-work set and skips every idle workspace, which is the
 * conservative reading of "nobody asked for this".
 */
export function shouldSkipForDormancy(
  workspace: { workspaceKey: string; lastActiveAt: Date | null },
  now = Date.now()
): boolean {
  if (!isPastDormancyThreshold(workspace.lastActiveAt, now)) return false
  return !hasStandingWork(workspace.workspaceKey)
}

/** Forget every dormancy decision. The worker calls this when it stops owning loops. */
export function resetDormancyMarks(): void {
  standingWork.clear()
  dormant.clear()
}

/** Test seam. */
export function __resetWorkspaceActivityForTests(): void {
  lastStampedAt.clear()
  resetDormancyMarks()
}
