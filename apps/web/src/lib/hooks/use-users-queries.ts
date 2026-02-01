import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import type { UsersFilters } from '@/lib/types'
import type {
  PortalUserListResultView,
  PortalUserListItemView,
  PortalUserDetail,
} from '@/lib/users'
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
    },
  })) as PortalUserListResultView
}

async function fetchUserDetail(memberId: MemberId): Promise<PortalUserDetail> {
  return (await getPortalUserFn({ data: { memberId } })) as unknown as PortalUserDetail
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
    filters.dateTo
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
  memberId: MemberId | null
  enabled?: boolean
}

export function useUserDetail({ memberId, enabled = true }: UseUserDetailOptions) {
  return useQuery({
    queryKey: usersKeys.detail(memberId!),
    queryFn: () => fetchUserDetail(memberId!),
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
    mutationFn: (memberId: MemberId) => deletePortalUserFn({ data: { memberId } }),
    onMutate: async (memberId) => {
      await queryClient.cancelQueries({ queryKey: usersKeys.lists() })

      const previousLists = queryClient.getQueriesData<InfiniteData<PortalUserListResultView>>({
        queryKey: usersKeys.lists(),
      })

      // Optimistically remove from list caches
      queryClient.setQueriesData<InfiniteData<PortalUserListResultView>>(
        { queryKey: usersKeys.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.filter(
                (user: PortalUserListItemView) => user.memberId !== memberId
              ),
              total: page.total - 1,
            })),
          }
        }
      )

      return { previousLists }
    },
    onError: (_err, _memberId, context) => {
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          if (data) {
            queryClient.setQueryData(queryKey, data)
          }
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: usersKeys.lists() })
    },
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
