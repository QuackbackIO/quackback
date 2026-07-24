/**
 * User query hooks
 *
 * Query hooks for fetching portal user data.
 * Mutations are in @/lib/client/mutations/users.
 */

import {
  useQuery,
  useInfiniteQuery,
  infiniteQueryOptions,
  keepPreviousData,
  type InfiniteData,
} from '@tanstack/react-query'
import type { UsersFilters } from '@/lib/shared/types'
import type {
  PortalUserListResultView,
  PortalUserListItemView,
  PortalUserDetail,
} from '@/lib/shared/types'
import type { PrincipalId } from '@quackback/ids'
import { listPortalUsersFn, getPortalUserFn } from '@/lib/server/functions/admin'

// ============================================================================
// Query Key Factory
// ============================================================================

export const usersKeys = {
  all: ['users'] as const,
  lists: () => [...usersKeys.all, 'list'] as const,
  list: (filters: UsersFilters) => [...usersKeys.lists(), filters] as const,
  totalCount: () => [...usersKeys.all, 'totalCount'] as const,
  details: () => [...usersKeys.all, 'detail'] as const,
  detail: (principalId: PrincipalId) => [...usersKeys.details(), principalId] as const,
}

// ============================================================================
// Fetch Functions
// ============================================================================

/** Parse "op:value" format into { op, value } */
function parseActivityFilter(raw?: string) {
  if (!raw) return undefined
  const [op, val] = raw.split(':')
  if (!op || val === undefined) return undefined
  return { op: op as 'gt' | 'gte' | 'lt' | 'lte' | 'eq', value: Number(val) }
}

/** Parse "key:op:value,key2:op:value2" into CustomAttrFilter[] */
function parseCustomAttrs(raw?: string) {
  if (!raw) return undefined
  return raw
    .split(',')
    .map((part) => {
      const [key, op, ...rest] = part.split(':')
      return key && op ? { key, op, value: rest.join(':') } : null
    })
    .filter(Boolean) as { key: string; op: string; value: string }[]
}

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
      emailDomain: filters.emailDomain,
      postCount: parseActivityFilter(filters.postCount),
      voteCount: parseActivityFilter(filters.voteCount),
      commentCount: parseActivityFilter(filters.commentCount),
      customAttrs: parseCustomAttrs(filters.customAttrs),
      sort: filters.sort || 'newest',
      page,
      limit: 20,
      segmentIds: filters.segmentIds,
      // 'companies' swaps the pane to the companies directory; the people
      // query underneath falls back to the default users population.
      lifecycle: filters.lifecycle === 'companies' ? undefined : filters.lifecycle,
    },
  })) as PortalUserListResultView
}

async function fetchUserDetail(principalId: PrincipalId): Promise<PortalUserDetail> {
  return (await getPortalUserFn({ data: { principalId } })) as unknown as PortalUserDetail
}

// ============================================================================
// Shared Query Options (QC-1)
// ============================================================================

/**
 * The default (unfiltered, newest-first) users filter set. The route loader
 * warms the infinite cache with exactly this shape so the renderer's
 * `usePortalUsers` reads the same cache entry on first paint.
 */
export const defaultUsersFilters: UsersFilters = { sort: 'newest' }

/**
 * ONE canonical definition of the portal-users infinite query, shared by the
 * route loader (via `ensureInfiniteQueryData`) and the `usePortalUsers` hook
 * (QC-1). Collapsing the old `adminQueries.portalUsers` route suspense query
 * and this infinite query onto a single `usersKeys` tree means a segment
 * membership change (which invalidates `usersKeys.all`) reaches the cache the
 * Users list actually renders.
 */
export function portalUsersInfiniteOptions(filters: UsersFilters) {
  return infiniteQueryOptions({
    queryKey: usersKeys.list(filters),
    queryFn: ({ pageParam }) => fetchPortalUsers(filters, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length + 1 : undefined),
    // Page number is trivially invertible (page - 1), unlike the keyset
    // cursors elsewhere — admin list, so cap at 5 pages (QC-2).
    getPreviousPageParam: (_firstPage, allPages, firstPageParam) =>
      firstPageParam > 1 ? firstPageParam - 1 : undefined,
    maxPages: 5,
  })
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UsePortalUsersOptions {
  filters: UsersFilters
}

export function usePortalUsers({ filters }: UsePortalUsersOptions) {
  return useInfiniteQuery({
    ...portalUsersInfiniteOptions(filters),
    placeholderData: keepPreviousData,
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

/** Total count (unfiltered) for a lifecycle view's sidebar label. */
export function useTotalUserCount(lifecycle: 'users' | 'leads' = 'users') {
  return useQuery({
    queryKey: [...usersKeys.totalCount(), lifecycle],
    queryFn: async () => {
      const result = (await listPortalUsersFn({
        data: { sort: 'newest', page: 1, limit: 1, lifecycle },
      })) as PortalUserListResultView
      return result.total
    },
    staleTime: 60 * 1000,
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
