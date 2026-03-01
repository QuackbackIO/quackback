import { queryOptions } from '@tanstack/react-query'
import type { BoardId, TagId, PrincipalId, PostId, RoadmapId } from '@quackback/ids'
import {
  fetchInboxPosts,
  fetchBoardsList,
  fetchBoardsForSettings,
  fetchTagsList,
  fetchStatusesList,
  fetchTeamMembers,
  fetchOnboardingStatus,
  fetchIntegrationsList,
  fetchIntegrationCatalog,
  fetchIntegrationByType,
  listPortalUsersFn,
  listSegmentsFn,
  listUserAttributesFn,
} from '@/lib/server/functions/admin'
import { fetchPlatformCredentialsMaskedFn } from '@/lib/server/functions/platform-credentials'
import {
  fetchAuthProviderStatusFn,
  fetchAuthProviderCredentialsMaskedFn,
} from '@/lib/server/functions/auth-provider-credentials'
import { fetchApiKeys } from '@/lib/server/functions/api-keys'
import { fetchWebhooks } from '@/lib/server/functions/webhooks'
import { fetchRoadmaps } from '@/lib/server/functions/roadmaps'
import { fetchPostWithDetails, fetchPostVotersFn } from '@/lib/server/functions/posts'
import { fetchPublicStatuses } from '@/lib/server/functions/portal'
import type { PortalUserListParams } from '@/lib/server/domains/users/user.types'

/**
 * Inbox/Feedback filter params
 */
export interface InboxPostListParams {
  boardIds?: BoardId[]
  statusSlugs?: string[]
  tagIds?: TagId[]
  ownerId?: PrincipalId | null | undefined
  search?: string
  dateFrom?: string
  dateTo?: string
  minVotes?: number
  minComments?: number
  responded?: 'all' | 'responded' | 'unresponded'
  updatedBefore?: string
  sort?: 'newest' | 'oldest' | 'votes'
  showDeleted?: boolean
  cursor?: string
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
      queryFn: async () => {
        const data = await fetchInboxPosts({ data: filters })
        // Deserialize date strings from server response
        return {
          ...data,
          items: data.items.map((p) => ({
            ...p,
            createdAt: new Date(p.createdAt),
            updatedAt: new Date(p.updatedAt),
            deletedAt: p.deletedAt ? new Date(p.deletedAt) : null,
          })),
        }
      },
      staleTime: 30 * 1000, // 30s - frequently updated
    }),

  /**
   * List all boards
   */
  boards: () =>
    queryOptions({
      queryKey: ['admin', 'boards'],
      queryFn: async () => {
        const data = await fetchBoardsList()
        return data.map((b) => ({
          ...b,
          createdAt: new Date(b.createdAt),
          updatedAt: new Date(b.updatedAt),
        }))
      },
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
      queryFn: async () => {
        const data = await fetchRoadmaps()
        return data.map((r) => ({
          ...r,
          id: r.id as RoadmapId, // Server serializes to string, cast back to branded type
          createdAt: new Date(r.createdAt),
          updatedAt: new Date(r.updatedAt),
        }))
      },
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
            segmentIds: filters.segmentIds,
          },
        }),
      staleTime: 30 * 1000,
    }),

  /**
   * List all segments with member counts
   */
  segments: () =>
    queryOptions({
      queryKey: ['admin', 'segments'],
      queryFn: () => listSegmentsFn(),
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
   * Integration catalog (includes dynamic availability based on platform credentials)
   */
  integrationCatalog: () =>
    queryOptions({
      queryKey: ['admin', 'integrationCatalog'],
      queryFn: () => fetchIntegrationCatalog(),
      staleTime: 5 * 60 * 1000, // 5min - availability changes when credentials are configured
    }),

  /**
   * Masked platform credentials for an integration type
   */
  platformCredentials: (type: string) =>
    queryOptions({
      queryKey: ['admin', 'platformCredentials', type],
      queryFn: () => fetchPlatformCredentialsMaskedFn({ data: { integrationType: type } }),
      staleTime: 5 * 60 * 1000, // 5min - rarely changes during a session
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
   * Get a single integration by type with event mappings and platform credential info
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
      queryFn: async () => {
        const data = await fetchPostWithDetails({ data: { id: postId } })
        // Deserialize nested date strings from server response
        type ServerComment = (typeof data.comments)[0]
        type DeserializedComment = Omit<ServerComment, 'createdAt' | 'replies'> & {
          createdAt: Date
          replies: DeserializedComment[]
        }
        const deserializeComment = (c: ServerComment): DeserializedComment => ({
          ...c,
          createdAt: new Date(c.createdAt),
          replies: c.replies.map(deserializeComment),
        })
        return {
          ...data,
          createdAt: new Date(data.createdAt),
          updatedAt: new Date(data.updatedAt),
          deletedAt: data.deletedAt ? new Date(data.deletedAt) : null,
          summaryUpdatedAt: data.summaryUpdatedAt ? new Date(data.summaryUpdatedAt) : null,
          comments: data.comments.map(deserializeComment),
          pinnedComment: data.pinnedComment
            ? { ...data.pinnedComment, createdAt: new Date(data.pinnedComment.createdAt) }
            : null,
        }
      },
      staleTime: 30 * 1000, // 30s - frequently updated
    }),

  /**
   * Get voters for a post (admin/member only)
   */
  postVoters: (postId: PostId) =>
    queryOptions({
      queryKey: ['inbox', 'voters', postId],
      queryFn: () => fetchPostVotersFn({ data: { id: postId } }),
      staleTime: 30 * 1000,
    }),

  /**
   * List all API keys
   */
  apiKeys: () =>
    queryOptions({
      queryKey: ['admin', 'api-keys'],
      queryFn: async () => {
        const data = await fetchApiKeys()
        return data.map((k) => ({
          ...k,
          createdAt: new Date(k.createdAt),
          lastUsedAt: k.lastUsedAt ? new Date(k.lastUsedAt) : null,
          expiresAt: k.expiresAt ? new Date(k.expiresAt) : null,
          revokedAt: k.revokedAt ? new Date(k.revokedAt) : null,
        }))
      },
      staleTime: 30 * 1000, // 30s - may change when creating/revoking keys
    }),

  /**
   * List all webhooks
   */
  webhooks: () =>
    queryOptions({
      queryKey: ['admin', 'webhooks'],
      queryFn: async () => {
        const data = await fetchWebhooks()
        return data.map((w) => ({
          ...w,
          createdAt: new Date(w.createdAt),
          updatedAt: new Date(w.updatedAt),
          lastTriggeredAt: w.lastTriggeredAt ? new Date(w.lastTriggeredAt) : null,
        }))
      },
      staleTime: 30 * 1000, // 30s - may change when creating/updating webhooks
    }),

  /**
   * Auth provider credential status: which providers have credentials configured
   */
  authProviderStatus: () =>
    queryOptions({
      queryKey: ['admin', 'authProviderStatus'],
      queryFn: () => fetchAuthProviderStatusFn(),
      staleTime: 5 * 60 * 1000, // 5min - changes when credentials are saved/deleted
    }),

  /**
   * Masked auth provider credentials for a credential type
   */
  authProviderCredentials: (credentialType: string) =>
    queryOptions({
      queryKey: ['admin', 'authProviderCredentials', credentialType],
      queryFn: () => fetchAuthProviderCredentialsMaskedFn({ data: { credentialType } }),
      staleTime: 5 * 60 * 1000,
    }),

  /**
   * List all user attribute definitions
   */
  userAttributes: () =>
    queryOptions({
      queryKey: ['admin', 'userAttributes'],
      queryFn: () => listUserAttributesFn(),
      staleTime: 60 * 1000,
    }),
}

// Export filter types for external use
export type { PortalUserListParams as PortalUserFilters }
