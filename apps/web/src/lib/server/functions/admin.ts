import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import {
  generateId,
  type InviteId,
  type UserId,
  type PrincipalId,
  type SegmentId,
} from '@quackback/ids'
import type { BoardId, TagId } from '@quackback/ids'
import {
  getSetupState,
  isOnboardingComplete as checkComplete,
  type BoardSettings,
} from '@/lib/server/db'
import type { TiptapContent } from '@/lib/shared/schemas/posts'
import { requireAuth, requireAuthWithPermissions } from './auth-helpers'
import { getSettings } from './workspace'
import { db, invitation, principal, user, eq, and, gt } from '@/lib/server/db'
import { listInboxPosts } from '@/lib/server/domains/posts/post.inbox'
import { listBoards } from '@/lib/server/domains/boards/board.service'
import { listTags } from '@/lib/server/domains/tags/tag.service'
import { listStatuses } from '@/lib/server/domains/statuses/status.service'
import {
  listTeamMembers,
  searchMembers,
  updateMemberRole,
  removeTeamMember,
} from '@/lib/server/domains/principals/principal.service'
import { listPortalUsers, removePortalUser } from '@/lib/server/domains/users/user.service'
import { getPortalUserDetail } from '@/lib/server/domains/users/user.detail'
import { listCustomerPeople } from '@/lib/server/domains/customers'
import {
  listSegments,
  createSegment,
  updateSegment,
  deleteSegment,
  assignUsersToSegment,
  removeUsersFromSegment,
} from '@/lib/server/domains/segments/segment.service'
import {
  evaluateDynamicSegment,
  evaluateAllDynamicSegments,
} from '@/lib/server/domains/segments/segment.evaluation'
import {
  upsertSegmentEvaluationSchedule,
  removeSegmentEvaluationSchedule,
} from '@/lib/server/events/segment-scheduler'
import type { CreateSegmentInput, UpdateSegmentInput } from '@/lib/server/domains/segments'
import {
  listUserAttributes,
  createUserAttribute,
  updateUserAttribute,
  deleteUserAttribute,
} from '@/lib/server/domains/user-attributes/user-attribute.service'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission } from '@/lib/server/domains/authz/authz.service'
import type { UserAttributeId } from '@quackback/ids'
import { sendInvitationEmail } from '@quackback/email'
import { getBaseUrl } from '@/lib/server/config'
import { toIsoString, toIsoStringOrNull } from '@/lib/shared/utils/date'

/** Invitation expiry duration — 7 days in milliseconds */
const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Server functions for admin data fetching.
 * All functions require authentication and team member role (admin or member).
 */

// Schemas for GET request parameters
const inboxPostListSchema = z.object({
  sort: z.enum(['votes', 'newest', 'oldest']).default('newest'),
  limit: z.number().default(20),
  cursor: z.string().optional(),
  search: z.string().optional(),
  ownerId: z.string().nullable().optional(),
  statusSlugs: z.array(z.string()).optional(),
  boardIds: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  segmentIds: z.array(z.string()).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  minVotes: z.number().optional(),
  minComments: z.number().optional(),
  responded: z.enum(['all', 'responded', 'unresponded']).optional(),
  updatedBefore: z.string().optional(),
  showDeleted: z.boolean().optional(),
})

const activityCountFilterSchema = z.object({
  op: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']),
  value: z.number(),
})

const customAttrFilterSchema = z.object({
  key: z.string(),
  op: z.string(),
  value: z.string(),
})

const listPortalUsersSchema = z.object({
  search: z.string().optional(),
  verified: z.boolean().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  emailDomain: z.string().optional(),
  postCount: activityCountFilterSchema.optional(),
  voteCount: activityCountFilterSchema.optional(),
  commentCount: activityCountFilterSchema.optional(),
  customAttrs: z.array(customAttrFilterSchema).optional(),
  sort: z
    .enum(['newest', 'oldest', 'most_active', 'most_posts', 'most_comments', 'most_votes', 'name'])
    .optional(),
  page: z.number().optional(),
  limit: z.number().optional(),
  segmentIds: z.array(z.string()).optional(),
  includeAnonymous: z.boolean().optional(),
})

const portalUserByIdSchema = z.object({
  principalId: z.string(),
})

const listCustomerPeopleSchema = z.object({
  search: z.string().optional(),
  includeArchived: z.boolean().optional(),
  segmentIds: z.array(z.string()).optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
})

/**
 * Fetch inbox posts with filters for admin feedback view
 */
export const fetchInboxPosts = createServerFn({ method: 'GET' })
  .inputValidator(inboxPostListSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:admin] fetchInboxPosts: sort=${data.sort}, cursor=${data.cursor ?? 'none'}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const result = await listInboxPosts({
        boardIds: data.boardIds as BoardId[] | undefined,
        statusSlugs: data.statusSlugs,
        tagIds: data.tagIds as TagId[] | undefined,
        segmentIds: data.segmentIds as SegmentId[] | undefined,
        ownerId: data.ownerId as PrincipalId | null | undefined,
        search: data.search,
        dateFrom: data.dateFrom ? new Date(data.dateFrom) : undefined,
        dateTo: data.dateTo ? new Date(data.dateTo) : undefined,
        minVotes: data.minVotes,
        minComments: data.minComments,
        responded: data.responded,
        updatedBefore: data.updatedBefore ? new Date(data.updatedBefore) : undefined,
        sort: data.sort,
        showDeleted: data.showDeleted,
        cursor: data.cursor,
        limit: data.limit,
      })
      console.log(`[fn:admin] fetchInboxPosts: count=${result.items.length}`)
      // Serialize contentJson field and Date fields
      return {
        ...result,
        items: result.items.map((p) => ({
          ...p,
          contentJson: (p.contentJson ?? {}) as TiptapContent,
          createdAt: toIsoString(p.createdAt),
          updatedAt: toIsoString(p.updatedAt),
          deletedAt: toIsoStringOrNull(p.deletedAt),
        })),
      }
    } catch (error) {
      console.error(`[fn:admin] ❌ fetchInboxPosts failed:`, error)
      throw error
    }
  })

/**
 * Fetch all boards for the organization
 */
export const fetchBoardsList = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:admin] fetchBoardsList`)
  try {
    await requireAuth({ roles: ['admin', 'member'] })

    const result = await listBoards()
    console.log(`[fn:admin] fetchBoardsList: count=${result.length}`)
    return result.map((b) => ({
      ...b,
      settings: (b.settings ?? {}) as BoardSettings,
      createdAt: toIsoString(b.createdAt),
      updatedAt: toIsoString(b.updatedAt),
    }))
  } catch (error) {
    console.error(`[fn:admin] ❌ fetchBoardsList failed:`, error)
    throw error
  }
})

/**
 * Fetch all tags for the organization
 */
export const fetchTagsList = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:admin] fetchTagsList`)
  try {
    await requireAuth({ roles: ['admin', 'member'] })

    const result = await listTags()
    console.log(`[fn:admin] fetchTagsList: count=${result.length}`)
    return result.map((tag) => ({
      ...tag,
      createdAt: toIsoString(tag.createdAt),
      deletedAt: toIsoStringOrNull(tag.deletedAt),
    }))
  } catch (error) {
    console.error(`[fn:admin] ❌ fetchTagsList failed:`, error)
    throw error
  }
})

/**
 * Fetch all statuses for the organization
 */
export const fetchStatusesList = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:admin] fetchStatusesList`)
  try {
    await requireAuth({ roles: ['admin', 'member'] })

    const result = await listStatuses()
    console.log(`[fn:admin] fetchStatusesList: count=${result.length}`)
    return result.map((status) => ({
      ...status,
      createdAt: toIsoString(status.createdAt),
      deletedAt: toIsoStringOrNull(status.deletedAt),
    }))
  } catch (error) {
    console.error(`[fn:admin] ❌ fetchStatusesList failed:`, error)
    throw error
  }
})

/**
 * Fetch team members (not portal users)
 */
export const fetchTeamMembers = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:admin] fetchTeamMembers`)
  try {
    await requireAuth({ roles: ['admin', 'member'] })

    const result = await listTeamMembers()
    console.log(`[fn:admin] fetchTeamMembers: count=${result.length}`)
    return result.map((member) => ({
      ...member,
      createdAt: toIsoString(member.createdAt),
      lastSignInAt: toIsoStringOrNull(member.lastSignInAt),
    }))
  } catch (error) {
    console.error(`[fn:admin] ❌ fetchTeamMembers failed:`, error)
    throw error
  }
})

const searchMembersSchema = z.object({
  search: z.string().optional(),
  limit: z.number().optional(),
})

export const searchMembersFn = createServerFn({ method: 'GET' })
  .inputValidator(searchMembersSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })
    return searchMembers(data)
  })

// Schema for team member operations
const principalIdSchema = z.object({
  principalId: z.string(),
})

const updatePrincipalRoleSchema = z.object({
  principalId: z.string(),
  role: z.enum(['admin', 'member']),
})

/**
 * Update a team member's role (admin only)
 */
export const updateMemberRoleFn = createServerFn({ method: 'POST' })
  .inputValidator(updatePrincipalRoleSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:admin] updateMemberRoleFn: principalId=${data.principalId}, role=${data.role}`)
    try {
      const auth = await requireAuth({ roles: ['admin'] })
      const { actorFromAuth } = await import('@/lib/server/audit/log')

      await updateMemberRole(
        data.principalId as PrincipalId,
        data.role,
        auth.principal.id,
        actorFromAuth(auth),
        getRequestHeaders()
      )

      console.log(`[fn:admin] updateMemberRoleFn: success`)
      return { principalId: data.principalId, role: data.role }
    } catch (error) {
      console.error(`[fn:admin] ❌ updateMemberRoleFn failed:`, error)
      throw error
    }
  })

const forceSignOutInput = z.object({
  userId: z.string().regex(/^user_/),
})

/**
 * Admin action: revoke every active session for the given user.
 *
 * Common use: an admin needs to evict a user immediately — laptop
 * lost, suspected compromise, departing employee. The deletion is a
 * single SQL DELETE against the session table (Better-Auth checks
 * the row on every authed request, so the user is signed out on
 * their next interaction).
 *
 * Audit row: `session.revoked.individual` with the target user_id
 * and the affected-row count. The actor is the calling admin.
 */
export const forceSignOutUserFn = createServerFn({ method: 'POST' })
  .inputValidator(forceSignOutInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })
    const targetUserId = data.userId as UserId

    const { db, session } = await import('@/lib/server/db')
    const deleted = await db
      .delete(session)
      .where(eq(session.userId, targetUserId))
      .returning({ id: session.id })
    const revokeCount = deleted.length

    const { recordAuditEvent, actorFromAuth } = await import('@/lib/server/audit/log')
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    await recordAuditEvent({
      event: 'session.revoked.individual',
      outcome: 'success',
      actor: actorFromAuth(auth),
      headers: getRequestHeaders(),
      target: { type: 'user', id: targetUserId },
      metadata: { count: revokeCount, reason: 'admin_forced' },
    })

    return { revokeCount }
  })

/**
 * Remove a team member (converts to portal user, admin only)
 */
export const removeTeamMemberFn = createServerFn({ method: 'POST' })
  .inputValidator(principalIdSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:admin] removeTeamMemberFn: principalId=${data.principalId}`)
    try {
      const auth = await requireAuth({ roles: ['admin'] })
      const { actorFromAuth } = await import('@/lib/server/audit/log')

      await removeTeamMember(
        data.principalId as PrincipalId,
        auth.principal.id,
        actorFromAuth(auth),
        getRequestHeaders()
      )

      console.log(`[fn:admin] removeTeamMemberFn: success`)
      return { principalId: data.principalId }
    } catch (error) {
      console.error(`[fn:admin] ❌ removeTeamMemberFn failed:`, error)
      throw error
    }
  })

/**
 * Check onboarding completion status
 */
export const fetchOnboardingStatus = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:admin] fetchOnboardingStatus`)
  try {
    await requireAuth({ roles: ['admin', 'member'] })

    const [orgBoards, members] = await Promise.all([
      db.query.boards.findMany({
        columns: { id: true },
      }),
      db.select({ id: principal.id }).from(principal),
    ])

    console.log(
      `[fn:admin] fetchOnboardingStatus: hasBoards=${orgBoards.length > 0}, memberCount=${members.length}`
    )
    return {
      hasBoards: orgBoards.length > 0,
      memberCount: members.length,
    }
  } catch (error) {
    console.error(`[fn:admin] ❌ fetchOnboardingStatus failed:`, error)
    throw error
  }
})

/**
 * Fetch boards list for settings page
 */
export const fetchBoardsForSettings = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:admin] fetchBoardsForSettings`)
  try {
    await requireAuth({ roles: ['admin', 'member'] })

    const orgBoards = await listBoards()
    console.log(`[fn:admin] fetchBoardsForSettings: count=${orgBoards.length}`)
    return orgBoards.map((b) => ({
      ...b,
      settings: (b.settings ?? {}) as BoardSettings,
      createdAt: toIsoString(b.createdAt),
      updatedAt: toIsoString(b.updatedAt),
    }))
  } catch (error) {
    console.error(`[fn:admin] ❌ fetchBoardsForSettings failed:`, error)
    throw error
  }
})

/**
 * Fetch integrations list
 */
export const fetchIntegrationsList = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:admin] fetchIntegrationsList`)
  try {
    await requireAuth({ roles: ['admin', 'member'] })

    const results = await db.query.integrations.findMany()
    console.log(`[fn:admin] fetchIntegrationsList: count=${results.length}`)
    return results.map((i) => ({
      id: i.id,
      integrationType: i.integrationType,
      status: i.status,
      workspaceName: (i.config as Record<string, unknown>)?.workspaceName as string | undefined,
      connectedAt: i.connectedAt,
    }))
  } catch (error) {
    console.error(`[fn:admin] ❌ fetchIntegrationsList failed:`, error)
    throw error
  }
})

/**
 * Fetch integration catalog (static metadata for all registered integrations)
 */
export const fetchIntegrationCatalog = createServerFn({ method: 'GET' }).handler(async () => {
  const { getIntegrationCatalog } = await import('@/lib/server/integrations')
  return await getIntegrationCatalog()
})

/**
 * Fetch a single integration by type (e.g., 'slack') with event mappings
 */
export const fetchIntegrationByType = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ type: z.string() }))
  .handler(async ({ data }) => {
    console.log(`[fn:admin] fetchIntegrationByType: type=${data.type}`)
    try {
      await requireAuth({ roles: ['admin'] })

      const { integrations } = await import('@/lib/server/db')
      const { getIntegration } = await import('@/lib/server/integrations')
      const { hasPlatformCredentials } =
        await import('@/lib/server/domains/platform-credentials/platform-credential.service')

      const definition = getIntegration(data.type)
      const platformCredentialFields = definition?.platformCredentials ?? []
      const platformCredentialsConfigured =
        platformCredentialFields.length === 0 || (await hasPlatformCredentials(data.type))

      const integration = await db.query.integrations.findFirst({
        where: eq(integrations.integrationType, data.type),
        with: {
          eventMappings: true,
          slackChannelMonitors: true,
        },
      })

      if (!integration) {
        console.log(`[fn:admin] fetchIntegrationByType: not found`)
        return {
          integration: null,
          platformCredentialFields,
          platformCredentialsConfigured,
        }
      }

      console.log(`[fn:admin] fetchIntegrationByType: found id=${integration.id}`)

      // Group event mappings by targetKey into notification channels
      const channelMap = new Map<
        string,
        {
          channelId: string
          events: { eventType: string; enabled: boolean }[]
          boardIds: string[] | null
        }
      >()

      const integrationConfig = (integration.config as Record<string, unknown>) || {}

      for (const m of integration.eventMappings) {
        const targetKey = (m as { targetKey?: string }).targetKey || 'default'
        const actionConfig = (m.actionConfig as Record<string, unknown>) || {}
        const channelId = (actionConfig.channelId || integrationConfig.channelId) as
          | string
          | undefined

        if (!channelId) continue

        if (!channelMap.has(targetKey)) {
          const filters = (m.filters as { boardIds?: string[] } | null) || null
          channelMap.set(targetKey, {
            channelId,
            events: [],
            boardIds: filters?.boardIds?.length ? filters.boardIds : null,
          })
        }

        channelMap.get(targetKey)!.events.push({
          eventType: m.eventType,
          enabled: m.enabled,
        })
      }

      const notificationChannels = [...channelMap.values()]

      // Map monitored channels for Slack
      const monitoredChannels = (integration.slackChannelMonitors ?? []).map((m) => ({
        channelId: m.channelId,
        channelName: m.channelName,
        boardId: m.boardId,
        enabled: m.enabled,
      }))

      return {
        integration: {
          id: integration.id,
          status: integration.status,
          workspaceName: integrationConfig.workspaceName as string | undefined,
          config: integration.config as Record<string, string | number | boolean | null>,
          eventMappings: integration.eventMappings.map((m) => ({
            id: m.id,
            eventType: m.eventType,
            enabled: m.enabled,
          })),
          notificationChannels,
          monitoredChannels,
        },
        platformCredentialFields,
        platformCredentialsConfigured,
      }
    } catch (error) {
      console.error(`[fn:admin] ❌ fetchIntegrationByType failed:`, error)
      throw error
    }
  })

/**
 * Public auth configuration surface for the unauthenticated onboarding
 * shell. Tells the client whether SSO is configured + usable so the
 * account-creation step can offer the one-click button instead of the
 * manual Jane-Doe form. Only non-secret signals are returned.
 *
 * `ssoEnabled` reflects the same registration check `createAuth()` runs:
 * `settings.authConfig.ssoOidc.enabled` AND a client secret exists in
 * `platform_credentials` (`auth_sso`) AND the `customOidcProvider`
 * tier flag is on. In practice this is rarely true at first-onboarding
 * time (no admin yet to configure SSO) — but a re-onboard against an
 * existing tenant DB will use SSO when the row is there.
 */
export const getPublicAuthConfig = createServerFn({ method: 'GET' }).handler(async () => {
  const { getTenantSettings } = await import('@/lib/server/domains/settings/settings.service')
  const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
  const { isSsoActuallyRegistered } = await import('@/lib/server/auth/sso-secret')
  const [tenant, tierLimits] = await Promise.all([getTenantSettings(), getTierLimits()])
  const ssoEnabled = await isSsoActuallyRegistered(tenant?.authConfig?.ssoOidc, tierLimits)
  return { ssoEnabled }
})

/**
 * Check onboarding state for a user
 * Returns member record, step, and whether boards exist
 * Note: This function is called during onboarding and may create member records
 */
export const checkOnboardingState = createServerFn({ method: 'GET' })
  .inputValidator(z.string().optional())
  .handler(async ({ data }) => {
    console.log(`[fn:admin] checkOnboardingState`)
    try {
      // Allow unauthenticated access for onboarding
      const userId = data

      if (!userId) {
        console.log(`[fn:admin] checkOnboardingState: no userId`)
        return {
          principalRecord: null,
          hasSettings: false,
          setupState: null,
          isOnboardingComplete: false,
        }
      }

      // Check if user has a principal record
      let principalRecord = await db.query.principal.findFirst({
        where: eq(principal.userId, userId as UserId),
      })

      if (!principalRecord) {
        // Check if any human admin exists (exclude service principals)
        const existingAdmin = await db.query.principal.findFirst({
          where: and(eq(principal.role, 'admin'), eq(principal.type, 'user')),
        })

        if (existingAdmin) {
          // Not first user - they need an invitation
          console.log(`[fn:admin] checkOnboardingState: needsInvitation=true`)
          return {
            principalRecord: null,
            needsInvitation: true,
            hasSettings: false,
            setupState: null,
            isOnboardingComplete: false,
          }
        }

        // First user - create admin principal record
        const [newPrincipal] = await db
          .insert(principal)
          .values({
            id: generateId('principal'),
            userId: userId as UserId,
            role: 'admin',
            createdAt: new Date(),
          })
          .returning()

        principalRecord = newPrincipal
        console.log(`[fn:admin] checkOnboardingState: created admin principal`)
      }

      // Get settings to check setup state
      const currentSettings = await getSettings()
      const setupState = getSetupState(currentSettings?.setupState ?? null)
      const isOnboardingComplete = checkComplete(setupState)

      console.log(
        `[fn:admin] checkOnboardingState: setupState=${JSON.stringify(setupState)}, isComplete=${isOnboardingComplete}`
      )
      return {
        principalRecord: principalRecord
          ? {
              id: principalRecord.id,
              userId: principalRecord.userId,
              role: principalRecord.role,
            }
          : null,
        needsInvitation: false,
        hasSettings: !!currentSettings,
        setupState,
        isOnboardingComplete,
      }
    } catch (error) {
      console.error(`[fn:admin] ❌ checkOnboardingState failed:`, error)
      throw error
    }
  })

// ============================================
// Portal Users Operations
// ============================================

/**
 * List portal users (users with role 'user').
 */
export const listPortalUsersFn = createServerFn({ method: 'GET' })
  .inputValidator(listPortalUsersSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:admin] listPortalUsersFn`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const result = await listPortalUsers({
        search: data.search,
        verified: data.verified,
        dateFrom: data.dateFrom ? new Date(data.dateFrom) : undefined,
        dateTo: data.dateTo ? new Date(data.dateTo) : undefined,
        emailDomain: data.emailDomain,
        postCount: data.postCount,
        voteCount: data.voteCount,
        commentCount: data.commentCount,
        customAttrs: data.customAttrs,
        sort: data.sort,
        page: data.page,
        limit: data.limit,
        segmentIds: data.segmentIds as SegmentId[] | undefined,
        includeAnonymous: data.includeAnonymous,
      })

      console.log(`[fn:admin] listPortalUsersFn: count=${result.items.length}`)
      // Serialize Date fields for client
      return {
        ...result,
        items: result.items.map((user) => ({
          ...user,
          joinedAt: toIsoString(user.joinedAt),
        })),
      }
    } catch (error) {
      console.error(`[fn:admin] ❌ listPortalUsersFn failed:`, error)
      throw error
    }
  })

/**
 * Get a portal user's details.
 */
export const getPortalUserFn = createServerFn({ method: 'GET' })
  .inputValidator(portalUserByIdSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:admin] getPortalUserFn: principalId=${data.principalId}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const result = await getPortalUserDetail(data.principalId as PrincipalId)

      // Serialize Date fields for client
      if (!result) {
        console.log(`[fn:admin] getPortalUserFn: not found`)
        return null
      }

      console.log(`[fn:admin] getPortalUserFn: found`)
      return {
        ...result,
        joinedAt: toIsoString(result.joinedAt),
        createdAt: toIsoString(result.createdAt),
        engagedPosts: result.engagedPosts.map((post) => ({
          ...post,
          createdAt: toIsoString(post.createdAt),
          engagedAt: toIsoString(post.engagedAt),
        })),
      }
    } catch (error) {
      console.error(`[fn:admin] ❌ getPortalUserFn failed:`, error)
      throw error
    }
  })

/**
 * List unified customer people (contacts + linked portal users + portal-only users).
 */
export const listCustomerPeopleFn = createServerFn({ method: 'GET' })
  .inputValidator(listCustomerPeopleSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:admin] listCustomerPeopleFn`)
    try {
      const ctx = await requireAuthWithPermissions()
      if (ctx.principal.role !== 'admin' && ctx.principal.role !== 'member') {
        throw new Error('Access denied: Requires [admin, member]')
      }
      const canViewCrm = hasPermission(ctx.permissions, PERMISSIONS.ORG_VIEW)
      const canViewTicketCounts = hasPermission(ctx.permissions, PERMISSIONS.TICKET_VIEW_ALL)
      const result = await listCustomerPeople({
        search: data.search,
        includeArchived: data.includeArchived,
        segmentIds: data.segmentIds as SegmentId[] | undefined,
        includeCrm: canViewCrm,
        includeTicketCounts: canViewTicketCounts,
        limit: data.limit,
        offset: data.offset,
      })
      return {
        ...result,
        items: result.items.map((item) => ({
          ...item,
          archivedAt: toIsoStringOrNull(item.archivedAt),
          linkedUsers: item.linkedUsers.map((linkedUser) => ({
            ...linkedUser,
            joinedAt: toIsoString(linkedUser.joinedAt),
          })),
        })),
      }
    } catch (error) {
      console.error(`[fn:admin] ❌ listCustomerPeopleFn failed:`, error)
      throw error
    }
  })

/**
 * Update a portal user's details (admin-only).
 */
const updatePortalUserSchema = z.object({
  principalId: z.string(),
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().nullable().optional(),
})

export const updatePortalUserFn = createServerFn({ method: 'POST' })
  .inputValidator(updatePortalUserSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:admin] updatePortalUserFn: principalId=${data.principalId}`)
    try {
      await requireAuth({ roles: ['admin'] })

      // Look up the principal to get userId
      const p = await db.query.principal.findFirst({
        where: eq(principal.id, data.principalId as PrincipalId),
        columns: { userId: true },
      })
      if (!p?.userId) throw new Error('User not found')

      // Build update set
      const updates: Record<string, unknown> = {}
      if (data.name !== undefined) updates.name = data.name.trim()
      if (data.email !== undefined) {
        // If setting an email, check uniqueness
        if (data.email !== null) {
          const normalized = data.email.toLowerCase().trim()
          const existing = await db
            .select({ id: user.id })
            .from(user)
            .where(eq(user.email, normalized))
            .limit(1)
          if (existing.length > 0 && existing[0].id !== p.userId) {
            throw new Error('Email already in use')
          }
          updates.email = normalized
        } else {
          updates.email = null
        }
      }

      if (Object.keys(updates).length === 0) {
        return { success: true }
      }

      await db.update(user).set(updates).where(eq(user.id, p.userId))

      // Sync display name to principal if name changed
      if (data.name !== undefined) {
        await db
          .update(principal)
          .set({ displayName: data.name.trim() })
          .where(eq(principal.id, data.principalId as PrincipalId))
      }

      console.log(`[fn:admin] updatePortalUserFn: updated`)
      return { success: true }
    } catch (error) {
      console.error(`[fn:admin] ❌ updatePortalUserFn failed:`, error)
      throw error
    }
  })

/**
 * Create a new portal user (admin-only).
 * Used by the AuthorSelector when the admin wants to attribute feedback to someone not yet in the system.
 */
const createPortalUserSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().optional(),
})

export const createPortalUserFn = createServerFn({ method: 'POST' })
  .inputValidator(createPortalUserSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:admin] createPortalUserFn: name=${data.name}`)
    try {
      await requireAuth({ roles: ['admin'] })

      // Check email uniqueness if provided
      if (data.email) {
        const normalized = data.email.toLowerCase().trim()
        const existing = await db
          .select({ id: user.id })
          .from(user)
          .where(eq(user.email, normalized))
          .limit(1)
        if (existing.length > 0) {
          throw new Error('A user with this email already exists')
        }
      }

      const userId = generateId('user')
      const principalId = generateId('principal')
      const trimmedName = data.name.trim()

      await db.insert(user).values({
        id: userId,
        name: trimmedName,
        email: data.email ? data.email.toLowerCase().trim() : null,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      await db.insert(principal).values({
        id: principalId,
        userId,
        role: 'user' as const,
        displayName: trimmedName,
        createdAt: new Date(),
      })

      console.log(`[fn:admin] createPortalUserFn: created principalId=${principalId}`)
      return {
        principalId: principalId as string,
        name: trimmedName,
        email: data.email?.toLowerCase().trim() ?? null,
      }
    } catch (error) {
      console.error(`[fn:admin] ❌ createPortalUserFn failed:`, error)
      throw error
    }
  })

/**
 * Delete (remove) a portal user.
 */
export const deletePortalUserFn = createServerFn({ method: 'POST' })
  .inputValidator(portalUserByIdSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:admin] deletePortalUserFn: principalId=${data.principalId}`)
    try {
      await requireAuth({ roles: ['admin'] })

      await removePortalUser(data.principalId as PrincipalId)

      console.log(`[fn:admin] deletePortalUserFn: deleted`)
      return { principalId: data.principalId }
    } catch (error) {
      console.error(`[fn:admin] ❌ deletePortalUserFn failed:`, error)
      throw error
    }
  })

// ============================================
// Invitation Operations
// ============================================

const sendInvitationSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(['admin', 'member']),
})

const invitationByIdSchema = z.object({
  // Use plain z.string() for TanStack Start compatibility
  // TypeID validation with .refine() creates ZodEffects which isn't supported in inputValidator
  invitationId: z.string(),
})

export type SendInvitationInput = z.infer<typeof sendInvitationSchema>
export type InvitationByIdInput = z.infer<typeof invitationByIdSchema>

/**
 * Generate a magic link for invitation authentication.
 * Uses Better Auth's API to generate the token and stores it for later URL construction.
 *
 * @param email - The invitee's email address
 * @param callbackPath - Relative path to redirect to after authentication (e.g., /complete-signup/{id})
 * @param portalUrl - The base portal URL (workspace domain)
 * @returns The magic link URL with the correct workspace domain
 */
async function generateInvitationMagicLink(
  email: string,
  callbackPath: string,
  portalUrl: string
): Promise<string> {
  console.log(
    `[fn:admin] generateInvitationMagicLink: email=${email}, callbackPath=${callbackPath}, portalUrl=${portalUrl}`
  )
  const { mintMagicLinkUrl } = await import('@/lib/server/auth/magic-link-mint')
  // Invitations reuse the same path for success + error so an
  // expired/consumed link sends the recipient back to the same
  // invitation page (with its own expired-state copy).
  return mintMagicLinkUrl({ email, callbackPath, portalUrl })
}

/**
 * Send a team invitation
 */
export const sendInvitationFn = createServerFn({ method: 'POST' })
  .inputValidator(sendInvitationSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:admin] sendInvitationFn: role=${data.role}`)
    try {
      const auth = await requireAuth({ roles: ['admin'] })

      // Tier-limit gate (no-op in OSS).
      const { enforceSeatLimit } = await import('@/lib/server/domains/principals/seat-limit')
      await enforceSeatLimit()

      const email = data.email.toLowerCase()

      // Parallelize invitation and user validation queries
      const [existingInvitation, existingUser] = await Promise.all([
        db.query.invitation.findFirst({
          where: and(
            eq(invitation.email, email),
            eq(invitation.status, 'pending'),
            eq(invitation.kind, 'team')
          ),
        }),
        db.query.user.findFirst({
          where: eq(user.email, email),
        }),
      ])

      if (existingInvitation) {
        throw new Error('An invitation has already been sent to this email')
      }

      if (existingUser) {
        // Check if they already have a team member role (admin or member)
        const existingPrincipal = await db.query.principal.findFirst({
          where: eq(principal.userId, existingUser.id),
        })

        if (existingPrincipal && existingPrincipal.role !== 'user') {
          throw new Error('A team member with this email already exists')
        }
        // Portal users (role='user' or no member record) can be invited to become team members
      }

      const invitationId = generateId('invite')
      const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_MS)
      const now = new Date()

      await db.insert(invitation).values({
        id: invitationId,
        email,
        name: data.name || null,
        role: data.role,
        status: 'pending',
        expiresAt,
        lastSentAt: now,
        inviterId: auth.user.id,
        createdAt: now,
      })

      // Generate magic link for one-click authentication
      const portalUrl = getBaseUrl()
      const callbackURL = `/complete-signup/${invitationId}`
      const inviteLink = await generateInvitationMagicLink(email, callbackURL, portalUrl)

      const { getEmailSafeUrl } = await import('@/lib/server/storage/s3')
      const logoUrl = getEmailSafeUrl(auth.settings.logoKey) ?? undefined
      const result = await sendInvitationEmail({
        to: email,
        invitedByName: auth.user.name,
        inviteeName: data.name || undefined,
        workspaceName: auth.settings.name,
        inviteLink,
        logoUrl,
      })

      console.log(
        `[fn:admin] sendInvitationFn: ${result.sent ? 'sent' : 'created (email not configured)'} id=${invitationId}`
      )
      return {
        invitationId,
        emailSent: result.sent,
        inviteLink: !result.sent ? inviteLink : undefined,
      }
    } catch (error) {
      console.error(`[fn:admin] ❌ sendInvitationFn failed:`, error)
      throw error
    }
  })

/**
 * Cancel a pending invitation
 */
export const cancelInvitationFn = createServerFn({ method: 'POST' })
  .inputValidator(invitationByIdSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:admin] cancelInvitationFn: id=${data.invitationId}`)
    try {
      await requireAuth({ roles: ['admin'] })

      const invitationId = data.invitationId as InviteId

      const invitationRecord = await db.query.invitation.findFirst({
        where: and(
          eq(invitation.id, invitationId),
          eq(invitation.status, 'pending'),
          eq(invitation.kind, 'team')
        ),
      })

      if (!invitationRecord) {
        throw new Error('Invitation not found')
      }

      // TOCTOU pin: status='pending' in the WHERE so a concurrent
      // accept (Better Auth's magic-link verify) isn't silently
      // overwritten to 'canceled'. Mirrors the portal-side cancel in
      // functions/portal-invites.ts:256 which had this pin from day
      // one. `.returning()` lets us treat zero rows as "lost the race"
      // so the response doesn't lie about success.
      const cancelled = await db
        .update(invitation)
        .set({ status: 'canceled' })
        .where(
          and(
            eq(invitation.id, invitationId),
            eq(invitation.kind, 'team'),
            eq(invitation.status, 'pending')
          )
        )
        .returning({ id: invitation.id })

      if (cancelled.length === 0) {
        throw new Error('Invitation is no longer pending — refresh and try again')
      }

      console.log(`[fn:admin] cancelInvitationFn: canceled`)
      return { invitationId }
    } catch (error) {
      console.error(`[fn:admin] ❌ cancelInvitationFn failed:`, error)
      throw error
    }
  })

/**
 * Resend an invitation email
 */
export const resendInvitationFn = createServerFn({ method: 'POST' })
  .inputValidator(invitationByIdSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:admin] resendInvitationFn: id=${data.invitationId}`)
    try {
      const auth = await requireAuth({ roles: ['admin'] })

      const invitationId = data.invitationId as InviteId

      const invitationRecord = await db.query.invitation.findFirst({
        where: and(
          eq(invitation.id, invitationId),
          eq(invitation.status, 'pending'),
          eq(invitation.kind, 'team')
        ),
      })

      if (!invitationRecord) {
        throw new Error('Invitation not found')
      }

      // Claim-then-send ordering — see resendPortalInviteFn for the
      // full rationale. Mint the magic link AFTER the UPDATE succeeds
      // so a concurrent accept/cancel during the SMTP window can't
      // leak a live link for a row the server now considers terminal.
      // The UPDATE WHERE pins both status='pending' AND expiresAt > now()
      // so neither a terminal-state flip nor an expiry that landed
      // between SELECT and UPDATE can be silently extended.
      const resendNow = new Date()
      const freshExpiresAt = new Date(resendNow.getTime() + INVITATION_EXPIRY_MS)
      const updated = await db
        .update(invitation)
        .set({ lastSentAt: resendNow, expiresAt: freshExpiresAt })
        .where(
          and(
            eq(invitation.id, invitationId),
            eq(invitation.kind, 'team'),
            eq(invitation.status, 'pending'),
            gt(invitation.expiresAt, resendNow)
          )
        )
        .returning({ id: invitation.id })

      if (updated.length === 0) {
        throw new Error('Invitation is no longer pending — refresh and try again')
      }

      // Generate new magic link for one-click authentication
      const portalUrl = getBaseUrl()
      const callbackURL = `/complete-signup/${invitationId}`
      const inviteLink = await generateInvitationMagicLink(
        invitationRecord.email,
        callbackURL,
        portalUrl
      )

      const { getEmailSafeUrl } = await import('@/lib/server/storage/s3')
      const logoUrl = getEmailSafeUrl(auth.settings.logoKey) ?? undefined
      const result = await sendInvitationEmail({
        to: invitationRecord.email,
        invitedByName: auth.user.name,
        inviteeName: invitationRecord.name || undefined,
        workspaceName: auth.settings.name,
        inviteLink,
        logoUrl,
      })

      console.log(
        `[fn:admin] resendInvitationFn: ${result.sent ? 'resent' : 'regenerated (email not configured)'}`
      )
      return {
        invitationId,
        emailSent: result.sent,
        inviteLink: !result.sent ? inviteLink : undefined,
      }
    } catch (error) {
      console.error(`[fn:admin] ❌ resendInvitationFn failed:`, error)
      throw error
    }
  })

// ============================================
// Segment Operations
// ============================================

const segmentByIdSchema = z.object({
  segmentId: z.string(),
})

// Shared condition schema used by both create and update
export const segmentConditionSchema = z.object({
  attribute: z.enum([
    'email',
    'email_verified',
    'created_at_days_ago',
    'post_count',
    'vote_count',
    'comment_count',
    'metadata_key',
    'name',
    'locale',
    'country',
    'last_active_days_ago',
    'signup_source',
    'principal_type',
    'contact_title',
    'contact_metadata_key',
    'organization_domain',
    'organization_external_id',
    'organization_metadata_key',
  ]),
  operator: z.enum([
    'eq',
    'neq',
    'lt',
    'lte',
    'gt',
    'gte',
    'contains',
    'starts_with',
    'ends_with',
    'in',
    'is_set',
    'is_not_set',
  ]),
  // value is optional for presence operators (is_set / is_not_set)
  value: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))])
    .optional(),
  metadataKey: z.string().optional(),
})

const segmentRulesSchema = z.object({
  match: z.enum(['all', 'any']),
  conditions: z.array(segmentConditionSchema),
})

const CRON_REGEX =
  /^(\*|[0-9,\-/]+)\s+(\*|[0-9,\-/]+)\s+(\*|[0-9,\-/]+)\s+(\*|[0-9,\-/]+)\s+(\*|[0-9,\-/]+)(\s+(\*|[0-9,\-/]+))?$/

const evaluationScheduleSchema = z.object({
  enabled: z.boolean(),
  pattern: z.string().min(1).regex(CRON_REGEX, 'Must be a valid cron expression'),
})

const userAttributeDefinitionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'date', 'currency']),
  currencyCode: z
    .enum(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'BRL'])
    .optional(),
})

const weightConfigSchema = z.object({
  attribute: userAttributeDefinitionSchema,
  aggregation: z.enum(['sum', 'average', 'count', 'median']),
})

export const createSegmentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['manual', 'dynamic']),
  color: z.string().optional(),
  rules: segmentRulesSchema.optional(),
  evaluationSchedule: evaluationScheduleSchema.optional(),
  weightConfig: weightConfigSchema.optional(),
})

const updateSegmentSchema = z.object({
  segmentId: z.string(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  color: z.string().optional(),
  rules: segmentRulesSchema.nullable().optional(),
  evaluationSchedule: evaluationScheduleSchema.nullable().optional(),
  weightConfig: weightConfigSchema.nullable().optional(),
})

const assignUsersSchema = z.object({
  segmentId: z.string(),
  principalIds: z.array(z.string()).min(1),
})

/**
 * Distinct-value typeahead for the segment rule-builder. Returns the
 * most-common existing values for the given attribute among portal
 * users, optionally prefix-filtered by `query`. Drives the
 * SearchableInput in the segment edit dialog so admins see what
 * values are actually present in their workspace as they type.
 */
const fetchSegmentAttributeValuesSchema = z.object({
  attribute: z.enum([
    'country',
    'locale',
    'name',
    'email',
    'signup_source',
    'contact_title',
    'organization_domain',
    'organization_external_id',
  ]),
  query: z.string().max(200).default(''),
  limit: z.number().int().min(1).max(50).default(20),
})

export const fetchSegmentAttributeValuesFn = createServerFn({ method: 'GET' })
  .inputValidator(fetchSegmentAttributeValuesSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })
    const { getAttributeValueSuggestions } =
      await import('@/lib/server/domains/segments/segment-attribute-values')
    return { values: await getAttributeValueSuggestions(data.attribute, data.query, data.limit) }
  })

/**
 * List all segments with member counts.
 */
export const listSegmentsFn = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:admin] listSegmentsFn`)
  try {
    await requireAuth({ roles: ['admin', 'member'] })
    const result = await listSegments()
    console.log(`[fn:admin] listSegmentsFn: count=${result.length}`)
    return result.map((seg) => ({
      ...seg,
      createdAt: toIsoString(seg.createdAt),
      updatedAt: toIsoString(seg.updatedAt),
    }))
  } catch (error) {
    console.error(`[fn:admin] ❌ listSegmentsFn failed:`, error)
    throw error
  }
})

/**
 * Create a new segment.
 */
export const createSegmentFn = createServerFn({ method: 'POST' })
  .inputValidator(createSegmentSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:admin] createSegmentFn: name=${data.name}`)
    try {
      await requireAuth({ roles: ['admin'] })
      const segment = await createSegment(data as CreateSegmentInput)

      // Set up auto-evaluation schedule if configured
      if (segment.type === 'dynamic' && segment.evaluationSchedule?.enabled) {
        await upsertSegmentEvaluationSchedule(
          segment.id as SegmentId,
          segment.evaluationSchedule
        ).catch((err) => console.error(`[fn:admin] Failed to set up evaluation schedule:`, err))
      }

      console.log(`[fn:admin] createSegmentFn: created id=${segment.id}`)
      return {
        ...segment,
        createdAt: toIsoString(segment.createdAt),
        updatedAt: toIsoString(segment.updatedAt),
      }
    } catch (error) {
      console.error(`[fn:admin] ❌ createSegmentFn failed:`, error)
      throw error
    }
  })

/**
 * Update an existing segment.
 */
export const updateSegmentFn = createServerFn({ method: 'POST' })
  .inputValidator(updateSegmentSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:admin] updateSegmentFn: segmentId=${data.segmentId}`)
    try {
      await requireAuth({ roles: ['admin'] })
      const { segmentId, ...updates } = data
      const segment = await updateSegment(segmentId as SegmentId, updates as UpdateSegmentInput)

      // Update evaluation schedule
      if (updates.evaluationSchedule !== undefined) {
        if (segment.evaluationSchedule?.enabled) {
          await upsertSegmentEvaluationSchedule(
            segmentId as SegmentId,
            segment.evaluationSchedule
          ).catch((err) => console.error(`[fn:admin] Failed to update evaluation schedule:`, err))
        } else {
          await removeSegmentEvaluationSchedule(segmentId as SegmentId).catch((err) =>
            console.error(`[fn:admin] Failed to remove evaluation schedule:`, err)
          )
        }
      }

      console.log(`[fn:admin] updateSegmentFn: updated`)
      return {
        ...segment,
        createdAt: toIsoString(segment.createdAt),
        updatedAt: toIsoString(segment.updatedAt),
      }
    } catch (error) {
      console.error(`[fn:admin] ❌ updateSegmentFn failed:`, error)
      throw error
    }
  })

/**
 * Delete a segment.
 */
export const deleteSegmentFn = createServerFn({ method: 'POST' })
  .inputValidator(segmentByIdSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:admin] deleteSegmentFn: segmentId=${data.segmentId}`)
    try {
      await requireAuth({ roles: ['admin'] })

      await deleteSegment(data.segmentId as SegmentId)
      console.log(`[fn:admin] deleteSegmentFn: deleted`)
      return { segmentId: data.segmentId }
    } catch (error) {
      console.error(`[fn:admin] ❌ deleteSegmentFn failed:`, error)
      throw error
    }
  })

/**
 * Assign users to a manual segment.
 */
export const assignUsersToSegmentFn = createServerFn({ method: 'POST' })
  .inputValidator(assignUsersSchema)
  .handler(async ({ data }) => {
    console.log(
      `[fn:admin] assignUsersToSegmentFn: segmentId=${data.segmentId}, count=${data.principalIds.length}`
    )
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })
      const { actorFromAuth } = await import('@/lib/server/audit/log')
      const { assigned } = await assignUsersToSegment(
        data.segmentId as SegmentId,
        data.principalIds as PrincipalId[],
        actorFromAuth(auth),
        getRequestHeaders()
      )
      console.log(`[fn:admin] assignUsersToSegmentFn: assigned=${assigned}`)
      return { segmentId: data.segmentId, assigned }
    } catch (error) {
      console.error(`[fn:admin] ❌ assignUsersToSegmentFn failed:`, error)
      throw error
    }
  })

/**
 * Remove users from a manual segment.
 */
export const removeUsersFromSegmentFn = createServerFn({ method: 'POST' })
  .inputValidator(assignUsersSchema)
  .handler(async ({ data }) => {
    console.log(
      `[fn:admin] removeUsersFromSegmentFn: segmentId=${data.segmentId}, count=${data.principalIds.length}`
    )
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })
      const { actorFromAuth } = await import('@/lib/server/audit/log')
      const { removed } = await removeUsersFromSegment(
        data.segmentId as SegmentId,
        data.principalIds as PrincipalId[],
        actorFromAuth(auth),
        getRequestHeaders()
      )
      console.log(`[fn:admin] removeUsersFromSegmentFn: removed=${removed}`)
      return { segmentId: data.segmentId, removed }
    } catch (error) {
      console.error(`[fn:admin] ❌ removeUsersFromSegmentFn failed:`, error)
      throw error
    }
  })

/**
 * Trigger re-evaluation of a dynamic segment.
 */
export const evaluateSegmentFn = createServerFn({ method: 'POST' })
  .inputValidator(segmentByIdSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:admin] evaluateSegmentFn: segmentId=${data.segmentId}`)
    try {
      await requireAuth({ roles: ['admin'] })
      const result = await evaluateDynamicSegment(data.segmentId as SegmentId)
      console.log(`[fn:admin] evaluateSegmentFn: added=${result.added}, removed=${result.removed}`)
      return result
    } catch (error) {
      console.error(`[fn:admin] ❌ evaluateSegmentFn failed:`, error)
      throw error
    }
  })

/**
 * Trigger re-evaluation of all dynamic segments.
 */
export const evaluateAllSegmentsFn = createServerFn({ method: 'POST' }).handler(async () => {
  console.log(`[fn:admin] evaluateAllSegmentsFn`)
  try {
    await requireAuth({ roles: ['admin'] })
    const results = await evaluateAllDynamicSegments()
    console.log(`[fn:admin] evaluateAllSegmentsFn: evaluated ${results.length} segments`)
    return results
  } catch (error) {
    console.error(`[fn:admin] ❌ evaluateAllSegmentsFn failed:`, error)
    throw error
  }
})

// ============================================
// User Attribute Definitions
// ============================================

const userAttributeIdSchema = z.object({
  id: z.string().min(1),
})

const createUserAttributeSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  type: z.enum(['string', 'number', 'boolean', 'date', 'currency']),
  currencyCode: z
    .enum(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'BRL'])
    .optional(),
  externalKey: z.string().max(256).optional().nullable(),
})

const updateUserAttributeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(128).optional(),
  description: z.string().max(512).optional().nullable(),
  type: z.enum(['string', 'number', 'boolean', 'date', 'currency']).optional(),
  currencyCode: z
    .enum(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'BRL'])
    .optional()
    .nullable(),
  externalKey: z.string().max(256).optional().nullable(),
})

/**
 * List all user attribute definitions.
 */
export const listUserAttributesFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    await requireAuth({ roles: ['admin', 'member'] })
    return listUserAttributes()
  } catch (error) {
    console.error('[fn:admin] ❌ listUserAttributesFn failed:', error)
    throw error
  }
})

/**
 * Create a new user attribute definition.
 */
export const createUserAttributeFn = createServerFn({ method: 'POST' })
  .inputValidator(createUserAttributeSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth({ roles: ['admin'] })
      return createUserAttribute({
        key: data.key,
        label: data.label,
        description: data.description,
        type: data.type,
        currencyCode: data.currencyCode,
        externalKey: data.externalKey,
      })
    } catch (error) {
      console.error('[fn:admin] ❌ createUserAttributeFn failed:', error)
      throw error
    }
  })

/**
 * Update an existing user attribute definition.
 */
export const updateUserAttributeFn = createServerFn({ method: 'POST' })
  .inputValidator(updateUserAttributeSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth({ roles: ['admin'] })
      return updateUserAttribute(data.id as UserAttributeId, {
        label: data.label,
        description: data.description,
        type: data.type,
        currencyCode: data.currencyCode,
        externalKey: data.externalKey,
      })
    } catch (error) {
      console.error('[fn:admin] ❌ updateUserAttributeFn failed:', error)
      throw error
    }
  })

/**
 * Delete a user attribute definition.
 */
export const deleteUserAttributeFn = createServerFn({ method: 'POST' })
  .inputValidator(userAttributeIdSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth({ roles: ['admin'] })
      await deleteUserAttribute(data.id as UserAttributeId)
      return { deleted: true }
    } catch (error) {
      console.error('[fn:admin] ❌ deleteUserAttributeFn failed:', error)
      throw error
    }
  })
