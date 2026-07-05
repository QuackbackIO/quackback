import { queryOptions } from '@tanstack/react-query'
import {
  getQuinnToolMetricsFn,
  getConnectorHealthFn,
} from '@/lib/server/functions/assistant-tools-analytics'

/** Per-tool action counts (calls/success rate/latency) for a date range (ISO strings). */
export const quinnToolMetricsQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['quinn-tool-metrics', from, to],
    queryFn: () => getQuinnToolMetricsFn({ data: { from, to } }),
    staleTime: 5 * 60 * 1000,
  })

/** Connector health (enabled/status/failureCount/lastError + derived tier). */
export const connectorHealthQuery = () =>
  queryOptions({
    queryKey: ['connector-health'],
    queryFn: () => getConnectorHealthFn(),
    staleTime: 5 * 60 * 1000,
  })
