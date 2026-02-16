/**
 * Inbox query hooks
 *
 * Query hooks for fetching admin inbox posts and post details.
 * Mutations are in lib/mutations/posts.ts and lib/mutations/comments.ts
 */

import { useQuery, useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { fetchInboxPostsForAdmin, fetchPostWithDetails } from '@/lib/server/functions/posts'
import type { InboxFilters, PostDetails } from '@/lib/shared/types'
import type { PostListItem, InboxPostListResult } from '@/lib/shared/db-types'
import type { BoardId, PrincipalId, PostId, TagId } from '@quackback/ids'

// ============================================================================
// Types
// ============================================================================

interface UseInboxPostsOptions {
  filters: InboxFilters
  initialData?: InboxPostListResult
}

interface UsePostDetailOptions {
  postId: PostId | null
  enabled?: boolean
}

// ============================================================================
// Query Key Factory
// ============================================================================

export const inboxKeys = {
  all: ['inbox'] as const,
  lists: () => [...inboxKeys.all, 'list'] as const,
  list: (filters: InboxFilters) => [...inboxKeys.lists(), filters] as const,
  details: () => [...inboxKeys.all, 'detail'] as const,
  detail: (postId: PostId) => [...inboxKeys.details(), postId] as const,
}

// ============================================================================
// Fetch Functions
// ============================================================================

async function fetchInboxPosts(
  filters: InboxFilters,
  cursor?: string
): Promise<InboxPostListResult> {
  return (await fetchInboxPostsForAdmin({
    data: {
      boardIds: filters.board as BoardId[] | undefined,
      statusSlugs: filters.status,
      tagIds: filters.tags as TagId[] | undefined,
      ownerId: (filters.owner || undefined) as PrincipalId | null | undefined,
      search: filters.search,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      minVotes: filters.minVotes,
      responded: filters.responded,
      updatedBefore: filters.updatedBefore,
      sort: filters.sort,
      cursor,
      limit: 20,
    },
  })) as unknown as InboxPostListResult
}

async function fetchPostDetail(postId: PostId): Promise<PostDetails> {
  return (await fetchPostWithDetails({
    data: {
      id: postId,
    },
  })) as unknown as PostDetails
}

// ============================================================================
// Query Hooks
// ============================================================================

export function useInboxPosts({ filters, initialData }: UseInboxPostsOptions) {
  return useInfiniteQuery({
    queryKey: inboxKeys.list(filters),
    queryFn: ({ pageParam }) => fetchInboxPosts(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialData: initialData
      ? {
          pages: [initialData],
          pageParams: [undefined],
        }
      : undefined,
    refetchOnMount: !initialData,
  })
}

export function usePostDetail({ postId, enabled = true }: UsePostDetailOptions) {
  return useQuery({
    queryKey: inboxKeys.detail(postId!),
    queryFn: () => fetchPostDetail(postId!),
    enabled: enabled && !!postId,
    staleTime: 30 * 1000,
  })
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Flatten paginated posts into a single array */
export function flattenInboxPosts(
  data: InfiniteData<InboxPostListResult> | undefined
): PostListItem[] {
  if (!data) return []
  return data.pages.flatMap((page) => page.items)
}
