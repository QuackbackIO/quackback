/**
 * Enqueue a usage snapshot for hosted billing.
 *
 * One stable dedupe key per calendar month. In-flight and spent rows
 * coalesce, so the hourly catch-up POSTs at most once. Pass `replace: true`
 * to cancel a spent row first when the same month must be reported again.
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
  /** Cancel a spent row first so the same month can be reported again. */
  replace?: boolean
}): Promise<{ inserted: boolean }> {
  const dedupeKey = usageReportDedupeKey(opts.month)
  if (opts.replace) {
    await cancelJob(USAGE_REPORT_QUEUE, dedupeKey, {
      executor: opts.executor,
      terminalOnly: true,
    })
  }
  return enqueueJob({
    queue: USAGE_REPORT_QUEUE,
    payload: { month: opts.month },
    dedupeKey,
    maxAttempts: USAGE_REPORT_MAX_ATTEMPTS,
    executor: opts.executor,
  })
}
