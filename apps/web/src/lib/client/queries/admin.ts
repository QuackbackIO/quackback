import { queryOptions } from '@tanstack/react-query'
import type { BoardId, TagId, PrincipalId, PostId, RoadmapId } from '@quackback/ids'
import { ensureData } from '@/lib/client/query/ensure-data'
import {
  fetchInboxPosts,
  fetchBoardsList,
  fetchBoardsForSettings,
  fetchTagsList,
  fetchStatusesList,
  fetchTeamMembers,
  searchMembersFn,
  fetchOnboardingStatus,
  fetchIntegrationsList,
  fetchIntegrationCatalog,
  fetchIntegrationByType,
  listPortalUsersFn,
  listCustomerPeopleFn,
  listSegmentsFn,
  listUserAttributesFn,
} from '@/lib/server/functions/admin'
import { fetchPlatformCredentialsMaskedFn } from '@/lib/server/functions/platform-credentials'
import {
  fetchAuthProviderStatusFn,
  fetchAuthProviderCredentialsMaskedFn,
} from '@/lib/server/functions/auth-provider-credentials'
import { fetchGitHubIntegrationsFn } from '@/lib/server/integrations/github/functions'
import { listAuditEventsFn } from '@/lib/server/functions/audit-log'
import { listRecoveryCodesFn } from '@/lib/server/functions/recovery-codes'
import { getModerationStatus } from '@/lib/server/functions/moderation'
import { fetchApiKeys } from '@/lib/server/functions/api-keys'
import { fetchWebhooks } from '@/lib/server/functions/webhooks'
import { fetchRoadmaps } from '@/lib/server/functions/roadmaps'
import {
  fetchPostWithDetails,
  fetchPostVotersFn,
  fetchPostFeedbackSourceFn,
} from '@/lib/server/functions/posts'
import { fetchMergePreviewFn } from '@/lib/server/functions/post-merge'
import { fetchPublicStatuses } from '@/lib/server/functions/portal'
import type { PortalUserListParams } from '@/lib/shared/types'

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
        const data = ensureData(await fetchInboxPosts({ data: filters }), 'inboxPosts')
        // Deserialize date strings from server response
        return {
          ...data,
          items: (data?.items ?? []).map((p) => ({
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
        const data = ensureData(await fetchBoardsList(), 'boards')
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
      queryFn: async () => ensureData(await fetchBoardsForSettings(), 'boardsForSettings'),
      staleTime: 5 * 60 * 1000, // 5min - reference data
    }),

  /**
   * List all tags
   */
  tags: () =>
    queryOptions({
      queryKey: ['admin', 'tags'],
      queryFn: async () => {
        const data = ensureData(await fetchTagsList(), 'tags')
        return data.map((tag) => ({
          ...tag,
          createdAt: new Date(tag.createdAt),
          deletedAt: tag.deletedAt ? new Date(tag.deletedAt) : null,
        }))
      },
      staleTime: 5 * 60 * 1000, // 5min - reference data, rarely changes during session
    }),

  /**
   * List all statuses
   */
  statuses: () =>
    queryOptions({
      queryKey: ['admin', 'statuses'],
      queryFn: async () => {
        const data = ensureData(await fetchStatusesList(), 'statuses')
        return data.map((status) => ({
          ...status,
          createdAt: new Date(status.createdAt),
          deletedAt: status.deletedAt ? new Date(status.deletedAt) : null,
        }))
      },
      staleTime: 5 * 60 * 1000, // 5min - reference data, rarely changes during session
    }),

  /**
   * List all roadmaps
   */
  roadmaps: () =>
    queryOptions({
      queryKey: ['admin', 'roadmaps'],
      queryFn: async () => {
        const data = ensureData(await fetchRoadmaps(), 'roadmaps')
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
      queryFn: async () => {
        const data = ensureData(await fetchTeamMembers(), 'teamMembers')
        return data.map((member) => ({
          ...member,
          createdAt: new Date(member.createdAt),
          lastSignInAt: member.lastSignInAt ? new Date(member.lastSignInAt) : null,
        }))
      },
      staleTime: 5 * 60 * 1000, // 5min - reference data for filters/assignments
    }),

  /**
   * Search members (typeahead for author selector)
   */
  searchMembers: (params: { search?: string; limit?: number }) =>
    queryOptions({
      queryKey: ['admin', 'members', 'search', params],
      queryFn: async () => ensureData(await searchMembersFn({ data: params }), 'searchMembers'),
      staleTime: 30 * 1000,
    }),

  /**
   * List portal users with filtering
   */
  portalUsers: (filters: PortalUserListParams) =>
    queryOptions({
      queryKey: ['admin', 'users', filters],
      queryFn: async () =>
        ensureData(
          await listPortalUsersFn({
            data: {
              search: filters.search,
              verified: filters.verified,
              dateFrom: filters.dateFrom?.toISOString(),
              dateTo: filters.dateTo?.toISOString(),
              emailDomain: filters.emailDomain,
              postCount: filters.postCount,
              voteCount: filters.voteCount,
              commentCount: filters.commentCount,
              customAttrs: filters.customAttrs,
              sort: filters.sort,
              page: filters.page,
              limit: filters.limit,
              segmentIds: filters.segmentIds,
              includeAnonymous: filters.includeAnonymous,
            },
          }),
          'portalUsers'
        ),
      staleTime: 30 * 1000,
    }),

  /**
   * List unified customer people.
   */
  customerPeople: (filters: {
    search?: string
    includeArchived?: boolean
    segmentIds?: import('@quackback/ids').SegmentId[]
    limit?: number
    offset?: number
  }) =>
    queryOptions({
      queryKey: ['admin', 'customers', 'people', filters],
      queryFn: async () => {
        const data = ensureData(await listCustomerPeopleFn({ data: filters }), 'customerPeople')
        return {
          ...data,
          items: data.items.map((item) => ({
            ...item,
            archivedAt: item.archivedAt ? new Date(item.archivedAt) : null,
            linkedUsers: item.linkedUsers.map((linkedUser) => ({
              ...linkedUser,
              joinedAt: new Date(linkedUser.joinedAt),
            })),
          })),
        }
      },
      staleTime: 30 * 1000,
    }),

  /**
   * List all segments with member counts
   */
  segments: () =>
    queryOptions({
      queryKey: ['admin', 'segments'],
      queryFn: async () => ensureData(await listSegmentsFn(), 'segments'),
      staleTime: 30 * 1000,
    }),

  /**
   * Get onboarding status
   */
  onboardingStatus: () =>
    queryOptions({
      queryKey: ['admin', 'onboarding'],
      queryFn: async () => ensureData(await fetchOnboardingStatus(), 'onboardingStatus'),
      staleTime: 0, // Always fresh during onboarding
    }),

  /**
   * Get roadmap statuses (statuses marked for roadmap display)
   */
  roadmapStatuses: () =>
    queryOptions({
      queryKey: ['admin', 'roadmap', 'statuses'],
      queryFn: async () => {
        const statuses = ensureData(await fetchPublicStatuses(), 'roadmapStatuses')
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
      queryFn: async () => ensureData(await fetchIntegrationCatalog(), 'integrationCatalog'),
      staleTime: 5 * 60 * 1000, // 5min - availability changes when credentials are configured
    }),

  /**
   * Masked platform credentials for an integration type
   */
  platformCredentials: (type: string) =>
    queryOptions({
      queryKey: ['admin', 'platformCredentials', type],
      queryFn: async () =>
        ensureData(
          await fetchPlatformCredentialsMaskedFn({ data: { integrationType: type } }),
          'platformCredentials'
        ),
      staleTime: 5 * 60 * 1000, // 5min - rarely changes during a session
    }),

  /**
   * List all integrations (for integrations catalog)
   */
  integrations: () =>
    queryOptions({
      queryKey: ['admin', 'integrations'],
      queryFn: async () => ensureData(await fetchIntegrationsList(), 'integrations'),
      staleTime: 1 * 60 * 1000, // 1min - integration status can change
    }),

  /**
   * Get a single integration by type with event mappings and platform credential info
   */
  integrationByType: (type: string) =>
    queryOptions({
      queryKey: ['admin', 'integrations', type],
      queryFn: async () =>
        ensureData(await fetchIntegrationByType({ data: { type } }), 'integrationByType'),
      staleTime: 30 * 1000, // 30s - config may change frequently during setup
    }),

  /**
   * Get all GitHub integrations with configs and event mappings
   */
  githubIntegrations: () =>
    queryOptions({
      queryKey: ['admin', 'integrations', 'github-all'],
      queryFn: async () => ensureData(await fetchGitHubIntegrationsFn(), 'githubIntegrations'),
      staleTime: 30 * 1000,
    }),

  /**
   * Get post details by ID
   * NOTE: Uses same query key as inboxKeys.detail() for cache consistency with mutations
   */
  postDetail: (postId: PostId) =>
    queryOptions({
      queryKey: ['inbox', 'detail', postId],
      queryFn: async () => {
        const data = ensureData(await fetchPostWithDetails({ data: { id: postId } }), 'postDetail')
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
      queryFn: async () =>
        ensureData(await fetchPostVotersFn({ data: { id: postId } }), 'postVoters'),
      staleTime: 30 * 1000,
    }),

  /** Feedback source for a post (if created from the feedback pipeline) */
  postFeedbackSource: (postId: PostId) =>
    queryOptions({
      queryKey: ['inbox', 'feedback-source', postId],
      queryFn: () => fetchPostFeedbackSourceFn({ data: { id: postId } }),
      staleTime: 60 * 1000,
    }),

  /**
   * Preview what a merged post would look like (admin/member only)
   */
  mergePreview: (canonicalPostId: PostId, duplicatePostId: PostId) =>
    queryOptions({
      queryKey: ['inbox', 'merge-preview', canonicalPostId, duplicatePostId],
      queryFn: async () => {
        const data = ensureData(
          await fetchMergePreviewFn({
            data: { canonicalPostId, duplicatePostId },
          }),
          'mergePreview'
        )
        // Deserialize nested date strings (same pattern as postDetail)
        type ServerComment = (typeof data.post.comments)[0]
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
          post: {
            ...data.post,
            createdAt: new Date(data.post.createdAt),
            updatedAt: new Date(data.post.updatedAt),
            deletedAt: data.post.deletedAt ? new Date(data.post.deletedAt) : null,
            summaryUpdatedAt: data.post.summaryUpdatedAt
              ? new Date(data.post.summaryUpdatedAt)
              : null,
            comments: data.post.comments.map(deserializeComment),
            pinnedComment: data.post.pinnedComment
              ? {
                  ...data.post.pinnedComment,
                  createdAt: new Date(data.post.pinnedComment.createdAt),
                }
              : null,
          },
          duplicateComments: data.duplicateComments.map(deserializeComment),
          duplicatePostTitle: data.duplicatePostTitle,
        }
      },
      staleTime: 30 * 1000,
    }),

  /**
   * List all API keys
   */
  apiKeys: () =>
    queryOptions({
      queryKey: ['admin', 'api-keys'],
      queryFn: async () => {
        const data = ensureData(await fetchApiKeys(), 'apiKeys')
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
        const data = ensureData(await fetchWebhooks(), 'webhooks')
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
      queryFn: async () => ensureData(await fetchAuthProviderStatusFn(), 'authProviderStatus'),
      staleTime: 5 * 60 * 1000, // 5min - changes when credentials are saved/deleted
    }),

  /**
   * Masked auth provider credentials for a credential type
   */
  authProviderCredentials: (credentialType: string) =>
    queryOptions({
      queryKey: ['admin', 'authProviderCredentials', credentialType],
      queryFn: async () =>
        ensureData(
          await fetchAuthProviderCredentialsMaskedFn({ data: { credentialType } }),
          'authProviderCredentials'
        ),
      staleTime: 5 * 60 * 1000,
    }),

  /**
   * List all user attribute definitions
   */
  userAttributes: () =>
    queryOptions({
      queryKey: ['admin', 'userAttributes'],
      queryFn: async () => ensureData(await listUserAttributesFn(), 'userAttributes'),
      staleTime: 60 * 1000,
    }),

  /**
   * Recovery codes for the calling admin — metadata only. Generation
   * is via a mutation, not this query.
   */
  recoveryCodes: () =>
    queryOptions({
      queryKey: ['admin', 'recoveryCodes'],
      queryFn: async () => ensureData(await listRecoveryCodesFn({ data: {} }), 'recoveryCodes'),
      staleTime: 30 * 1000,
    }),

  /**
   * Moderation status: whether moderation is enabled + pending post count.
   * Drives the conditional sidebar entry and its backlog badge.
   */
  moderationStatus: () =>
    queryOptions({
      queryKey: ['admin', 'moderationStatus'],
      queryFn: async () => ensureData(await getModerationStatus(), 'moderationStatus'),
      staleTime: 30 * 1000, // 30s - count changes as posts are approved/rejected
    }),

  /**
   * Paginated audit-log feed. Filters compose with AND. The query key
   * includes the filters so distinct filter combinations are cached
   * independently.
   */
  auditEvents: (filters: {
    eventType?: string
    actorEmail?: string
    from?: string
    to?: string
    limit?: number
    excludeEventTypes?: string[]
  }) =>
    queryOptions({
      queryKey: ['admin', 'auditEvents', filters],
      queryFn: async () => ensureData(await listAuditEventsFn({ data: filters }), 'auditEvents'),
      // 30s — long enough for the page to feel stable; short enough
      // that the next interaction reflects fresh writes.
      staleTime: 30 * 1000,
    }),

  /**
   * Portal tab visibility configuration (org-level defaults)
   */
  portalTabConfig: () =>
    queryOptions({
      queryKey: ['admin', 'portalTabConfig'],
      queryFn: async () => {
        const { getPortalTabConfigFn } = await import('@/lib/server/functions/settings')
        return ensureData(await getPortalTabConfigFn(), 'portalTabConfig')
      },
      staleTime: 5 * 60 * 1000, // 5min - reference data, rarely changes
    }),

  /**
   * List all segments for override configuration
   */
  segmentList: () =>
    queryOptions({
      queryKey: ['admin', 'segments', 'list'],
      queryFn: async () => {
        const { listSegmentsFn } = await import('@/lib/server/functions/segments')
        const data = ensureData(await listSegmentsFn(), 'segments')
        return data
      },
      staleTime: 5 * 60 * 1000, // 5min - reference data
    }),
}

/**
 * Changelog visibility admin queries
 */
export const changelogVisibilityQueries = {
  adminData: () =>
    queryOptions({
      queryKey: ['admin', 'changelogVisibility'],
      queryFn: async () => {
        const { getChangelogVisibilityAdminFn } = await import('@/lib/server/functions/changelog')
        return getChangelogVisibilityAdminFn()
      },
      staleTime: 5 * 60 * 1000,
    }),
}

// Export filter types for external use
export type { PortalUserListParams as PortalUserFilters }
