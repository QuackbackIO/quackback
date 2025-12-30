import { queryOptions } from '@tanstack/react-query'
import type { PostId, MemberId } from '@quackback/ids'
import {
  fetchPublicBoards,
  fetchPublicPosts,
  fetchPublicStatuses,
  fetchPublicTags,
  fetchVotedPosts,
  fetchAvatars,
} from '@/lib/server-functions/portal'

/**
 * Query options factory for portal/public routes.
 * Uses server functions (createServerFn) to keep database code server-only.
 * These are used with ensureQueryData() in loaders and useSuspenseQuery() in components.
 */
export const portalQueries = {
  /**
   * List all public boards with post counts
   */
  boards: () =>
    queryOptions({
      queryKey: ['portal', 'boards'],
      queryFn: () => fetchPublicBoards(),
    }),

  /**
   * List posts for a board with filtering
   */
  posts: (filters: { boardSlug?: string; search?: string; sort: 'top' | 'new' | 'trending' }) =>
    queryOptions({
      queryKey: ['portal', 'posts', filters],
      queryFn: () => fetchPublicPosts({ data: filters }),
    }),

  /**
   * List all public statuses
   */
  statuses: () =>
    queryOptions({
      queryKey: ['portal', 'statuses'],
      queryFn: () => fetchPublicStatuses(),
    }),

  /**
   * List all public tags
   */
  tags: () =>
    queryOptions({
      queryKey: ['portal', 'tags'],
      queryFn: () => fetchPublicTags(),
    }),

  /**
   * Get which posts the user has voted on
   */
  votedPosts: (postIds: PostId[], userIdentifier: string) =>
    queryOptions({
      queryKey: ['portal', 'votedPosts', userIdentifier],
      queryFn: () => fetchVotedPosts({ data: { postIds, userIdentifier } }),
      // Don't cache voted posts too long - user might vote from another device
      staleTime: 30 * 1000, // 30 seconds
    }),

  /**
   * Get bulk avatar data for post authors
   */
  avatars: (memberIds: MemberId[]) =>
    queryOptions({
      queryKey: ['portal', 'avatars', memberIds],
      queryFn: () => fetchAvatars({ data: memberIds }),
      // Avatars don't change often
      staleTime: 5 * 60 * 1000, // 5 minutes
    }),
}
