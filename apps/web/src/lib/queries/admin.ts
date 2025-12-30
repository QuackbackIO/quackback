import { queryOptions } from '@tanstack/react-query'
import type { BoardId, TagId, MemberId } from '@quackback/ids'
import {
  fetchInboxPosts,
  fetchBoardsList,
  fetchBoardsForSettings,
  fetchTagsList,
  fetchStatusesList,
  fetchTeamMembers,
  fetchOnboardingStatus,
  fetchIntegrationsList,
} from '@/lib/server-functions/admin'
import { listPortalUsers, type PortalUserFilters } from '@/lib/users'
import { listPublicStatuses } from '@/lib/statuses'

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
      queryFn: () => fetchInboxPosts(filters),
      staleTime: 30 * 1000, // 30s - frequently updated
    }),

  /**
   * List all boards
   */
  boards: () =>
    queryOptions({
      queryKey: ['admin', 'boards'],
      queryFn: () => fetchBoardsList(),
      staleTime: 2 * 60 * 1000, // 2min - rarely changes
    }),

  /**
   * List boards for settings page (includes additional metadata)
   */
  boardsForSettings: () =>
    queryOptions({
      queryKey: ['admin', 'settings', 'boards'],
      queryFn: () => fetchBoardsForSettings(),
      staleTime: 2 * 60 * 1000,
    }),

  /**
   * List all tags
   */
  tags: () =>
    queryOptions({
      queryKey: ['admin', 'tags'],
      queryFn: () => fetchTagsList(),
      staleTime: 2 * 60 * 1000,
    }),

  /**
   * List all statuses
   */
  statuses: () =>
    queryOptions({
      queryKey: ['admin', 'statuses'],
      queryFn: () => fetchStatusesList(),
      staleTime: 2 * 60 * 1000,
    }),

  /**
   * List all team members
   */
  teamMembers: () =>
    queryOptions({
      queryKey: ['admin', 'team', 'members'],
      queryFn: () => fetchTeamMembers(),
      staleTime: 1 * 60 * 1000, // 1min - team changes should update quickly
    }),

  /**
   * List portal users with filtering
   */
  portalUsers: (filters: PortalUserFilters) =>
    queryOptions({
      queryKey: ['admin', 'users', filters],
      queryFn: () => listPortalUsers(filters),
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
        const result = await listPublicStatuses()
        if (!result.success) throw new Error(result.error.message)
        return result.value.filter((s) => s.showOnRoadmap)
      },
      staleTime: 2 * 60 * 1000,
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
}
