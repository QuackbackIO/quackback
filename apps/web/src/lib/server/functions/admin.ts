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
import type { BoardId, PostTagId } from '@quackback/ids'
import {
  getSetupState,
  isOnboardingComplete as checkComplete,
  type BoardSettings,
} from '@/lib/server/db'
import type { TiptapContent } from '@/lib/shared/schemas/posts'
import { requireAuth } from './auth-helpers'
import { getSettings } from './workspace'
import { db, invitation, principal, user, eq, and, gt } from '@/lib/server/db'
import {
  createPrincipal,
  ensurePrincipalForUser,
  setPrincipalRole,
  syncPrincipalProfileById,
} from '@/lib/server/domains/principals/principal.factory'
import { isAdmin } from '@/lib/shared/roles'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { listInboxPosts } from '@/lib/server/domains/posts/post.inbox'
import { listBoards } from '@/lib/server/domains/boards/board.service'
import { listPostTags } from '@/lib/server/domains/post-tags/post-tag.service'
import { listStatuses } from '@/lib/server/domains/statuses/status.service'
import {
  listTeamMembers,
  searchPeople,
  updateMemberRole,
  removeTeamMember,
} from '@/lib/server/domains/principals/principal.service'
import { listPortalUsers, removePortalUser } from '@/lib/server/domains/users/user.service'
import { getPortalUserDetail } from '@/lib/server/domains/users/user.detail'
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
import type { UserAttributeId } from '@quackback/ids'
import { sendInvitationEmail } from '@quackback/email'
import { getBaseUrl } from '@/lib/server/config'
import {
  INVITATION_EXPIRY_MS,
  generateInvitationMagicLink,
  appendInviteMagicLinkToken,
  removeInviteMagicLinkToken,
} from './invitation-magic-link'
import { logger } from '@/lib/server/logger'

/**
 * Server functions for admin data fetching.
 * All functions require authentication and team member role (admin or member).
 */

const log = logger.child({ component: 'admin' })

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
    .enum([
      'newest',
      'oldest',
      'most_active',
      'last_active',
      'most_posts',
      'most_comments',
      'most_votes',
      'name',
    ])
    .optional(),
  page: z.number().optional(),
  limit: z.number().optional(),
  segmentIds: z.array(z.string()).optional(),
  lifecycle: z.enum(['users', 'leads']).optional(),
})

const portalUserByIdSchema = z.object({
  principalId: z.string(),
})

/**
 * Fetch inbox posts with filters for admin feedback view
 */
export const fetchInboxPosts = createServerFn({ method: 'GET' })
  .validator(inboxPostListSchema)
  .handler(async ({ data }) => {
    log.debug({ sort: data.sort, cursor: data.cursor ?? 'none' }, 'fetch inbox posts')
    try {
      await requireAuth({ permission: PERMISSIONS.POST_VIEW_PRIVATE })

      const result = await listInboxPosts({
        boardIds: data.boardIds as BoardId[] | undefined,
        statusSlugs: data.statusSlugs,
        tagIds: data.tagIds as PostTagId[] | undefined,
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
      log.debug({ count: result.items.length }, 'fetch inbox posts')
      // Serialize contentJson field and Date fields
      return {
        ...result,
        items: result.items.map((p) => ({
          ...p,
          contentJson: (p.contentJson ?? {}) as TiptapContent,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
          deletedAt: p.deletedAt?.toISOString() || null,
        })),
      }
    } catch (error) {
      log.error({ err: error }, 'fetch inbox posts failed')
      throw error
    }
  })

/**
 * Fetch all boards for the organization
 */
export const fetchBoardsList = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch boards list')
  try {
    await requireAuth({ permission: PERMISSIONS.BOARD_MANAGE })

    const result = await listBoards()
    log.debug({ count: result.length }, 'fetch boards list')
    return result.map((b) => ({
      ...b,
      settings: (b.settings ?? {}) as BoardSettings,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    }))
  } catch (error) {
    log.error({ err: error }, 'fetch boards list failed')
    throw error
  }
})

/**
 * Fetch all tags for the organization
 */
export const fetchTagsList = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch tags list')
  try {
    await requireAuth({ permission: PERMISSIONS.TAG_VIEW })

    const result = await listPostTags()
    log.debug({ count: result.length }, 'fetch tags list')
    return result
  } catch (error) {
    log.error({ err: error }, 'fetch tags list failed')
    throw error
  }
})

/**
 * Fetch all statuses for the organization
 */
export const fetchStatusesList = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch statuses list')
  try {
    await requireAuth({ permission: PERMISSIONS.STATUS_VIEW })

    const result = await listStatuses()
    log.debug({ count: result.length }, 'fetch statuses list')
    return result
  } catch (error) {
    log.error({ err: error }, 'fetch statuses list failed')
    throw error
  }
})

/**
 * Fetch team members (not portal users)
 */
export const fetchTeamMembers = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch team members')
  try {
    await requireAuth({ permission: PERMISSIONS.MEMBER_VIEW })

    const result = await listTeamMembers()
    log.debug({ count: result.length }, 'fetch team members')
    return result
  } catch (error) {
    log.error({ err: error }, 'fetch team members failed')
    throw error
  }
})

const searchPeopleSchema = z.object({
  search: z.string().optional(),
  limit: z.number().optional(),
})

// People search (portal users included) for on-behalf pickers, so the gate is
// people.view, not member.view; every teammate preset holds both.
export const searchPeopleFn = createServerFn({ method: 'GET' })
  .validator(searchPeopleSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.PEOPLE_VIEW })
    return searchPeople(data)
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
  .validator(updatePrincipalRoleSchema)
  .handler(async ({ data }) => {
    log.info({ principal_id: data.principalId, role: data.role }, 'update member role')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.MEMBER_MANAGE })
      const { actorFromAuth } = await import('@/lib/server/audit/log')

      await updateMemberRole(
        data.principalId as PrincipalId,
        data.role,
        auth.principal.id,
        actorFromAuth(auth),
        getRequestHeaders()
      )

      log.info({ principal_id: data.principalId, role: data.role }, 'member role updated')
      return { principalId: data.principalId, role: data.role }
    } catch (error) {
      log.error({ err: error }, 'update member role failed')
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
  .validator(forceSignOutInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.AUTH_MANAGE })
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
  .validator(principalIdSchema)
  .handler(async ({ data }) => {
    log.info({ principal_id: data.principalId }, 'remove team member')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.MEMBER_MANAGE })
      const { actorFromAuth } = await import('@/lib/server/audit/log')

      await removeTeamMember(
        data.principalId as PrincipalId,
        auth.principal.id,
        actorFromAuth(auth),
        getRequestHeaders()
      )

      log.info({ principal_id: data.principalId }, 'member removed')
      return { principalId: data.principalId }
    } catch (error) {
      log.error({ err: error }, 'remove team member failed')
      throw error
    }
  })

/**
 * Check onboarding completion status
 */
export const fetchOnboardingStatus = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch onboarding status')
  try {
    await requireAuth({ permission: PERMISSIONS.MEMBER_VIEW })

    const [orgBoards, members] = await Promise.all([
      db.query.boards.findMany({
        columns: { id: true },
      }),
      db.select({ id: principal.id }).from(principal),
    ])

    log.debug(
      { has_boards: orgBoards.length > 0, member_count: members.length },
      'fetch onboarding status'
    )
    return {
      hasBoards: orgBoards.length > 0,
      memberCount: members.length,
    }
  } catch (error) {
    log.error({ err: error }, 'fetch onboarding status failed')
    throw error
  }
})

/**
 * Fetch boards list for settings page
 */
export const fetchBoardsForSettings = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch boards for settings')
  try {
    await requireAuth({ permission: PERMISSIONS.BOARD_MANAGE })

    const orgBoards = await listBoards()
    log.debug({ count: orgBoards.length }, 'fetch boards for settings')
    return orgBoards.map((b) => ({
      ...b,
      settings: (b.settings ?? {}) as BoardSettings,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    }))
  } catch (error) {
    log.error({ err: error }, 'fetch boards for settings failed')
    throw error
  }
})

/**
 * Fetch integrations list
 */
export const fetchIntegrationsList = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch integrations list')
  try {
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_VIEW })

    const results = await db.query.integrations.findMany()
    log.debug({ count: results.length }, 'fetch integrations list')
    return results.map((i) => ({
      id: i.id,
      integrationType: i.integrationType,
      status: i.status,
      workspaceName: (i.config as Record<string, unknown>)?.workspaceName as string | undefined,
      connectedAt: i.connectedAt,
    }))
  } catch (error) {
    log.error({ err: error }, 'fetch integrations list failed')
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
  .validator(z.object({ type: z.string() }))
  .handler(async ({ data }) => {
    log.debug({ type: data.type }, 'fetch integration by type')
    try {
      // integration.manage (admin-only), not integration.view: this returns the
      // raw integration.config, which holds live OAuth/bot tokens. A Manager-tier
      // read permission must never see those.
      await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

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
        log.debug({ type: data.type }, 'fetch integration by type not found')
        return {
          integration: null,
          platformCredentialFields,
          platformCredentialsConfigured,
        }
      }

      log.debug({ type: data.type, id: integration.id }, 'fetch integration by type found')

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
      log.error({ err: error }, 'fetch integration by type failed')
      throw error
    }
  })

/**
 * Public auth configuration surface for the unauthenticated onboarding
 * shell. Tells the client whether SSO is configured + usable so the
 * account-creation step can offer the one-click button instead of the
 * manual Jane-Doe form. Only non-secret signals are returned.
 *
 * `ssoEnabled` reflects whether the `sso` provider is registered — the same
 * `getRegisteredOidcProviderIds` gate the auth engine and enforcement use
 * (enabled + credentials + `customOidcProvider` tier). It is scoped to `'sso'`
 * specifically because the onboarding button hardcodes
 * `signIn.oauth2({ providerId: 'sso' })`: a true here must mean *that* provider
 * is callable, not merely that some other (`custom-oidc` / `oidc_*`) provider
 * exists. Reading the registry (not the legacy `authConfig.ssoOidc` blob) means
 * the legacy-config cleanup can run without breaking the button. In practice
 * this is rarely true at first onboarding (no admin yet to configure SSO) — but
 * a re-onboard against an existing tenant DB will use SSO when it's registered.
 */
export const getPublicAuthConfig = createServerFn({ method: 'GET' }).handler(async () => {
  const { getRegisteredOidcProviderIds } = await import('@/lib/server/auth/registered-providers')
  const ssoEnabled = (await getRegisteredOidcProviderIds()).has('sso')
  return { ssoEnabled }
})

/**
 * Check onboarding state for a user
 * Returns member record, step, and whether boards exist
 * Note: This function is called during onboarding and may create member records
 */
export const checkOnboardingState = createServerFn({ method: 'GET' })
  .validator(z.string().optional())
  .handler(async ({ data }) => {
    log.debug('check onboarding state')
    try {
      // Allow unauthenticated access for onboarding
      const userId = data

      if (!userId) {
        log.debug('check onboarding state no user id')
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
          log.debug({ needs_invitation: true }, 'check onboarding state')
          return {
            principalRecord: null,
            needsInvitation: true,
            hasSettings: false,
            setupState: null,
            isOnboardingComplete: false,
          }
        }

        // First user - create admin principal record (race-safe).
        const { principal: newPrincipal, created } = await ensurePrincipalForUser({
          userId: userId as UserId,
          role: 'admin',
        })
        // A concurrent lazy create may have seeded role 'user'; promote so the
        // first user still lands as admin.
        if (!created && !isAdmin(newPrincipal.role)) {
          await setPrincipalRole({ userId: userId as UserId }, 'admin')
          newPrincipal.role = 'admin'
        }
        principalRecord = newPrincipal
        log.info({ principal_id: principalRecord.id }, 'created admin principal')
      }

      // Get settings to check setup state
      const currentSettings = await getSettings()
      const setupState = getSetupState(currentSettings?.setupState ?? null)
      const isOnboardingComplete = checkComplete(setupState)

      log.debug(
        { setup_state: setupState, is_complete: isOnboardingComplete },
        'check onboarding state'
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
      log.error({ err: error }, 'check onboarding state failed')
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
  .validator(listPortalUsersSchema)
  .handler(async ({ data }) => {
    log.debug('list portal users')
    try {
      await requireAuth({ permission: PERMISSIONS.PEOPLE_VIEW })

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
        lifecycle: data.lifecycle,
      })

      log.debug({ count: result.items.length }, 'list portal users')
      // Serialize Date fields for client
      return {
        ...result,
        items: result.items.map((user) => ({
          ...user,
          joinedAt: user.joinedAt.toISOString(),
          lastSeenAt: user.lastSeenAt ? user.lastSeenAt.toISOString() : null,
        })),
      }
    } catch (error) {
      log.error({ err: error }, 'list portal users failed')
      throw error
    }
  })

/**
 * Get a portal user's details.
 */
export const getPortalUserFn = createServerFn({ method: 'GET' })
  .validator(portalUserByIdSchema)
  .handler(async ({ data }) => {
    log.debug({ principal_id: data.principalId }, 'get portal user')
    try {
      await requireAuth({ permission: PERMISSIONS.PEOPLE_VIEW })

      const result = await getPortalUserDetail(data.principalId as PrincipalId)

      // Serialize Date fields for client
      if (!result) {
        log.debug({ principal_id: data.principalId }, 'get portal user not found')
        return null
      }

      log.debug({ principal_id: data.principalId }, 'get portal user found')
      return {
        ...result,
        joinedAt: result.joinedAt.toISOString(),
        createdAt: result.createdAt.toISOString(),
        engagedPosts: result.engagedPosts.map((post) => ({
          ...post,
          createdAt: post.createdAt.toISOString(),
          engagedAt: post.engagedAt.toISOString(),
        })),
      }
    } catch (error) {
      log.error({ err: error }, 'get portal user failed')
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
  .validator(updatePortalUserSchema)
  .handler(async ({ data }) => {
    log.info({ principal_id: data.principalId }, 'update portal user')
    try {
      await requireAuth({ permission: PERMISSIONS.PEOPLE_MANAGE })

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
        await syncPrincipalProfileById(data.principalId as PrincipalId, {
          displayName: data.name.trim(),
        })
      }

      log.info({ principal_id: data.principalId }, 'portal user updated')
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'update portal user failed')
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
  .validator(createPortalUserSchema)
  .handler(async ({ data }) => {
    log.info({ name: data.name }, 'create portal user')
    try {
      await requireAuth({ permission: PERMISSIONS.PEOPLE_MANAGE })

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

      await createPrincipal({
        id: principalId,
        userId,
        role: 'user',
        displayName: trimmedName,
      })

      log.info({ principal_id: principalId }, 'portal user created')
      return {
        principalId: principalId as string,
        name: trimmedName,
        email: data.email?.toLowerCase().trim() ?? null,
      }
    } catch (error) {
      log.error({ err: error }, 'create portal user failed')
      throw error
    }
  })

/**
 * Delete (remove) a portal user.
 */
export const deletePortalUserFn = createServerFn({ method: 'POST' })
  .validator(portalUserByIdSchema)
  .handler(async ({ data }) => {
    log.info({ principal_id: data.principalId }, 'delete portal user')
    try {
      await requireAuth({ permission: PERMISSIONS.PEOPLE_MANAGE })

      await removePortalUser(data.principalId as PrincipalId)

      log.info({ principal_id: data.principalId }, 'portal user deleted')
      return { principalId: data.principalId }
    } catch (error) {
      log.error({ err: error }, 'delete portal user failed')
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
  // TypeID validation with .refine() creates ZodEffects which isn't supported in validator
  invitationId: z.string(),
})

export type SendInvitationInput = z.infer<typeof sendInvitationSchema>
export type InvitationByIdInput = z.infer<typeof invitationByIdSchema>

/**
 * Send a team invitation
 */
export const sendInvitationFn = createServerFn({ method: 'POST' })
  .validator(sendInvitationSchema)
  .handler(async ({ data }) => {
    log.info({ role: data.role }, 'send invitation')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.MEMBER_MANAGE })

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

      // Mint the magic link before the insert so the row records its token in
      // its token set (cancel revokes every token in the set). invitationId is
      // fixed above, so the callback path is already known.
      const portalUrl = getBaseUrl()
      const callbackURL = `/complete-signup/${invitationId}`
      const { url: inviteLink, token: magicLinkToken } = await generateInvitationMagicLink(
        email,
        callbackURL,
        portalUrl
      )

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
        magicLinkTokens: [magicLinkToken],
      })

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

      log.info({ invitation_id: invitationId, sent: result.sent }, 'invitation sent')
      return {
        invitationId,
        emailSent: result.sent,
        inviteLink: !result.sent ? inviteLink : undefined,
      }
    } catch (error) {
      log.error({ err: error }, 'send invitation failed')
      throw error
    }
  })

/**
 * Cancel a pending invitation
 */
export const cancelInvitationFn = createServerFn({ method: 'POST' })
  .validator(invitationByIdSchema)
  .handler(async ({ data }) => {
    log.info({ invitation_id: data.invitationId }, 'cancel invitation')
    try {
      await requireAuth({ permission: PERMISSIONS.MEMBER_MANAGE })

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
        .returning({ id: invitation.id, magicLinkTokens: invitation.magicLinkTokens })

      if (cancelled.length === 0) {
        throw new Error('Invitation is no longer pending — refresh and try again')
      }

      // Invalidate every link this invite ever minted, so a cancelled invite
      // can't sign anyone in. Revoking the full set (returned atomically by the
      // status flip) closes the resend/copy/worker-restart windows where a
      // single rotating pointer could leave a token live but untracked.
      const { revokeMagicLinkTokens } = await import('@/lib/server/auth/magic-link-mint')
      await revokeMagicLinkTokens(cancelled[0].magicLinkTokens)

      log.info({ invitation_id: invitationId }, 'invitation canceled')
      return { invitationId }
    } catch (error) {
      log.error({ err: error }, 'cancel invitation failed')
      throw error
    }
  })

/**
 * Resend an invitation email
 */
export const resendInvitationFn = createServerFn({ method: 'POST' })
  .validator(invitationByIdSchema)
  .handler(async ({ data }) => {
    log.info({ invitation_id: data.invitationId }, 'resend invitation')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.MEMBER_MANAGE })

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

      // Generate a new magic link and add it to the invite's token set. Prior
      // tokens are left intact (resend is additive, not destructive) — both the
      // old and new links work until the invite is accepted, cancelled, or
      // expires. The token is recorded the moment it's minted, so even if the
      // send below fails or the worker restarts, cancellation still revokes it.
      const portalUrl = getBaseUrl()
      const callbackURL = `/complete-signup/${invitationId}`
      const { url: inviteLink, token: magicLinkToken } = await generateInvitationMagicLink(
        invitationRecord.email,
        callbackURL,
        portalUrl
      )

      const { revokeMagicLinkToken } = await import('@/lib/server/auth/magic-link-mint')
      if (!(await appendInviteMagicLinkToken(invitationId, magicLinkToken))) {
        await revokeMagicLinkToken(magicLinkToken) // invite no longer pending; drop it
        throw new Error('Invitation is no longer pending — refresh and try again')
      }

      const { getEmailSafeUrl } = await import('@/lib/server/storage/s3')
      const logoUrl = getEmailSafeUrl(auth.settings.logoKey) ?? undefined
      let result: Awaited<ReturnType<typeof sendInvitationEmail>>
      try {
        result = await sendInvitationEmail({
          to: invitationRecord.email,
          invitedByName: auth.user.name,
          inviteeName: invitationRecord.name || undefined,
          workspaceName: auth.settings.name,
          inviteLink,
          logoUrl,
        })
      } catch (sendError) {
        // The new link never went out — drop it from the set and revoke it.
        await removeInviteMagicLinkToken(invitationId, magicLinkToken)
        throw sendError
      }

      log.info({ invitation_id: invitationId, sent: result.sent }, 'invitation resent')
      return {
        invitationId,
        emailSent: result.sent,
        inviteLink: !result.sent ? inviteLink : undefined,
      }
    } catch (error) {
      log.error({ err: error }, 'resend invitation failed')
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
  attribute: z.enum(['country', 'locale', 'name', 'email', 'signup_source']),
  query: z.string().max(200).default(''),
  limit: z.number().int().min(1).max(50).default(20),
})

export const fetchSegmentAttributeValuesFn = createServerFn({ method: 'GET' })
  .validator(fetchSegmentAttributeValuesSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SEGMENT_VIEW })
    const { getAttributeValueSuggestions } =
      await import('@/lib/server/domains/segments/segment-attribute-values')
    return { values: await getAttributeValueSuggestions(data.attribute, data.query, data.limit) }
  })

/**
 * List all segments with member counts.
 */
export const listSegmentsFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('list segments')
  try {
    await requireAuth({ permission: PERMISSIONS.SEGMENT_VIEW })
    const result = await listSegments()
    log.debug({ count: result.length }, 'list segments')
    return result.map((seg) => ({
      ...seg,
      createdAt: seg.createdAt.toISOString(),
      updatedAt: seg.updatedAt.toISOString(),
    }))
  } catch (error) {
    log.error({ err: error }, 'list segments failed')
    throw error
  }
})

/**
 * Create a new segment.
 */
export const createSegmentFn = createServerFn({ method: 'POST' })
  .validator(createSegmentSchema)
  .handler(async ({ data }) => {
    log.info({ name: data.name }, 'create segment')
    try {
      await requireAuth({ permission: PERMISSIONS.SEGMENT_MANAGE })
      const segment = await createSegment(data as CreateSegmentInput)

      // Set up auto-evaluation schedule if configured
      if (segment.type === 'dynamic' && segment.evaluationSchedule?.enabled) {
        await upsertSegmentEvaluationSchedule(
          segment.id as SegmentId,
          segment.evaluationSchedule
        ).catch((err) => log.error({ err }, 'failed to set up evaluation schedule'))
      }

      log.info({ segment_id: segment.id }, 'segment created')
      return {
        ...segment,
        createdAt: segment.createdAt.toISOString(),
        updatedAt: segment.updatedAt.toISOString(),
      }
    } catch (error) {
      log.error({ err: error }, 'create segment failed')
      throw error
    }
  })

/**
 * Update an existing segment.
 */
export const updateSegmentFn = createServerFn({ method: 'POST' })
  .validator(updateSegmentSchema)
  .handler(async ({ data }) => {
    log.info({ segment_id: data.segmentId }, 'update segment')
    try {
      await requireAuth({ permission: PERMISSIONS.SEGMENT_MANAGE })
      const { segmentId, ...updates } = data
      const segment = await updateSegment(segmentId as SegmentId, updates as UpdateSegmentInput)

      // Update evaluation schedule
      if (updates.evaluationSchedule !== undefined) {
        if (segment.evaluationSchedule?.enabled) {
          await upsertSegmentEvaluationSchedule(
            segmentId as SegmentId,
            segment.evaluationSchedule
          ).catch((err) => log.error({ err }, 'failed to update evaluation schedule'))
        } else {
          await removeSegmentEvaluationSchedule(segmentId as SegmentId).catch((err) =>
            log.error({ err }, 'failed to remove evaluation schedule')
          )
        }
      }

      log.info({ segment_id: segment.id }, 'segment updated')
      return {
        ...segment,
        createdAt: segment.createdAt.toISOString(),
        updatedAt: segment.updatedAt.toISOString(),
      }
    } catch (error) {
      log.error({ err: error }, 'update segment failed')
      throw error
    }
  })

/**
 * Delete a segment.
 */
export const deleteSegmentFn = createServerFn({ method: 'POST' })
  .validator(segmentByIdSchema)
  .handler(async ({ data }) => {
    log.info({ segment_id: data.segmentId }, 'delete segment')
    try {
      await requireAuth({ permission: PERMISSIONS.SEGMENT_MANAGE })

      await deleteSegment(data.segmentId as SegmentId)
      log.info({ segment_id: data.segmentId }, 'segment deleted')
      return { segmentId: data.segmentId }
    } catch (error) {
      log.error({ err: error }, 'delete segment failed')
      throw error
    }
  })

/**
 * Assign users to a manual segment.
 */
export const assignUsersToSegmentFn = createServerFn({ method: 'POST' })
  .validator(assignUsersSchema)
  .handler(async ({ data }) => {
    log.info(
      { segment_id: data.segmentId, count: data.principalIds.length },
      'assign users to segment'
    )
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.SEGMENT_MANAGE })
      const { actorFromAuth } = await import('@/lib/server/audit/log')
      const { assigned } = await assignUsersToSegment(
        data.segmentId as SegmentId,
        data.principalIds as PrincipalId[],
        actorFromAuth(auth),
        getRequestHeaders()
      )
      log.info({ segment_id: data.segmentId, assigned }, 'users assigned to segment')
      return { segmentId: data.segmentId, assigned }
    } catch (error) {
      log.error({ err: error }, 'assign users to segment failed')
      throw error
    }
  })

/**
 * Remove users from a manual segment.
 */
export const removeUsersFromSegmentFn = createServerFn({ method: 'POST' })
  .validator(assignUsersSchema)
  .handler(async ({ data }) => {
    log.info(
      { segment_id: data.segmentId, count: data.principalIds.length },
      'remove users from segment'
    )
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.SEGMENT_MANAGE })
      const { actorFromAuth } = await import('@/lib/server/audit/log')
      const { removed } = await removeUsersFromSegment(
        data.segmentId as SegmentId,
        data.principalIds as PrincipalId[],
        actorFromAuth(auth),
        getRequestHeaders()
      )
      log.info({ segment_id: data.segmentId, removed }, 'users removed from segment')
      return { segmentId: data.segmentId, removed }
    } catch (error) {
      log.error({ err: error }, 'remove users from segment failed')
      throw error
    }
  })

/**
 * Trigger re-evaluation of a dynamic segment.
 */
export const evaluateSegmentFn = createServerFn({ method: 'POST' })
  .validator(segmentByIdSchema)
  .handler(async ({ data }) => {
    log.info({ segment_id: data.segmentId }, 'evaluate segment')
    try {
      await requireAuth({ permission: PERMISSIONS.SEGMENT_MANAGE })
      const result = await evaluateDynamicSegment(data.segmentId as SegmentId)
      log.info({ added: result.added, removed: result.removed }, 'segment evaluated')
      return result
    } catch (error) {
      log.error({ err: error }, 'evaluate segment failed')
      throw error
    }
  })

/**
 * Trigger re-evaluation of all dynamic segments.
 */
export const evaluateAllSegmentsFn = createServerFn({ method: 'POST' }).handler(async () => {
  log.info('evaluate all segments')
  try {
    await requireAuth({ permission: PERMISSIONS.SEGMENT_MANAGE })
    const results = await evaluateAllDynamicSegments()
    log.info({ count: results.length }, 'all segments evaluated')
    return results
  } catch (error) {
    log.error({ err: error }, 'evaluate all segments failed')
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
    await requireAuth({ permission: PERMISSIONS.USER_ATTRIBUTE_VIEW })
    return listUserAttributes()
  } catch (error) {
    log.error({ err: error }, 'list user attributes failed')
    throw error
  }
})

/**
 * Create a new user attribute definition.
 */
export const createUserAttributeFn = createServerFn({ method: 'POST' })
  .validator(createUserAttributeSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth({ permission: PERMISSIONS.USER_ATTRIBUTE_MANAGE })
      return createUserAttribute({
        key: data.key,
        label: data.label,
        description: data.description,
        type: data.type,
        currencyCode: data.currencyCode,
        externalKey: data.externalKey,
      })
    } catch (error) {
      log.error({ err: error }, 'create user attribute failed')
      throw error
    }
  })

/**
 * Update an existing user attribute definition.
 */
export const updateUserAttributeFn = createServerFn({ method: 'POST' })
  .validator(updateUserAttributeSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth({ permission: PERMISSIONS.USER_ATTRIBUTE_MANAGE })
      return updateUserAttribute(data.id as UserAttributeId, {
        label: data.label,
        description: data.description,
        type: data.type,
        currencyCode: data.currencyCode,
        externalKey: data.externalKey,
      })
    } catch (error) {
      log.error({ err: error }, 'update user attribute failed')
      throw error
    }
  })

/**
 * Delete a user attribute definition.
 */
export const deleteUserAttributeFn = createServerFn({ method: 'POST' })
  .validator(userAttributeIdSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth({ permission: PERMISSIONS.USER_ATTRIBUTE_MANAGE })
      await deleteUserAttribute(data.id as UserAttributeId)
      return { deleted: true }
    } catch (error) {
      log.error({ err: error }, 'delete user attribute failed')
      throw error
    }
  })
