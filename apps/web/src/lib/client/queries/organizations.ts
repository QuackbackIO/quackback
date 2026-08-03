/**
 * Organization queries — list (with search) + detail.
 */
import { queryOptions } from '@tanstack/react-query'
import type { OrganizationId } from '@quackback/ids'
import { listOrganizationsFn, getOrganizationFn } from '@/lib/server/functions/organizations'

const STALE = 30_000

export const organizationQueries = {
  all: ['organizations'] as const,
  list: (filters: { search?: string; includeArchived?: boolean } = {}) =>
    queryOptions({
      queryKey: ['organizations', 'list', filters] as const,
      queryFn: () =>
        listOrganizationsFn({
          data: {
            search: filters.search?.trim() || undefined,
            includeArchived: filters.includeArchived,
            limit: 200,
          },
        }),
      staleTime: STALE,
    }),
  detail: (organizationId: OrganizationId) =>
    queryOptions({
      queryKey: ['organizations', 'detail', organizationId] as const,
      queryFn: () => getOrganizationFn({ data: { organizationId } }),
      staleTime: STALE,
    }),
}
