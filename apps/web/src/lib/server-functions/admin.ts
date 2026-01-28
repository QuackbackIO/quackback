import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { generateId, type InviteId, type UserId, type MemberId } from '@quackback/ids'
import type { InboxPostListParams } from '@/lib/posts/post.types'
import {
  isOnboardingComplete as checkComplete,
  type BoardSettings,
  type SetupState,
} from '@quackback/db/types'
import type { TiptapContent } from '@/lib/schemas/posts'
import { requireAuth } from './auth-helpers'
import { getSettings } from './workspace'
import { db, invitation, member, user, eq, and } from '@/lib/db'
import { listInboxPosts } from '@/lib/posts/post.service'
import { listBoards } from '@/lib/boards/board.service'
import { listTags } from '@/lib/tags/tag.service'
import { listStatuses } from '@/lib/statuses/status.service'
import { listTeamMembers, updateMemberRole, removeTeamMember } from '@/lib/members/member.service'
import { listPortalUsers, getPortalUserDetail, removePortalUser } from '@/lib/users/user.service'
import { sendInvitationEmail } from '@quackback/email'
import { resolvePortalUrl } from '@/lib/hooks/context'
import { getAuth, getMagicLinkToken } from '@/lib/auth'

/**
 * Server functions for admin data fetching.
 * All functions require authentication and team member role (admin or member).
 */

// Schemas for GET request parameters
const inboxPostListSchema = z.object({
  sort: z.enum(['votes', 'newest', 'oldest']).default('newest'),
  limit: z.number().default(20),
  page: z.number().default(1),
  search: z.string().optional(),
  ownerId: z.string().nullable().optional(),
  statusIds: z.array(z.string()).optional(),
  statusSlugs: z.array(z.string()).optional(),
  boardIds: z.array(z.string()).optional(),
  boardSlugs: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  minVotes: z.number().optional(),
}) as z.ZodType<InboxPostListParams>

const listPortalUsersSchema = z.object({
  search: z.string().optional(),
  verified: z.boolean().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sort: z.enum(['newest', 'oldest', 'most_active', 'name']).optional(),
  page: z.number().optional(),
  limit: z.number().optional(),
})

const portalUserByIdSchema = z.object({
  memberId: z.string(),
})

/**
 * Fetch inbox posts with filters for admin feedback view
 */
export const fetchInboxPosts = createServerFn({ method: 'GET' })
  .inputValidator(inboxPostListSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:admin] fetchInboxPosts: sort=${data.sort}, page=${data.page}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const result = await listInboxPosts(data)
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
          officialResponseAt: p.officialResponseAt?.toISOString() || null,
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
const memberIdSchema = z.object({
  memberId: z.string(),
})

const updateMemberRoleSchema = z.object({
  memberId: z.string(),
  role: z.enum(['admin', 'member']),
})

/**
 * Update a team member's role (admin only)
 */
export const updateMemberRoleFn = createServerFn({ method: 'POST' })
  .inputValidator(updateMemberRoleSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:admin] updateMemberRoleFn: memberId=${data.memberId}, role=${data.role}`)
    try {
      const auth = await requireAuth({ roles: ['admin'] })

      await updateMemberRole(data.memberId as MemberId, data.role, auth.member.id)

      console.log(`[fn:admin] updateMemberRoleFn: success`)
      return { memberId: data.memberId, role: data.role }
    } catch (error) {
      console.error(`[fn:admin] ❌ updateMemberRoleFn failed:`, error)
      throw error
    }
  })

/**
 * Remove a team member (converts to portal user, admin only)
 */
export const removeTeamMemberFn = createServerFn({ method: 'POST' })
  .inputValidator(memberIdSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:admin] removeTeamMemberFn: memberId=${data.memberId}`)
    try {
      const auth = await requireAuth({ roles: ['admin'] })

      await removeTeamMember(data.memberId as MemberId, auth.member.id)

      console.log(`[fn:admin] removeTeamMemberFn: success`)
      return { memberId: data.memberId }
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
      db.select({ id: member.id }).from(member),
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

    const integrations = await db.query.integrations.findMany()
    console.log(`[fn:admin] fetchIntegrationsList: count=${integrations.length}`)
    return integrations
  } catch (error) {
    console.error(`[fn:admin] ❌ fetchIntegrationsList failed:`, error)
    throw error
  }
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

      const { integrations } = await import('@/lib/db')

      const integration = await db.query.integrations.findFirst({
        where: eq(integrations.integrationType, data.type),
        with: {
          eventMappings: true,
        },
      })

      if (!integration) {
        console.log(`[fn:admin] fetchIntegrationByType: not found`)
        return null
      }

      console.log(`[fn:admin] fetchIntegrationByType: found id=${integration.id}`)
      return {
        id: integration.id,
        status: integration.status,
        externalWorkspaceName: integration.externalWorkspaceName,
        config: integration.config as { channelId?: string },
        eventMappings: integration.eventMappings.map((m) => ({
          id: m.id,
          eventType: m.eventType,
          enabled: m.enabled,
        })),
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
          memberRecord: null,
          hasSettings: false,
          setupState: null,
          isOnboardingComplete: false,
        }
      }

      // Check if user has a member record
      let memberRecord = await db.query.member.findFirst({
        where: eq(member.userId, userId as UserId),
      })

      if (!memberRecord) {
        // Check if any admin exists
        const existingAdmin = await db.query.member.findFirst({
          where: eq(member.role, 'admin'),
        })

        if (existingAdmin) {
          // Not first user - they need an invitation
          console.log(`[fn:admin] checkOnboardingState: needsInvitation=true`)
          return {
            memberRecord: null,
            needsInvitation: true,
            hasSettings: false,
            setupState: null,
            isOnboardingComplete: false,
          }
        }

        // First user - create admin member record
        const [newMember] = await db
          .insert(member)
          .values({
            id: generateId('member'),
            userId: userId as UserId,
            role: 'admin',
            createdAt: new Date(),
          })
          .returning()

        memberRecord = newMember
        console.log(`[fn:admin] checkOnboardingState: created admin member`)
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
        memberRecord: memberRecord
          ? {
              id: memberRecord.id,
              userId: memberRecord.userId,
              role: memberRecord.role,
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
        sort: data.sort,
        page: data.page,
        limit: data.limit,
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
    console.log(`[fn:admin] getPortalUserFn: memberId=${data.memberId}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const result = await getPortalUserDetail(data.memberId as MemberId)

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
    console.log(`[fn:admin] deletePortalUserFn: memberId=${data.memberId}`)
    try {
      await requireAuth({ roles: ['admin'] })

      await removePortalUser(data.memberId as MemberId)

      console.log(`[fn:admin] deletePortalUserFn: deleted`)
      return { memberId: data.memberId }
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

  console.log(`[fn:admin] generateInvitationMagicLink: handler succeeded`)

  // Retrieve the token that was stored by our callback
  const token = getMagicLinkToken(email)
  if (!token) {
    console.error(`[fn:admin] generateInvitationMagicLink: token not found in pending map`)
    throw new Error(`Magic link token not found for ${email}`)
  }

  console.log(`[fn:admin] generateInvitationMagicLink: token retrieved, length=${token.length}`)

  // Debug: Check if verification record was created in the database
  const { verification } = await import('@/lib/db')
  const verificationRecord = await db.query.verification.findFirst({
    where: eq(verification.identifier, email.toLowerCase()),
    orderBy: (v, { desc }) => [desc(v.createdAt)],
  })
  if (verificationRecord) {
    console.log(`[fn:admin] generateInvitationMagicLink: verification record found in DB:`)
    console.log(`[fn:admin]   id: ${verificationRecord.id}`)
    console.log(`[fn:admin]   identifier: ${verificationRecord.identifier}`)
    console.log(`[fn:admin]   value length: ${verificationRecord.value?.length}`)
    console.log(`[fn:admin]   expiresAt: ${verificationRecord.expiresAt}`)
    console.log(`[fn:admin]   token matches: ${verificationRecord.value === token}`)
  } else {
    console.error(
      `[fn:admin] generateInvitationMagicLink: NO verification record found in DB for ${email}!`
    )
  }

  // Construct the magic link URL with the workspace domain
  // Use absolute callback URLs to ensure redirects stay on the workspace domain
  const absoluteCallbackURL = `${portalUrl}${callbackPath}`
  const magicLinkUrl = `${portalUrl}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(absoluteCallbackURL)}&errorCallbackURL=${encodeURIComponent(absoluteCallbackURL)}`

  console.log(`[fn:admin] generateInvitationMagicLink: URL constructed with absolute callbacks`)
  return magicLinkUrl
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
        const existingMember = await db.query.member.findFirst({
          where: eq(member.userId, existingUser.id),
        })

        if (existingMember && existingMember.role !== 'user') {
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
      const portalUrl = await resolvePortalUrl(auth.settings.slug)
      const callbackURL = `/accept-invitation/${invitationId}`
      const inviteLink = await generateInvitationMagicLink(email, callbackURL, portalUrl)

      await sendInvitationEmail({
        to: email,
        invitedByName: auth.user.name,
        inviteeName: data.name || undefined,
        workspaceName: auth.settings.name,
        inviteLink,
      })

      console.log(`[fn:admin] sendInvitationFn: sent id=${invitationId}`)
      return { invitationId }
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
      const portalUrl = await resolvePortalUrl(auth.settings.slug)
      const callbackURL = `/accept-invitation/${invitationId}`
      const inviteLink = await generateInvitationMagicLink(
        invitationRecord.email,
        callbackURL,
        portalUrl
      )

      await sendInvitationEmail({
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

      console.log(`[fn:admin] resendInvitationFn: resent`)
      return { invitationId }
    } catch (error) {
      console.error(`[fn:admin] ❌ resendInvitationFn failed:`, error)
      throw error
    }
  })
