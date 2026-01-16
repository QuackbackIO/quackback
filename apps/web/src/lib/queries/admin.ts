import { queryOptions } from '@tanstack/react-query'
import type { BoardId, TagId, MemberId, PostId } from '@quackback/ids'
import {
  fetchInboxPosts,
  fetchBoardsList,
  fetchBoardsForSettings,
  fetchTagsList,
  fetchStatusesList,
  fetchTeamMembers,
  fetchOnboardingStatus,
  fetchIntegrationsList,
  fetchIntegrationByType,
  listPortalUsersFn,
} from '@/lib/server-functions/admin'
import { fetchRoadmaps } from '@/lib/server-functions/roadmaps'
import { fetchPostWithDetails } from '@/lib/server-functions/posts'
import { fetchPublicStatuses } from '@/lib/server-functions/portal'
import type { PortalUserListParams } from '@/lib/users/user.types'

/**
 * Inbox/Feedback filter params
 */
export interface InboxPostListParams {
  boardIds?: BoardId[]
  statusSlugs?: string[]
  tagIds?: TagId[]
  ownerId?: MemberId | null | undefined
  search?: string
  dateFrom?: Date
  dateTo?: Date
  minVotes?: number
  sort?: 'newest' | 'oldest' | 'votes'
  page?: number
  limit?: number
}

/**
 * Query options factory for admin routes.
 * Uses server functions (createServerFn) to keep database code server-only.
 * These are used with ensureQueryData() in loaders and useSuspenseQuery() in components.
 */
export const adminQueries = {
  /**
   * List inbox posts with filtering
   */
  inboxPosts: (filters: InboxPostListParams) =>
    queryOptions({
      queryKey: ['admin', 'inbox', 'posts', filters],
      queryFn: () => fetchInboxPosts({ data: filters }),
      staleTime: 30 * 1000, // 30s - frequently updated
    }),

  /**
   * List all boards
   */
  boards: () =>
    queryOptions({
      queryKey: ['admin', 'boards'],
      queryFn: () => fetchBoardsList(),
      staleTime: 5 * 60 * 1000, // 5min - reference data, rarely changes during session
    }),

  /**
   * List boards for settings page (includes additional metadata)
   */
  boardsForSettings: () =>
    queryOptions({
      queryKey: ['admin', 'settings', 'boards'],
      queryFn: () => fetchBoardsForSettings(),
      staleTime: 5 * 60 * 1000, // 5min - reference data
    }),

  /**
   * List all tags
   */
  tags: () =>
    queryOptions({
      queryKey: ['admin', 'tags'],
      queryFn: () => fetchTagsList(),
      staleTime: 5 * 60 * 1000, // 5min - reference data, rarely changes during session
    }),

  /**
   * List all statuses
   */
  statuses: () =>
    queryOptions({
      queryKey: ['admin', 'statuses'],
      queryFn: () => fetchStatusesList(),
      staleTime: 5 * 60 * 1000, // 5min - reference data, rarely changes during session
    }),

  /**
   * List all roadmaps
   */
  roadmaps: () =>
    queryOptions({
      queryKey: ['admin', 'roadmaps'],
      queryFn: () => fetchRoadmaps(),
      staleTime: 5 * 60 * 1000, // 5min - reference data, rarely changes during session
    }),

  /**
   * List all team members
   */
  teamMembers: () =>
    queryOptions({
      queryKey: ['admin', 'team', 'members'],
      queryFn: () => fetchTeamMembers(),
      staleTime: 5 * 60 * 1000, // 5min - reference data for filters/assignments
    }),

  /**
   * List portal users with filtering
   */
  portalUsers: (filters: PortalUserListParams) =>
    queryOptions({
      queryKey: ['admin', 'users', filters],
      queryFn: () =>
        listPortalUsersFn({
          data: {
            search: filters.search,
            verified: filters.verified,
            dateFrom: filters.dateFrom?.toISOString(),
            dateTo: filters.dateTo?.toISOString(),
            sort: filters.sort,
            page: filters.page,
            limit: filters.limit,
          },
        }),
      staleTime: 30 * 1000,
    }),

  /**
   * Get onboarding status
   */
  onboardingStatus: () =>
    queryOptions({
      queryKey: ['admin', 'onboarding'],
      queryFn: () => fetchOnboardingStatus(),
      staleTime: 0, // Always fresh during onboarding
    }),

  /**
   * Get roadmap statuses (statuses marked for roadmap display)
   */
  roadmapStatuses: () =>
    queryOptions({
      queryKey: ['admin', 'roadmap', 'statuses'],
      queryFn: async () => {
        const statuses = await fetchPublicStatuses()
        return statuses.filter((s) => s.showOnRoadmap)
      },
      staleTime: 5 * 60 * 1000, // 5min - reference data
    }),

  /**
   * List all integrations (for integrations catalog)
   */
  integrations: () =>
    queryOptions({
      queryKey: ['admin', 'integrations'],
      queryFn: () => fetchIntegrationsList(),
      staleTime: 1 * 60 * 1000, // 1min - integration status can change
    }),

  /**
   * Get a single integration by type with event mappings
   */
  integrationByType: (type: string) =>
    queryOptions({
      queryKey: ['admin', 'integrations', type],
      queryFn: () => fetchIntegrationByType({ data: { type } }),
      staleTime: 30 * 1000, // 30s - config may change frequently during setup
    }),

  /**
   * Get post details by ID
   * NOTE: Uses same query key as inboxKeys.detail() for cache consistency with mutations
   */
  postDetail: (postId: PostId) =>
    queryOptions({
      queryKey: ['inbox', 'detail', postId],
      queryFn: () => fetchPostWithDetails({ data: { id: postId } }),
      staleTime: 30 * 1000, // 30s - frequently updated
    }),
}

// Export filter types for external use
export type { PortalUserListParams as PortalUserFilters }
