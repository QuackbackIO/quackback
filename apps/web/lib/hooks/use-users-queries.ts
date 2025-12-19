'use client'

import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import type { UsersFilters } from '@/app/s/[orgSlug]/admin/users/use-users-filters'
import type { PortalUserListResult, PortalUserListItem, PortalUserDetail } from '@quackback/domain'

// ============================================================================
// Query Key Factory
// ============================================================================

export const usersKeys = {
  all: ['users'] as const,
  lists: () => [...usersKeys.all, 'list'] as const,
  list: (workspaceId: string, filters: UsersFilters) =>
    [...usersKeys.lists(), workspaceId, filters] as const,
  details: () => [...usersKeys.all, 'detail'] as const,
  detail: (memberId: string, workspaceId: string) =>
    [...usersKeys.details(), memberId, workspaceId] as const,
}

// ============================================================================
// Fetch Functions
// ============================================================================

async function fetchUsers(
  workspaceId: string,
  filters: UsersFilters,
  page: number
): Promise<PortalUserListResult> {
  const params = new URLSearchParams()
  params.set('workspaceId', workspaceId)
  params.set('page', page.toString())

  if (filters.search) params.set('search', filters.search)
  if (filters.verified !== undefined) params.set('verified', String(filters.verified))
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  if (filters.sort) params.set('sort', filters.sort)

  const response = await fetch(`/api/admin/users?${params.toString()}`)
  if (!response.ok) throw new Error('Failed to fetch users')
  return response.json()
}

async function fetchUserDetail(memberId: string, workspaceId: string): Promise<PortalUserDetail> {
  const response = await fetch(`/api/admin/users/${memberId}?workspaceId=${workspaceId}`)
  if (!response.ok) throw new Error('Failed to fetch user')
  return response.json()
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UsePortalUsersOptions {
  workspaceId: string
  filters: UsersFilters
  initialData?: PortalUserListResult
}

export function usePortalUsers({ workspaceId, filters, initialData }: UsePortalUsersOptions) {
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
    queryKey: usersKeys.list(workspaceId, filters),
    queryFn: ({ pageParam }) => fetchUsers(workspaceId, filters, pageParam),
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
  memberId: string | null
  workspaceId: string
  enabled?: boolean
}

export function useUserDetail({ memberId, workspaceId, enabled = true }: UseUserDetailOptions) {
  return useQuery({
    queryKey: usersKeys.detail(memberId!, workspaceId),
    queryFn: () => fetchUserDetail(memberId!, workspaceId),
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
export function useRemovePortalUser(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (memberId: string) => {
      const response = await fetch(`/api/admin/users/${memberId}?workspaceId=${workspaceId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to remove portal user')
      }
      return response.json()
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
