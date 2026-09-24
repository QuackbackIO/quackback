import type { QueryClient } from '@tanstack/react-query'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { adminQueries } from '@/lib/client/queries/admin'
import { fetchVotedPosts, votedPostsKeys } from '@/lib/client/hooks/use-portal-posts-query'
import {
  defaultInboxFilters,
  inboxFacetCountsOptions,
  inboxPostsInfiniteOptions,
} from '@/lib/client/hooks/use-inbox-query'
import { mergeSuggestionQueries } from '@/lib/client/queries/signals'

/**
 * Warm what the admin feedback page renders on first paint, for its route
 * loader. The posts list only ever warms the unfiltered dataset: a filtered
 * URL on first load falls through to the page's own client fetch.
 */
export function warmFeedbackPage(queryClient: QueryClient, permissions: readonly PermissionKey[]) {
  return Promise.all([
    queryClient.ensureInfiniteQueryData(inboxPostsInfiniteOptions(defaultInboxFilters)),
    queryClient.ensureQueryData(inboxFacetCountsOptions(defaultInboxFilters)),
    queryClient.ensureQueryData(adminQueries.boards()),
    queryClient.ensureQueryData(adminQueries.tags()),
    queryClient.ensureQueryData(adminQueries.statuses()),
    queryClient.ensureQueryData(adminQueries.teamMembers()),
    queryClient.ensureQueryData(mergeSuggestionQueries.summary()),
    // Warm the moderation count so the pending-moderation banner renders on
    // first paint instead of popping in once the query resolves.
    queryClient.ensureQueryData(adminQueries.moderationStatus()),
    // The segment filter, which listSegmentsFn serves only with segment.view.
    permissions.includes(PERMISSIONS.SEGMENT_VIEW)
      ? queryClient.ensureQueryData(adminQueries.segments())
      : undefined,
    // The viewer's own votes, which the rows' vote buttons show (the same
    // query usePostVote reads).
    queryClient.ensureQueryData({
      queryKey: votedPostsKeys.byWorkspace(),
      queryFn: fetchVotedPosts,
      staleTime: 5 * 60 * 1000,
    }),
  ])
}
