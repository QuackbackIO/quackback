import { queryOptions } from '@tanstack/react-query'
import type { PostId } from '@quackback/ids'
import {
  fetchSignalSummary,
  fetchSignalCountsForPosts,
  fetchSignalsForPost,
} from '@/lib/server/functions/signals'

/**
 * Query options factory for AI signals.
 */
export const signalQueries = {
  /**
   * Pending signal counts by type (for signal summary bar).
   */
  summary: () =>
    queryOptions({
      queryKey: ['signals', 'summary'],
      queryFn: () => fetchSignalSummary(),
      staleTime: 30 * 1000,
    }),

  /**
   * Signal counts for a batch of post IDs (for L1 badges).
   */
  countsForPosts: (postIds: PostId[]) =>
    queryOptions({
      queryKey: ['signals', 'counts', postIds],
      queryFn: () => fetchSignalCountsForPosts({ data: { postIds } }),
      staleTime: 30 * 1000,
      enabled: postIds.length > 0,
    }),

  /**
   * All pending signals for a single post (for L3 detail panel).
   */
  forPost: (postId: PostId) =>
    queryOptions({
      queryKey: ['signals', 'post', postId],
      queryFn: () => fetchSignalsForPost({ data: { postId } }),
      staleTime: 15 * 1000,
    }),
}
