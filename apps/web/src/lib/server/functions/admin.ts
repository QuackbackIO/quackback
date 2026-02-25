import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import {
  generateId,
  type InviteId,
  type UserId,
  type PrincipalId,
  type SegmentId,
} from '@quackback/ids'
import type { BoardId, TagId } from '@quackback/ids'
import {
  isOnboardingComplete as checkComplete,
  type BoardSettings,
  type SetupState,
} from '@/lib/server/db'
import type { TiptapContent } from '@/lib/shared/schemas/posts'
import { requireAuth } from './auth-helpers'
import { getSettings } from './workspace'
import { db, invitation, principal, user, eq, and } from '@/lib/server/db'
import { listInboxPosts } from '@/lib/server/domains/posts/post.query'
import { listBoards } from '@/lib/server/domains/boards/board.service'
import { listTags } from '@/lib/server/domains/tags/tag.service'
import { listStatuses } from '@/lib/server/domains/statuses/status.service'
import {
  listTeamMembers,
  updateMemberRole,
  removeTeamMember,
} from '@/lib/server/domains/principals/principal.service'
import {
  listPortalUsers,
  getPortalUserDetail,
  removePortalUser,
} from '@/lib/server/domains/users/user.service'
import {
  listSegments,
  createSegment,
  updateSegment,
  deleteSegment,
  assignUsersToSegment,
  removeUsersFromSegment,
  evaluateDynamicSegment,
  evaluateAllDynamicSegments,
} from '@/lib/server/domains/segments/segment.service'
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
import { getAuth, getMagicLinkToken } from '@/lib/server/auth'

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
})

const portalUserByIdSchema = z.object({
  principalId: z.string(),
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
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
          deletedAt: p.deletedAt?.toISOString() || null,
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
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
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
    return result
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
    return result
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
    return result
  } catch (error) {
    console.error(`[fn:admin] ❌ fetchTeamMembers failed:`, error)
    throw error
  }
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

      await updateMemberRole(data.principalId as PrincipalId, data.role, auth.principal.id)

      console.log(`[fn:admin] updateMemberRoleFn: success`)
      return { principalId: data.principalId, role: data.role }
    } catch (error) {
      console.error(`[fn:admin] ❌ updateMemberRoleFn failed:`, error)
      throw error
    }
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

      await removeTeamMember(data.principalId as PrincipalId, auth.principal.id)

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

    const orgBoards = await db.query.boards.findMany()
    console.log(`[fn:admin] fetchBoardsForSettings: count=${orgBoards.length}`)
    return orgBoards.map((b) => ({
      ...b,
      settings: (b.settings ?? {}) as BoardSettings,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
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
      return {
        integration: {
          id: integration.id,
          status: integration.status,
          workspaceName: (integration.config as Record<string, unknown>)?.workspaceName as
            | string
            | undefined,
          config: integration.config as Record<string, string | number | boolean | null>,
          eventMappings: integration.eventMappings.map((m) => ({
            id: m.id,
            eventType: m.eventType,
            enabled: m.enabled,
          })),
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
      const setupState: SetupState | null = currentSettings?.setupState
        ? JSON.parse(currentSettings.setupState)
        : null

      // Check if onboarding is complete based on setup state
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
      })

      console.log(`[fn:admin] listPortalUsersFn: count=${result.items.length}`)
      // Serialize Date fields for client
      return {
        ...result,
        items: result.items.map((user) => ({
          ...user,
          joinedAt: user.joinedAt.toISOString(),
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
        joinedAt: result.joinedAt.toISOString(),
        createdAt: result.createdAt.toISOString(),
        engagedPosts: result.engagedPosts.map((post) => ({
          ...post,
          createdAt: post.createdAt.toISOString(),
          engagedAt: post.engagedAt.toISOString(),
        })),
      }
    } catch (error) {
      console.error(`[fn:admin] ❌ getPortalUserFn failed:`, error)
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
 * @param callbackPath - Relative path to redirect to after authentication (e.g., /accept-invitation/{id})
 * @param portalUrl - The base portal URL (workspace domain)
 * @returns The magic link URL with the correct workspace domain
 */
async function generateInvitationMagicLink(
  email: string,
  callbackPath: string,
  portalUrl: string
): Promise<string> {
  const authInstance = await getAuth()

  console.log(
    `[fn:admin] generateInvitationMagicLink: email=${email}, callbackPath=${callbackPath}, portalUrl=${portalUrl}`
  )

  // Use Better Auth's handler with the workspace domain context
  // We pass a relative callbackURL - Better Auth will use the request's origin for redirects
  const response = await authInstance.handler(
    new Request(`${portalUrl}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: portalUrl,
        Host: new URL(portalUrl).host,
      },
      body: JSON.stringify({
        email,
        callbackURL: callbackPath, // Relative path - Better Auth appends to origin
      }),
    })
  )

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`[fn:admin] generateInvitationMagicLink: handler failed - ${errorText}`)
    throw new Error(`Magic link generation failed: ${errorText}`)
  }

  // Retrieve the token that was stored by our callback
  const token = getMagicLinkToken(email)
  if (!token) {
    throw new Error('Magic link token not found — sendMagicLink callback may not have fired')
  }

  // Construct the magic link URL with the workspace domain
  const absoluteCallbackURL = `${portalUrl}${callbackPath}`
  const verifyUrl = new URL('/api/auth/magic-link/verify', portalUrl)
  verifyUrl.searchParams.set('token', token)
  verifyUrl.searchParams.set('callbackURL', absoluteCallbackURL)
  verifyUrl.searchParams.set('errorCallbackURL', absoluteCallbackURL)
  return verifyUrl.toString()
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

      const email = data.email.toLowerCase()

      // Parallelize invitation and user validation queries
      const [existingInvitation, existingUser] = await Promise.all([
        db.query.invitation.findFirst({
          where: and(eq(invitation.email, email), eq(invitation.status, 'pending')),
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
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
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
      const callbackURL = `/accept-invitation/${invitationId}`
      const inviteLink = await generateInvitationMagicLink(email, callbackURL, portalUrl)

      const result = await sendInvitationEmail({
        to: email,
        invitedByName: auth.user.name,
        inviteeName: data.name || undefined,
        workspaceName: auth.settings.name,
        inviteLink,
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
        where: and(eq(invitation.id, invitationId), eq(invitation.status, 'pending')),
      })

      if (!invitationRecord) {
        throw new Error('Invitation not found')
      }

      await db.update(invitation).set({ status: 'canceled' }).where(eq(invitation.id, invitationId))

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
        where: and(eq(invitation.id, invitationId), eq(invitation.status, 'pending')),
      })

      if (!invitationRecord) {
        throw new Error('Invitation not found')
      }

      // Generate new magic link for one-click authentication
      const portalUrl = getBaseUrl()
      const callbackURL = `/accept-invitation/${invitationId}`
      const inviteLink = await generateInvitationMagicLink(
        invitationRecord.email,
        callbackURL,
        portalUrl
      )

      const result = await sendInvitationEmail({
        to: invitationRecord.email,
        invitedByName: auth.user.name,
        inviteeName: invitationRecord.name || undefined,
        workspaceName: auth.settings.name,
        inviteLink,
      })

      await db
        .update(invitation)
        .set({ lastSentAt: new Date() })
        .where(eq(invitation.id, invitationId))

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
const segmentConditionSchema = z.object({
  attribute: z.enum([
    'email_domain',
    'email_verified',
    'created_at_days_ago',
    'post_count',
    'vote_count',
    'comment_count',
    'metadata_key',
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

const createSegmentSchema = z.object({
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
      createdAt: seg.createdAt.toISOString(),
      updatedAt: seg.updatedAt.toISOString(),
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
        createdAt: segment.createdAt.toISOString(),
        updatedAt: segment.updatedAt.toISOString(),
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
        createdAt: segment.createdAt.toISOString(),
        updatedAt: segment.updatedAt.toISOString(),
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
      await requireAuth({ roles: ['admin', 'member'] })
      await assignUsersToSegment(data.segmentId as SegmentId, data.principalIds as PrincipalId[])
      console.log(`[fn:admin] assignUsersToSegmentFn: assigned`)
      return { segmentId: data.segmentId, assigned: data.principalIds.length }
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
      await requireAuth({ roles: ['admin', 'member'] })
      await removeUsersFromSegment(data.segmentId as SegmentId, data.principalIds as PrincipalId[])
      console.log(`[fn:admin] removeUsersFromSegmentFn: removed`)
      return { segmentId: data.segmentId, removed: data.principalIds.length }
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
