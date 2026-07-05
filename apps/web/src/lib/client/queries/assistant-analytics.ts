import { queryOptions } from '@tanstack/react-query'
import { getQuinnPerformanceFn } from '@/lib/server/functions/assistant-analytics'

/** Quinn performance (involvement/resolution/escalation) for a date range (ISO strings). */
export const quinnPerformanceQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['quinn-performance', from, to],
    queryFn: () => getQuinnPerformanceFn({ data: { from, to } }),
    staleTime: 5 * 60 * 1000,
  })
