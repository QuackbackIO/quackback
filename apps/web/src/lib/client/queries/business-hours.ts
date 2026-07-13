/**
 * Query factory for business-hours admin reads.
 */
import { queryOptions } from '@tanstack/react-query'
import type { BusinessHoursId } from '@quackback/ids'
import { listBusinessHoursFn, getBusinessHoursFn } from '@/lib/server/functions/sla'

export const businessHoursQueries = {
  list: (params: { includeArchived?: boolean } = {}) =>
    queryOptions({
      queryKey: ['business-hours', 'list', params] as const,
      queryFn: () => listBusinessHoursFn({ data: params }),
      staleTime: 30_000,
    }),
  detail: (id: BusinessHoursId) =>
    queryOptions({
      queryKey: ['business-hours', 'detail', id] as const,
      queryFn: () => getBusinessHoursFn({ data: { id } }),
      staleTime: 30_000,
    }),
}
