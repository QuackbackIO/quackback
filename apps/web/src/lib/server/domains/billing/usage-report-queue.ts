/**
 * Push a monthly usage snapshot to hosted billing.
 *
 * Self-host with no hosted URL: successful no-op, not a retry. Hourly cron
 * slots coalesce onto a per-month key; the handler reports previousUtcMonth()
 * of now (UTC) rather than the local scheduledFor wall time.
 */
import { isNull, sql } from 'drizzle-orm'
import { db, posts, boards } from '@/lib/server/db'
import { reportWorkspaceUsage } from '@/lib/server/control-plane/client'
import { aiTokensInUtcMonth } from '@/lib/server/domains/ai/usage-counter'
import { emailsSentInUtcMonth } from '@/lib/server/email/email-budget'
import { countSeatUsage } from '@/lib/server/domains/principals/seat-usage'
import { logger } from '@/lib/server/logger'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { TerminalJobError } from '@/lib/server/jobs/definitions'
import { enqueueUsageReport, previousUtcMonth, usageReportDedupeKey } from './usage-report'

const log = logger.child({ component: 'usage-report' })

export function isHostedBillingConfigured(): boolean {
  const raw = process.env.QUACKBACK_CONTROL_PLANE_URL
  return typeof raw === 'string' && raw.length > 0
}

const MONTH_RE = /^\d{4}-\d{2}$/

export function monthFromJob(job: ClaimedJob, now = new Date()): string {
  const raw = job.payload?.month
  if (typeof raw === 'string' && MONTH_RE.test(raw)) return raw
  return previousUtcMonth(now)
}

export function dateForUtcMonth(month: string): Date {
  const [year, mon] = month.split('-').map(Number)
  return new Date(Date.UTC(year, mon - 1, 1))
}

export async function runUsageReport(job: ClaimedJob): Promise<void> {
  if (!isHostedBillingConfigured()) {
    log.debug('usage-report skipped: hosted billing is not configured')
    return
  }
  const month = monthFromJob(job)
  if (!MONTH_RE.test(month)) {
    throw new TerminalJobError(`invalid usage-report month: ${month}`)
  }
  const monthKey = usageReportDedupeKey(month)
  if (job.dedupeKey !== monthKey) {
    await enqueueUsageReport({ month })
    return
  }
  const at = dateForUtcMonth(month)
  const [aiTokens, emailsSent, seats, postRow, boardRow] = await Promise.all([
    aiTokensInUtcMonth(at),
    emailsSentInUtcMonth(at),
    countSeatUsage(),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(posts)
      .where(isNull(posts.deletedAt)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(boards)
      .where(isNull(boards.deletedAt)),
  ])
  await reportWorkspaceUsage({
    month,
    aiTokens,
    emailsSent,
    teamSeatCount: seats.members,
    pendingInviteCount: seats.pendingInvites,
    postCount: postRow[0]?.count ?? 0,
    boardCount: boardRow[0]?.count ?? 0,
  })
}
