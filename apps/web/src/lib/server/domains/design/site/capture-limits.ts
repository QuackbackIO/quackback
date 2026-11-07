/**
 * Usage limits for site captures, counted from site_capture_calls.
 *
 * Every call counts, billed or not: the provider does not bill failures, but
 * a run of failures still costs time and a retry loop must not slip past the
 * limits. The windows are per teammate per rolling hour, per workspace per
 * UTC day and per calendar month (UTC), and an instance-wide monthly cap.
 *
 * The counts are per database. On a single-workspace install that is the
 * workspace and the instance alike. In pooled cloud each workspace has its own
 * database, so the "instance" count is per workspace there too, and the guard
 * on the whole provider account is the provider's own quota error
 * (`screenshots_limit_reached`), which the capture service treats as final.
 *
 * A capture claims its slot before the call (`claimCall`, under a
 * transaction-scoped advisory lock, so two requests cannot both take the
 * last slot) and settles it with the outcome afterwards (`settleCall`). The
 * lock is held only for the check and the insert, never across the call.
 */
import type { PrincipalId } from '@quackback/ids'
import { and, db, eq, gt, gte, siteCaptureCalls, sql } from '@/lib/server/db'
import { config } from '@/lib/server/config'

export type CaptureLimitName = 'user_hour' | 'workspace_day' | 'workspace_month' | 'instance_month'

export interface CaptureLimitRefusal {
  limit: CaptureLimitName
  resetsAt: Date
}

export interface CaptureLimits {
  userHour: number
  workspaceDay: number
  workspaceMonth: number
  instanceMonth: number
}

export function captureLimits(): CaptureLimits {
  return {
    userHour: config.screenshotoneUserHourlyLimit,
    workspaceDay: config.screenshotoneWorkspaceDailyLimit,
    workspaceMonth: config.screenshotoneWorkspaceMonthlyLimit,
    instanceMonth: config.screenshotoneMonthlyLimit,
  }
}

const HOUR_MS = 60 * 60 * 1000
/** One lock for every check-and-insert on site_capture_calls in this database. */
const LOCK = sql`SELECT pg_advisory_xact_lock(hashtext('quackback:site_capture_calls'))`

type Executor = Pick<typeof db, 'select' | 'insert' | 'update' | 'execute'>

export function utcDayStart(now: number): Date {
  const d = new Date(now)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
export function utcMonthStart(now: number): Date {
  const d = new Date(now)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}
function nextUtcDay(now: number): Date {
  return new Date(utcDayStart(now).getTime() + 24 * HOUR_MS)
}
function nextUtcMonth(now: number): Date {
  const d = new Date(now)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
}

export interface CaptureCounts {
  userHour: number
  workspaceDay: number
  month: number
  /** The teammate's calls in the last hour, oldest first, for when the hour frees up. */
  userHourTimes: Date[]
}

async function counts(
  tx: Executor,
  principalId: PrincipalId | null,
  now: number
): Promise<CaptureCounts> {
  const monthStart = utcMonthStart(now)
  const dayStart = utcDayStart(now)
  const hourAgo = new Date(now - HOUR_MS)
  const since = hourAgo < monthStart ? hourAgo : monthStart
  const [row] = await tx
    .select({
      month: sql<number>`count(*) FILTER (WHERE ${gte(siteCaptureCalls.createdAt, monthStart)})::int`,
      day: sql<number>`count(*) FILTER (WHERE ${gte(siteCaptureCalls.createdAt, dayStart)})::int`,
    })
    .from(siteCaptureCalls)
    .where(gte(siteCaptureCalls.createdAt, since))
  const userHourTimes = principalId
    ? (
        await tx
          .select({ at: siteCaptureCalls.createdAt })
          .from(siteCaptureCalls)
          .where(
            and(
              eq(siteCaptureCalls.principalId, principalId),
              gt(siteCaptureCalls.createdAt, hourAgo)
            )
          )
          .orderBy(siteCaptureCalls.createdAt)
      ).map((r) => r.at)
    : []
  return {
    userHour: userHourTimes.length,
    workspaceDay: row?.day ?? 0,
    month: row?.month ?? 0,
    userHourTimes,
  }
}

function refusalFor(
  c: CaptureCounts,
  limits: CaptureLimits,
  now: number,
  hasPrincipal: boolean
): CaptureLimitRefusal | null {
  const refusals: CaptureLimitRefusal[] = []
  if (c.month >= limits.instanceMonth) {
    refusals.push({ limit: 'instance_month', resetsAt: nextUtcMonth(now) })
  }
  if (c.month >= limits.workspaceMonth) {
    refusals.push({ limit: 'workspace_month', resetsAt: nextUtcMonth(now) })
  }
  if (c.workspaceDay >= limits.workspaceDay) {
    refusals.push({ limit: 'workspace_day', resetsAt: nextUtcDay(now) })
  }
  if (hasPrincipal && c.userHour >= limits.userHour) {
    // The hour frees a slot when enough of its calls are an hour old.
    const freeing = c.userHourTimes[c.userHour - limits.userHour] ?? c.userHourTimes[0]
    refusals.push({
      limit: 'user_hour',
      resetsAt: new Date((freeing?.getTime() ?? now) + HOUR_MS),
    })
  }
  if (refusals.length === 0) return null
  // The one that lasts longest is when a capture is possible again.
  return refusals.reduce((a, b) => (b.resetsAt > a.resetsAt ? b : a))
}

/** Whether a capture may run now, or the limit that stops it and when it lifts. */
export async function checkLimits(
  principalId: PrincipalId | null,
  now: number = Date.now(),
  opts: { limits?: CaptureLimits; tx?: Executor } = {}
): Promise<CaptureLimitRefusal | null> {
  const c = await counts(opts.tx ?? db, principalId, now)
  return refusalFor(c, opts.limits ?? captureLimits(), now, principalId !== null)
}

export interface CaptureUsageLeft {
  workspaceDayLeft: number
  userHourLeft: number
  /** Captures left this month; the smaller of the workspace and instance allowances. */
  instanceMonthLeft: number
}

export async function usageLeft(
  principalId: PrincipalId | null,
  now: number = Date.now(),
  opts: { limits?: CaptureLimits } = {}
): Promise<CaptureUsageLeft> {
  const limits = opts.limits ?? captureLimits()
  const c = await counts(db, principalId, now)
  const monthLeft = Math.min(limits.instanceMonth, limits.workspaceMonth) - c.month
  return {
    workspaceDayLeft: Math.max(0, Math.min(limits.workspaceDay - c.workspaceDay, monthLeft)),
    userHourLeft: Math.max(0, limits.userHour - c.userHour),
    instanceMonthLeft: Math.max(0, monthLeft),
  }
}

/**
 * Check the limits and, when they allow it, take a slot, atomically. The slot
 * is a call row with the outcome `pending`, which counts like any other until
 * `settleCall` gives it its outcome.
 */
export async function claimCall(
  input: { host: string; principalId: PrincipalId | null; now?: number },
  opts: { limits?: CaptureLimits } = {}
): Promise<{ ok: true; id: string } | { ok: false; refusal: CaptureLimitRefusal }> {
  const now = input.now ?? Date.now()
  return db.transaction(async (tx) => {
    await tx.execute(LOCK)
    const refusal = await checkLimits(input.principalId, now, { limits: opts.limits, tx })
    if (refusal) return { ok: false as const, refusal }
    const id = crypto.randomUUID()
    await tx.insert(siteCaptureCalls).values({
      id,
      host: input.host,
      principalId: input.principalId,
      outcome: 'pending',
      billed: false,
      createdAt: new Date(now),
    })
    return { ok: true as const, id }
  })
}

/** Give a claimed call its outcome. */
export async function settleCall(id: string, result: { outcome: string; billed: boolean }) {
  await db
    .update(siteCaptureCalls)
    .set({ outcome: result.outcome, billed: result.billed })
    .where(eq(siteCaptureCalls.id, id))
}

/** Record a call that did not claim a slot first, under the same lock. */
export async function recordCall(input: {
  host: string
  principalId: PrincipalId | null
  outcome: string
  billed: boolean
  now?: number
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(LOCK)
    await tx.insert(siteCaptureCalls).values({
      id: crypto.randomUUID(),
      host: input.host,
      principalId: input.principalId,
      outcome: input.outcome,
      billed: input.billed,
      createdAt: new Date(input.now ?? Date.now()),
    })
  })
}

/** This calendar month's calls against the instance-wide cap. */
export async function monthUsage(
  now: number = Date.now(),
  opts: { limits?: CaptureLimits } = {}
): Promise<{ used: number; limit: number }> {
  const [row] = await db
    .select({ used: sql<number>`count(*)::int` })
    .from(siteCaptureCalls)
    .where(gte(siteCaptureCalls.createdAt, utcMonthStart(now)))
  return { used: row?.used ?? 0, limit: (opts.limits ?? captureLimits()).instanceMonth }
}
