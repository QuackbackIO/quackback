import { queryOptions } from '@tanstack/react-query'
import { getAnalyticsData } from '@/lib/server/functions/analytics'

export type AnalyticsPeriod = '7d' | '30d' | '90d' | '12m'

export const analyticsQueries = {
  data: (period: AnalyticsPeriod) =>
    queryOptions({
      queryKey: ['analytics', period],
      queryFn: () => getAnalyticsData({ data: { period } }),
      staleTime: 5 * 60 * 1000,
    }),
}
