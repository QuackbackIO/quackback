import { queryOptions } from '@tanstack/react-query'
import type { PostId } from '@quackback/ids'
import {
  getMergeSuggestionsForPostFn,
  fetchMergeSuggestionSummaryFn,
  fetchMergeSuggestionCountsForPostsFn,
} from '@/lib/server/functions/merge-suggestions'

/**
 * Query options factory for merge suggestions.
 *
 * All query keys are under ['merge-suggestions', ...] to allow
 * bulk invalidation after merge/dismiss actions.
 */
export const mergeSuggestionQueries = {
  /**
   * Total pending merge suggestion count (for summary bar).
   */
  summary: () =>
    queryOptions({
      queryKey: ['merge-suggestions', 'summary'],
      queryFn: () => fetchMergeSuggestionSummaryFn(),
      staleTime: 30 * 1000,
    }),

  /**
   * Per-post merge suggestion counts (for inbox badges).
   */
  countsForPosts: (postIds: PostId[]) =>
    queryOptions({
      queryKey: ['merge-suggestions', 'counts', postIds],
      queryFn: () => fetchMergeSuggestionCountsForPostsFn({ data: { postIds } }),
      staleTime: 30 * 1000,
      enabled: postIds.length > 0,
    }),

  /**
   * Pending merge suggestions for a single post (for detail card).
   */
  forPost: (postId: PostId) =>
    queryOptions({
      queryKey: ['merge-suggestions', 'post', postId],
      queryFn: () => getMergeSuggestionsForPostFn({ data: { postId } }),
      staleTime: 30 * 1000,
    }),
}
