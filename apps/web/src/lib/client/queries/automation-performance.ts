import type { QueryClient } from '@tanstack/react-query'
import { quinnPerformanceQuery } from '@/lib/client/queries/assistant-analytics'
import { quinnToolMetricsQuery } from '@/lib/client/queries/assistant-tools-analytics'
import { copilotUsageMetricsQuery } from '@/lib/client/queries/assistant-copilot-analytics'
import { supportReportingQuery } from '@/lib/client/queries/support-reporting'

export interface DateRange {
  from: string
  to: string
}

/** The rolling 30-day window ending at `now`, as ISO strings. */
export function last30DaysRange(now: Date = new Date()): DateRange {
  const from = new Date(now.getTime() - 30 * 86_400_000)
  return { from: from.toISOString(), to: now.toISOString() }
}

/**
 * Warm the AI performance page's cards for one date range, for its route
 * loader. The range is part of every card's query key, so the loader hands
 * the same range to the cards. Each read is best-effort: a failed one is
 * left to its card's own query.
 */
export function warmAutomationPerformance(queryClient: QueryClient, range: DateRange) {
  const warm = (p: Promise<unknown>) => p.catch(() => undefined)
  return Promise.all([
    warm(queryClient.ensureQueryData(quinnPerformanceQuery(range.from, range.to))),
    warm(queryClient.ensureQueryData(quinnToolMetricsQuery(range.from, range.to))),
    warm(queryClient.ensureQueryData(copilotUsageMetricsQuery(range.from, range.to))),
    warm(queryClient.ensureQueryData(supportReportingQuery(range.from, range.to))),
  ])
}
