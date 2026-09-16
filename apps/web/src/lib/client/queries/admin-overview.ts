import { queryOptions } from '@tanstack/react-query'
import { fetchAdminOverviewFn } from '@/lib/server/functions/admin-overview'
import type { OverviewScope } from '@/lib/shared/admin-overview'

export const adminOverviewQueries = {
  get: (scope: OverviewScope) =>
    queryOptions({
      queryKey: ['admin', 'overview', scope] as const,
      queryFn: () => fetchAdminOverviewFn({ data: { scope } }),
      staleTime: 30_000,
    }),
}
