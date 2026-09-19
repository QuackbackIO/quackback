import { queryOptions } from '@tanstack/react-query'
import { getQuinnOperationsFn } from '@/lib/server/functions/assistant-operations-analytics'

/** Quinn's run, action and approval operations for a date range (ISO strings). */
export const quinnOperationsQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['quinn-operations', from, to],
    queryFn: () => getQuinnOperationsFn({ data: { from, to } }),
    staleTime: 5 * 60 * 1000,
  })
