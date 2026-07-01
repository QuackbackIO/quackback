import { queryOptions } from '@tanstack/react-query'
import { getAnalyticsData } from '@/lib/server/functions/analytics'
import { getVisitorAnalyticsData } from '@/lib/server/functions/visitor-analytics'

export type AnalyticsPeriod = '7d' | '30d' | '90d' | '12m'
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
