/**
 * Enqueue a usage snapshot for hosted billing.
 *
 * One stable dedupe key per calendar month. In-flight rows coalesce; a spent
 * row is cancelled first so a later push of the same month is not swallowed.
 */
import { cancelJob, enqueueJob, type JobSqlExecutor } from '@/lib/server/jobs/job-queue'

export const USAGE_REPORT_QUEUE = 'usage-report'
export const USAGE_REPORT_MAX_ATTEMPTS = 10
export const USAGE_REPORT_RETRY_BACKOFF_MS = 15 * 60_000

export function currentUtcMonth(at = new Date()): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`
}

export function previousUtcMonth(at = new Date()): string {
  return currentUtcMonth(new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 1, 1)))
}

export function usageReportDedupeKey(month: string): string {
  return `usage-report:${month}`
}

export async function enqueueUsageReport(opts: {
  month: string
  executor?: JobSqlExecutor
}): Promise<void> {
  const dedupeKey = usageReportDedupeKey(opts.month)
  await cancelJob(USAGE_REPORT_QUEUE, dedupeKey, {
    executor: opts.executor,
    terminalOnly: true,
  })
  await enqueueJob({
    queue: USAGE_REPORT_QUEUE,
    payload: { month: opts.month },
    dedupeKey,
    maxAttempts: USAGE_REPORT_MAX_ATTEMPTS,
    executor: opts.executor,
  })
}
