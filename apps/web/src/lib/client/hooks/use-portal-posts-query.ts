/**
 * Portal posts query hooks
 *
 * Query hooks for fetching public portal posts, voted posts, and permissions.
 * Mutations are in lib/mutations/portal-posts.ts
 */

import { useRef } from 'react'
import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query'
import {
  listPublicPostsFn,
  getVotedPostsFn,
  getPostPermissionsFn,
} from '@/lib/server/functions/public-posts'
import type { PublicFeedbackFilters } from '@/lib/shared/types'
import type { PublicPostFacetCounts } from '@/lib/shared/types/filters'
import type { PublicPostListItem } from '@/lib/shared/types'
import type { PostId, PostStatusId, PostTagId } from '@quackback/ids'

// ============================================================================
// Types
// ============================================================================

interface PublicPostListResult {
  items: PublicPostListItem[]
  total?: number
  hasMore: boolean
  /** Filter panel counts; the portal's first page carries them. */
  facets?: PublicPostFacetCounts
}

interface PostPermissions {
  canEdit: boolean
  canDelete: boolean
  editReason?: string
  deleteReason?: string
}

interface UsePublicPostsOptions {
  filters: PublicFeedbackFilters
  initialData?: PublicPostListResult
  enabled?: boolean
  /** Who is viewing; counts are only reused for the same viewer. */
  viewerKey?: string
}

interface UseVotedPostsOptions {
  initialVotedIds: string[]
  enabled?: boolean
}

interface UsePostPermissionsOptions {
  postId: PostId
  enabled?: boolean
}

// ============================================================================
// Query Key Factories
// ============================================================================

export const publicPostsKeys = {
  all: ['publicPosts'] as const,
  lists: () => [...publicPostsKeys.all, 'list'] as const,
  list: (filters: PublicFeedbackFilters) => [...publicPostsKeys.lists(), filters] as const,
}

export const votedPostsKeys = {
  all: ['votedPosts'] as const,
  byWorkspace: () => [...votedPostsKeys.all] as const,
}

export const postPermissionsKeys = {
  all: ['postPermissions'] as const,
  detail: (postId: PostId) => [...postPermissionsKeys.all, postId] as const,
}

// ============================================================================
// Fetch Functions
// ============================================================================

/** The filter inputs the feed list and its panel counts share. */
function feedFilterInput(filters: PublicFeedbackFilters) {
  // Parse status filters - can be TypeIDs or slugs
  const statusIds: string[] = []
  const statusSlugs: string[] = []
  for (const s of filters.status || []) {
    if (s.startsWith('status_')) {
      statusIds.push(s)
    } else {
      statusSlugs.push(s)
    }
  }
  return {
    boardSlug: filters.board,
    search: filters.search,
    statusIds: statusIds.length > 0 ? (statusIds as PostStatusId[]) : undefined,
    statusSlugs: statusSlugs.length > 0 ? statusSlugs : undefined,
    tagIds: filters.tagIds as PostTagId[] | undefined,
    minVotes: filters.minVotes,
    dateFrom: filters.dateFrom,
    responded: filters.responded,
    owner: filters.owner,
    segmentIds: filters.segmentIds,
    view: filters.view,
  }
}

async function fetchPublicPosts(
  filters: PublicFeedbackFilters,
  page: number,
  withFacets = true
): Promise<PublicPostListResult> {
  return (await listPublicPostsFn({
    data: {
      ...feedFilterInput(filters),
      sort: filters.sort || 'top',
      page,
      limit: 20,
      ...(!withFacets && { facets: false }),
    },
  })) as unknown as PublicPostListResult
}

export async function fetchVotedPosts(): Promise<Set<string>> {
  const result = await getVotedPostsFn()
  return new Set(result.votedPostIds)
}

// ============================================================================
// Query Hooks
// ============================================================================

export function usePublicPosts({
  filters,
  initialData,
  enabled = true,
  viewerKey = '',
}: UsePublicPostsOptions) {
  // The panel counts don't depend on the sort, so a sort change reuses the
  // last counts instead of recounting. Any other refetch (a filter change, or
  // a vote invalidating the feed) counts again.
  const lastCounts = useRef<{ key: string; sort?: string; facets: PublicPostFacetCounts }>(
    initialData?.facets && {
      key: JSON.stringify([viewerKey, feedFilterInput(filters)]),
      sort: filters.sort,
      facets: initialData.facets,
    }
  )

  async function fetchPage(page: number): Promise<PublicPostListResult> {
    if (page !== 1) return fetchPublicPosts(filters, page)
    const key = JSON.stringify([viewerKey, feedFilterInput(filters)])
    const last = lastCounts.current
    if (last?.key === key && last.sort !== filters.sort) {
      last.sort = filters.sort
      return { ...(await fetchPublicPosts(filters, page, false)), facets: last.facets }
    }
    const result = await fetchPublicPosts(filters, page)
    if (result.facets) lastCounts.current = { key, sort: filters.sort, facets: result.facets }
    return result
  }

  return useInfiniteQuery({
    queryKey: publicPostsKeys.list(filters),
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length + 1 : undefined),
    // Page number inverts trivially (page - 1) — visitor-facing feed, so the
    // wider scroll-back cap (QC-2).
    getPreviousPageParam: (_firstPage, _allPages, firstPageParam) =>
      firstPageParam > 1 ? firstPageParam - 1 : undefined,
    maxPages: 8,
    initialData: initialData
      ? {
          pages: [initialData],
          pageParams: [1],
        }
      : undefined,
    // Keep showing previous data while loading new filter results
    placeholderData: (previousData) => previousData,
    enabled,
  })
}

/**
 * Hook to track which posts the user has voted on.
 * Uses TanStack Query as single source of truth - no local state.
 * Optimistic updates handled by useVoteMutation's onMutate.
 */
export function useVotedPosts({ initialVotedIds, enabled = true }: UseVotedPostsOptions) {
  const { data: votedIds, refetch } = useQuery({
    queryKey: votedPostsKeys.byWorkspace(),
    queryFn: fetchVotedPosts,
    initialData: new Set(initialVotedIds),
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled,
  })

  return {
    hasVoted: (postId: string) => votedIds?.has(postId) ?? false,
    refetchVotedPosts: refetch,
  }
}

/**
 * Hook to get edit/delete permissions for a post.
 */
export function usePostPermissions({ postId, enabled = true }: UsePostPermissionsOptions) {
  return useQuery({
    queryKey: postPermissionsKeys.detail(postId),
    queryFn: (): Promise<PostPermissions> => getPostPermissionsFn({ data: { postId } }),
    enabled,
    staleTime: 30 * 1000, // 30 seconds
  })
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Flatten paginated posts into a single array */
export function flattenPublicPosts(
  data: InfiniteData<PublicPostListResult> | undefined
): PublicPostListItem[] {
  if (!data) return []
  return data.pages.flatMap((page) => page.items)
}
