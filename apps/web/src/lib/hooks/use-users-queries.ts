import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import type { UsersFilters } from '@/components/admin/users/use-users-filters'
import type { PortalUserListResult, PortalUserListItem, PortalUserDetail } from '@/lib/users'
import type { MemberId } from '@quackback/ids'
import {
  listPortalUsersFn,
  getPortalUserFn,
  deletePortalUserFn,
} from '@/lib/server-functions/admin'

// ============================================================================
// Query Key Factory
// ============================================================================

export const usersKeys = {
  all: ['users'] as const,
  lists: () => [...usersKeys.all, 'list'] as const,
  list: (filters: UsersFilters) => [...usersKeys.lists(), filters] as const,
  details: () => [...usersKeys.all, 'detail'] as const,
  detail: (memberId: MemberId) => [...usersKeys.details(), memberId] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UsePortalUsersOptions {
  filters: UsersFilters
  initialData?: PortalUserListResult
}

export function usePortalUsers({ filters, initialData }: UsePortalUsersOptions) {
  // Only use initialData when there are no active filters
  // Otherwise React Query would use stale server-rendered data for filtered queries
  const hasActiveFilters = !!(
    filters.search ||
    filters.verified !== undefined ||
    filters.dateFrom ||
    filters.dateTo
  )
  const useInitialData = initialData && !hasActiveFilters

  return useInfiniteQuery({
    queryKey: usersKeys.list(filters),
    queryFn: async ({ pageParam }): Promise<PortalUserListResult> => {
      return (await listPortalUsersFn({
        data: {
          search: filters.search,
          verified: filters.verified,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          sort: (filters.sort || 'newest') as 'newest' | 'oldest' | 'most_active',
          page: pageParam,
          limit: 20,
        },
      })) as unknown as PortalUserListResult
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length + 1 : undefined),
    initialData: useInitialData
      ? {
          pages: [initialData],
          pageParams: [1],
        }
      : undefined,
    refetchOnMount: !useInitialData,
  })
}

// Helper to flatten paginated users into a single array
export function flattenUsers(
  data: InfiniteData<PortalUserListResult> | undefined
): PortalUserListItem[] {
  if (!data) return []
  return data.pages.flatMap((page) => page.items)
}

interface UseUserDetailOptions {
  memberId: MemberId | null
  enabled?: boolean
}

export function useUserDetail({ memberId, enabled = true }: UseUserDetailOptions) {
  return useQuery({
    queryKey: usersKeys.detail(memberId!),
    queryFn: async (): Promise<PortalUserDetail> => {
      return (await getPortalUserFn({
        data: {
          memberId: memberId!,
        },
      })) as unknown as PortalUserDetail
    },
    enabled: enabled && !!memberId,
    staleTime: 30 * 1000,
  })
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to remove a portal user from an organization.
 * This deletes their member record and org-scoped user account.
 */
export function useRemovePortalUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (memberId: MemberId) => {
      return await deletePortalUserFn({
        data: {
          memberId,
        },
      })
    },
    onMutate: async (memberId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: usersKeys.lists() })

      // Snapshot previous state
      const previousLists = queryClient.getQueriesData<InfiniteData<PortalUserListResult>>({
        queryKey: usersKeys.lists(),
      })

      // Optimistically remove from list caches
      queryClient.setQueriesData<InfiniteData<PortalUserListResult>>(
        { queryKey: usersKeys.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.filter((user) => user.memberId !== memberId),
              total: page.total - 1,
            })),
          }
        }
      )

      return { previousLists }
    },
    onError: (_err, _memberId, context) => {
      // Rollback on error
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          if (data) {
            queryClient.setQueryData(queryKey, data)
          }
        }
      }
    },
    onSettled: () => {
      // Refetch lists to ensure consistency
      queryClient.invalidateQueries({ queryKey: usersKeys.lists() })
    },
  })
}
