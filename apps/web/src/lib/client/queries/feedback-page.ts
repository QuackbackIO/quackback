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
  // The filters and pickers each need a permission of their own, which a
  // custom role (or the Contributor preset, for boards) may not hold. Each is
  // warmed only for a viewer the server will serve it to.
  const can = (permission: PermissionKey) => permissions.includes(permission)
  return Promise.all([
    queryClient.ensureInfiniteQueryData(inboxPostsInfiniteOptions(defaultInboxFilters)),
    queryClient.ensureQueryData(inboxFacetCountsOptions(defaultInboxFilters)),
    can(PERMISSIONS.BOARD_MANAGE) ? queryClient.ensureQueryData(adminQueries.boards()) : undefined,
    can(PERMISSIONS.TAG_VIEW) ? queryClient.ensureQueryData(adminQueries.tags()) : undefined,
    can(PERMISSIONS.STATUS_VIEW) ? queryClient.ensureQueryData(adminQueries.statuses()) : undefined,
    // The same cache entry the page's useAdminTeamMembers reads.
    can(PERMISSIONS.MEMBER_VIEW)
      ? queryClient.ensureQueryData(adminQueries.teamMembers())
      : undefined,
    queryClient.ensureQueryData(mergeSuggestionQueries.summary()),
    // Warm the moderation count so the pending-moderation banner renders on
    // first paint instead of popping in once the query resolves. Only a
    // viewer who may review (post.approve) is shown it.
    can(PERMISSIONS.POST_APPROVE)
      ? queryClient.ensureQueryData(adminQueries.moderationStatus())
      : undefined,
    // The segment filter, which listSegmentsFn serves only with segment.view.
    can(PERMISSIONS.SEGMENT_VIEW)
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
