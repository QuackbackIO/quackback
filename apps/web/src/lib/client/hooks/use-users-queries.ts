/**
 * User query hooks
 *
 * Query hooks for fetching portal user data.
 * Mutations are in @/lib/client/mutations/users.
 */

import { useQuery, useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import type { UsersFilters } from '@/lib/shared/types'
import type {
  PortalUserListResultView,
  PortalUserListItemView,
  PortalUserDetail,
} from '@/lib/server/domains/users'
import type { PrincipalId } from '@quackback/ids'
import { listPortalUsersFn, getPortalUserFn } from '@/lib/server/functions/admin'

// ============================================================================
// Query Key Factory
// ============================================================================

export const usersKeys = {
  all: ['users'] as const,
  lists: () => [...usersKeys.all, 'list'] as const,
  list: (filters: UsersFilters) => [...usersKeys.lists(), filters] as const,
  details: () => [...usersKeys.all, 'detail'] as const,
  detail: (principalId: PrincipalId) => [...usersKeys.details(), principalId] as const,
}

// ============================================================================
// Fetch Functions
// ============================================================================

async function fetchPortalUsers(
  filters: UsersFilters,
  page: number
): Promise<PortalUserListResultView> {
  return (await listPortalUsersFn({
    data: {
      search: filters.search,
      verified: filters.verified,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      sort: (filters.sort || 'newest') as 'newest' | 'oldest' | 'most_active',
      page,
      limit: 20,
      segmentIds: filters.segmentIds,
    },
  })) as PortalUserListResultView
}

async function fetchUserDetail(principalId: PrincipalId): Promise<PortalUserDetail> {
  return (await getPortalUserFn({ data: { principalId } })) as unknown as PortalUserDetail
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UsePortalUsersOptions {
  filters: UsersFilters
  initialData?: PortalUserListResultView
}

export function usePortalUsers({ filters, initialData }: UsePortalUsersOptions) {
  // Only use initialData when there are no active filters
  // Otherwise React Query would use stale server-rendered data for filtered queries
  const hasActiveFilters = !!(
    filters.search ||
    filters.verified !== undefined ||
    filters.dateFrom ||
    filters.dateTo ||
    (filters.segmentIds && filters.segmentIds.length > 0)
  )
  const useInitialData = initialData && !hasActiveFilters

  return useInfiniteQuery({
    queryKey: usersKeys.list(filters),
    queryFn: ({ pageParam }) => fetchPortalUsers(filters, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length + 1 : undefined),
    initialData: useInitialData ? { pages: [initialData], pageParams: [1] } : undefined,
    refetchOnMount: !useInitialData,
  })
}

interface UseUserDetailOptions {
  principalId: PrincipalId | null
  enabled?: boolean
}

export function useUserDetail({ principalId, enabled = true }: UseUserDetailOptions) {
  return useQuery({
    queryKey: usersKeys.detail(principalId!),
    queryFn: () => fetchUserDetail(principalId!),
    enabled: enabled && !!principalId,
    staleTime: 30 * 1000,
  })
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Flatten paginated users into a single array */
export function flattenUsers(
  data: InfiniteData<PortalUserListResultView> | undefined
): PortalUserListItemView[] {
  if (!data) return []
  return data.pages.flatMap((page) => page.items)
}
