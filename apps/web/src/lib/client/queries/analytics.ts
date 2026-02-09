import { queryOptions } from '@tanstack/react-query'
import { getBriefingDataFn } from '@/lib/server/functions/analytics'

export const analyticsQueries = {
  briefing: (period: '7d' | '30d' | '90d') =>
    queryOptions({
      queryKey: ['admin', 'briefing', period],
      queryFn: () => getBriefingDataFn({ data: { period } }),
      staleTime: 5 * 60 * 1000, // 5 min — aggregate analytics change slowly
    }),
}
