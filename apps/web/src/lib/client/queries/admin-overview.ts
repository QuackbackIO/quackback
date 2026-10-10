import { queryOptions } from '@tanstack/react-query'
import { fetchAdminOverviewFn } from '@/lib/server/functions/admin-overview'

export const adminOverviewQueries = {
  get: () =>
    queryOptions({
      queryKey: ['admin', 'overview'] as const,
      queryFn: () => fetchAdminOverviewFn(),
      staleTime: 30_000,
    }),
}
