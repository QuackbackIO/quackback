import { queryOptions } from '@tanstack/react-query'
import { getAnalyticsData } from '@/lib/server/functions/analytics'
import { getVisitorAnalyticsData } from '@/lib/server/functions/visitor-analytics'

export type AnalyticsPeriod = '7d' | '30d' | '90d' | '12m'
export interface DateRange {
  from: string
  to: string
}

const PERIOD_DAYS: Record<AnalyticsPeriod, number> = { '7d': 7, '30d': 30, '90d': 90, '12m': 365 }

/** The rolling window a period names, ending at `now`, as ISO strings. */
export function periodRange(period: AnalyticsPeriod, now: Date = new Date()): DateRange {
  const from = new Date(now.getTime() - PERIOD_DAYS[period] * 86_400_000)
  return { from: from.toISOString(), to: now.toISOString() }
}

export type VisitorSurface = 'all' | 'portal' | 'widget'

export const analyticsQueries = {
  data: (period: AnalyticsPeriod) =>
    queryOptions({
      queryKey: ['analytics', period],
      queryFn: () => getAnalyticsData({ data: { period } }),
      staleTime: 5 * 60 * 1000,
    }),
  visitors: (period: AnalyticsPeriod, surface: VisitorSurface) =>
    queryOptions({
      queryKey: ['analytics', 'visitors', period, surface],
      queryFn: () => getVisitorAnalyticsData({ data: { period, surface } }),
      staleTime: 5 * 60 * 1000,
    }),
}
