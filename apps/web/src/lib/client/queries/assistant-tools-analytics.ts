import { queryOptions } from '@tanstack/react-query'
import { getQuinnToolMetricsFn } from '@/lib/server/functions/assistant-tools-analytics'

/** Per-tool action counts (calls/success rate/latency) for a date range (ISO strings). */
export const quinnToolMetricsQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['quinn-tool-metrics', from, to],
    queryFn: () => getQuinnToolMetricsFn({ data: { from, to } }),
    staleTime: 5 * 60 * 1000,
  })
