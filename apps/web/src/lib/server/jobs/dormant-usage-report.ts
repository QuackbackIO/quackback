/**
 * Monthly usage reports for workspaces the worker has parked.
 *
 * The usage report is a cron job (`usage-report`, hourly at :10) that sends
 * the previous month's usage to hosted billing once per month. Cron jobs are
 * enqueued by a workspace's job loop, and a dormant workspace has no loop
 * (`activity.ts`), so a workspace nobody visited across a month boundary never
 * sent that month's report. The control plane then showed its usage from
 * whatever month it last reported. In production, every workspace created in
 * late August and idle since had no August report.
 *
 * So once a month, the worker asks each parked workspace to queue the previous
 * month's report. Queueing uses the report's own dedupe key, so a workspace
 * that already reported the month (its spent row is kept for 45 days) queues
 * nothing and stays parked. One that has not gets the job, and is woken the
 * way a job-wake wakes it: its loop starts, runs the job, and parks again at
 * a later refresh once the queue is empty.
 *
 * Cost: one workspace scope per parked workspace per month per worker
 * process. A workspace whose scope cannot be opened is retried at most hourly.
 */

import { previousUtcMonth } from '@/lib/server/domains/billing/usage-report'

export const DORMANT_REPORT_RETRY_MS = 60 * 60_000

export interface DormantUsageReportDeps {
  /** Hosted billing is configured (self-host reports nothing). */
  hosted: () => boolean
  now: () => Date
  /** Workspaces currently parked. */
  dormant: () => readonly string[]
  /** Queue the report for `month` inside the workspace's scope. */
  enqueueIn: (workspaceKey: string, month: string) => Promise<{ inserted: boolean }>
  /** Start the workspace's job loop so the queued report runs. */
  wake: (workspaceKey: string) => Promise<void>
  warn: (fields: Record<string, unknown>, message: string) => void
}

interface Checked {
  month: string
  /** Set after a failure: when to try again. Absent once the month is settled. */
  retryAt?: number
}

const checked = new Map<string, Checked>()

/** Tests only. */
export function resetDormantUsageReportState(): void {
  checked.clear()
}

export async function catchUpDormantUsageReports(
  d: DormantUsageReportDeps
): Promise<{ queued: number; checked: number }> {
  if (!d.hosted()) return { queued: 0, checked: 0 }
  const now = d.now()
  const month = previousUtcMonth(now)
  const parked = new Set(d.dormant())
  // Forget workspaces that are no longer parked; a later park starts fresh.
  for (const key of checked.keys()) if (!parked.has(key)) checked.delete(key)

  let queued = 0
  let asked = 0
  for (const key of parked) {
    const prior = checked.get(key)
    if (prior?.month === month && (prior.retryAt === undefined || now.getTime() < prior.retryAt))
      continue
    asked += 1
    try {
      const { inserted } = await d.enqueueIn(key, month)
      checked.set(key, { month })
      if (inserted) {
        queued += 1
        await d.wake(key)
      }
    } catch (err) {
      checked.set(key, { month, retryAt: now.getTime() + DORMANT_REPORT_RETRY_MS })
      d.warn(
        { err, workspace_key: key, month },
        'could not queue the monthly usage report for a dormant workspace; retrying later'
      )
    }
  }
  return { queued, checked: asked }
}
