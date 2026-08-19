import { queryOptions } from '@tanstack/react-query'
import { getCopilotUsageMetricsFn } from '@/lib/server/functions/assistant-copilot-analytics'

/** Copilot usage + outcome metrics for a date range (ISO strings). */
export const copilotUsageMetricsQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['copilot-usage-metrics', from, to],
    queryFn: () => getCopilotUsageMetricsFn({ data: { from, to } }),
    staleTime: 5 * 60 * 1000,
  })
