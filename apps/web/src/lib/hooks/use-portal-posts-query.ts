/**
 * Portal posts query hooks
 *
 * Query hooks for fetching public portal posts, voted posts, and permissions.
 * Mutations are in lib/mutations/portal-posts.ts
 */

import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query'
import {
  listPublicPostsFn,
  getVotedPostsFn,
  getPostPermissionsFn,
} from '@/lib/server-functions/public-posts'
import type { PublicFeedbackFilters } from '@/lib/types'
import type { PublicPostListItem } from '@/lib/posts'
import type { PostId, StatusId, TagId } from '@quackback/ids'

// ============================================================================
// Types
// ============================================================================

interface PublicPostListResult {
  items: PublicPostListItem[]
  total: number
  hasMore: boolean
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

async function fetchPublicPosts(
  filters: PublicFeedbackFilters,
  page: number
): Promise<PublicPostListResult> {
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

  return (await listPublicPostsFn({
    data: {
      boardSlug: filters.board,
      search: filters.search,
      statusIds: statusIds.length > 0 ? (statusIds as StatusId[]) : undefined,
      statusSlugs: statusSlugs.length > 0 ? statusSlugs : undefined,
      tagIds: filters.tagIds as TagId[] | undefined,
      sort: filters.sort || 'top',
      page,
      limit: 20,
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

export function usePublicPosts({ filters, initialData, enabled = true }: UsePublicPostsOptions) {
  return useInfiniteQuery({
    queryKey: publicPostsKeys.list(filters),
    queryFn: ({ pageParam }) => fetchPublicPosts(filters, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length + 1 : undefined),
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
