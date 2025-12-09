'use client'

import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import type { UsersFilters } from '@/app/(tenant)/admin/users/use-users-filters'
import type { PortalUserListResult, PortalUserListItem, PortalUserDetail } from '@quackback/domain'

// ============================================================================
// Query Key Factory
// ============================================================================

export const usersKeys = {
  all: ['users'] as const,
  lists: () => [...usersKeys.all, 'list'] as const,
  list: (organizationId: string, filters: UsersFilters) =>
    [...usersKeys.lists(), organizationId, filters] as const,
  details: () => [...usersKeys.all, 'detail'] as const,
  detail: (memberId: string, organizationId: string) =>
    [...usersKeys.details(), memberId, organizationId] as const,
}

// ============================================================================
// Fetch Functions
// ============================================================================

async function fetchUsers(
  organizationId: string,
  filters: UsersFilters,
  page: number
): Promise<PortalUserListResult> {
  const params = new URLSearchParams()
  params.set('organizationId', organizationId)
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

async function fetchUserDetail(
  memberId: string,
  organizationId: string
): Promise<PortalUserDetail> {
  const response = await fetch(`/api/admin/users/${memberId}?organizationId=${organizationId}`)
  if (!response.ok) throw new Error('Failed to fetch user')
  return response.json()
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UsePortalUsersOptions {
  organizationId: string
  filters: UsersFilters
  initialData?: PortalUserListResult
}

export function usePortalUsers({ organizationId, filters, initialData }: UsePortalUsersOptions) {
  return useInfiniteQuery({
    queryKey: usersKeys.list(organizationId, filters),
    queryFn: ({ pageParam }) => fetchUsers(organizationId, filters, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length + 1 : undefined),
    initialData: initialData
      ? {
          pages: [initialData],
          pageParams: [1],
        }
      : undefined,
    refetchOnMount: !initialData,
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
  organizationId: string
  enabled?: boolean
}

export function useUserDetail({ memberId, organizationId, enabled = true }: UseUserDetailOptions) {
  return useQuery({
    queryKey: usersKeys.detail(memberId!, organizationId),
    queryFn: () => fetchUserDetail(memberId!, organizationId),
    enabled: enabled && !!memberId,
    staleTime: 30 * 1000,
  })
}

// ============================================================================
// Mutation Hooks
// ============================================================================

interface UpdateRoleInput {
  memberId: string
  role: string
}

export function useUpdateMemberRole(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ memberId, role }: UpdateRoleInput) => {
      const response = await fetch(`/api/admin/users/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, organizationId }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update role')
      }
      return response.json()
    },
    onMutate: async ({ memberId, role }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: usersKeys.detail(memberId, organizationId) })
      await queryClient.cancelQueries({ queryKey: usersKeys.lists() })

      // Snapshot previous state
      const previousDetail = queryClient.getQueryData<PortalUserDetail>(
        usersKeys.detail(memberId, organizationId)
      )
      const previousLists = queryClient.getQueriesData<InfiniteData<PortalUserListResult>>({
        queryKey: usersKeys.lists(),
      })

      // Optimistically update detail
      if (previousDetail) {
        queryClient.setQueryData<PortalUserDetail>(usersKeys.detail(memberId, organizationId), {
          ...previousDetail,
          role,
        })
      }

      // Optimistically update list caches
      queryClient.setQueriesData<InfiniteData<PortalUserListResult>>(
        { queryKey: usersKeys.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((user) =>
                user.memberId === memberId ? { ...user, role } : user
              ),
            })),
          }
        }
      )

      return { previousDetail, previousLists }
    },
    onError: (_err, { memberId }, context) => {
      // Rollback on error
      if (context?.previousDetail) {
        queryClient.setQueryData(usersKeys.detail(memberId, organizationId), context.previousDetail)
      }
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          if (data) {
            queryClient.setQueryData(queryKey, data)
          }
        }
      }
    },
    onSettled: (_data, _error, { memberId }) => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: usersKeys.detail(memberId, organizationId) })
      // If role changed from 'user', they should disappear from portal users list
      queryClient.invalidateQueries({ queryKey: usersKeys.lists() })
    },
  })
}

export function useRemoveMember(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (memberId: string) => {
      const response = await fetch(
        `/api/admin/users/${memberId}?organizationId=${organizationId}`,
        { method: 'DELETE' }
      )
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to remove member')
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
