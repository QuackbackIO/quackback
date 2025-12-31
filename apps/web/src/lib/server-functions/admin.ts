import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import { listInboxPosts } from '@/lib/posts'
import { listBoards } from '@/lib/boards'
import { listTags } from '@/lib/tags'
import { listStatuses } from '@/lib/statuses'
import { listTeamMembers } from '@/lib/members'
import { db, member, invitation, user, eq, and } from '@/lib/db'
import {
  generateId,
  inviteIdSchema,
  memberIdSchema,
  boardIdSchema,
  statusIdSchema,
  tagIdSchema,
  type InviteId,
  type UserId,
  type MemberId,
} from '@quackback/ids'
import { sendInvitationEmail } from '@quackback/email'
import { getRootUrl } from '@/lib/routing'
import { getSettings } from '@/lib/workspace'
import { getSession } from '@/lib/auth/server'
import type { InboxPostListParams } from '@/lib/posts/post.types'
import type { BoardSettings } from '@quackback/db/types'
import type { TiptapContent } from '@/lib/schemas/posts'

/**
 * Server functions for admin data fetching.
 * All functions require authentication and team member role (owner, admin, or member).
 */

// Schemas for GET request parameters
const inboxPostListSchema = z.object({
  sort: z.enum(['votes', 'newest', 'oldest']).default('newest'),
  limit: z.number().default(20),
  page: z.number().default(1),
  search: z.string().optional(),
  ownerId: memberIdSchema.nullable().optional(),
  statusIds: z.array(statusIdSchema).optional(),
  statusSlugs: z.array(z.string()).optional(),
  boardIds: z.array(boardIdSchema).optional(),
  boardSlugs: z.array(z.string()).optional(),
  tagIds: z.array(tagIdSchema).optional(),
  minVotes: z.number().optional(),
}) as z.ZodType<InboxPostListParams>

const listPortalUsersSchema = z.object({
  search: z.string().optional(),
  verified: z.boolean().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sort: z.enum(['newest', 'oldest', 'most_active']).optional(),
  page: z.number().optional(),
  limit: z.number().optional(),
})

const getPortalUserSchema = z.object({
  memberId: memberIdSchema,
})

const deletePortalUserSchema = z.object({
  memberId: memberIdSchema,
})

/**
 * Fetch inbox posts with filters for admin feedback view
 */
export const fetchInboxPosts = createServerFn({ method: 'GET' })
  .inputValidator(inboxPostListSchema)
  .handler(async ({ data }: { data: InboxPostListParams }) => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await listInboxPosts(data)
    if (!result.success) {
      throw new Error(result.error.message)
    }
    // Serialize contentJson field and Date fields
    return {
      ...result.value,
      items: result.value.items.map((p) => ({
        ...p,
        contentJson: (p.contentJson ?? {}) as TiptapContent,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        deletedAt: p.deletedAt?.toISOString() || null,
        officialResponseAt: p.officialResponseAt?.toISOString() || null,
      })),
    }
  })

/**
 * Fetch all boards for the organization
 */
export const fetchBoardsList = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['owner', 'admin', 'member'] })

  const result = await listBoards()
  if (!result.success) {
    throw new Error(result.error.message)
  }
  // Serialize settings field and Date fields
  return result.value.map((b) => ({
    ...b,
    settings: (b.settings ?? {}) as BoardSettings,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  }))
})

/**
 * Fetch all tags for the organization
 */
export const fetchTagsList = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['owner', 'admin', 'member'] })

  const result = await listTags()
  if (!result.success) {
    throw new Error(result.error.message)
  }
  return result.value
})

/**
 * Fetch all statuses for the organization
 */
export const fetchStatusesList = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['owner', 'admin', 'member'] })

  const result = await listStatuses()
  if (!result.success) {
    throw new Error(result.error.message)
  }
  return result.value
})

/**
 * Fetch team members (not portal users)
 */
export const fetchTeamMembers = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['owner', 'admin', 'member'] })

  const result = await listTeamMembers()
  if (!result.success) {
    throw new Error(result.error.message)
  }
  return result.value
})

/**
 * Check onboarding completion status
 */
export const fetchOnboardingStatus = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['owner', 'admin', 'member'] })

  const [orgBoards, members] = await Promise.all([
    db.query.boards.findMany({
      columns: { id: true },
    }),
    db.select({ id: member.id }).from(member),
  ])

  return {
    hasBoards: orgBoards.length > 0,
    memberCount: members.length,
  }
})

/**
 * Fetch boards list for settings page
 */
export const fetchBoardsForSettings = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['owner', 'admin', 'member'] })

  const orgBoards = await db.query.boards.findMany()
  return orgBoards.map((b) => ({
    ...b,
    settings: (b.settings ?? {}) as BoardSettings,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  }))
})

/**
 * Fetch integrations list
 */
export const fetchIntegrationsList = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['owner', 'admin', 'member'] })

  const integrations = await db.query.integrations.findMany()
  return integrations
})

/**
 * Check onboarding state for a user
 * Returns member record, step, and whether boards exist
 * Note: This function is called during onboarding and may create member records
 */
export const checkOnboardingState = createServerFn({ method: 'GET' })
  .inputValidator(z.string().optional())
  .handler(async ({ data }: { data: string | undefined }) => {
    // Allow unauthenticated access for onboarding
    const userId = data

    if (!userId) {
      return {
        memberRecord: null,
        hasSettings: false,
        hasBoards: false,
      }
    }

    // Check if user has a member record
    let memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, userId as UserId),
    })

    if (!memberRecord) {
      // Check if any owner exists
      const existingOwner = await db.query.member.findFirst({
        where: eq(member.role, 'owner'),
      })

      if (existingOwner) {
        // Not first user - they need an invitation
        return {
          memberRecord: null,
          needsInvitation: true,
          hasSettings: false,
          hasBoards: false,
        }
      }

      // First user - create owner member record
      const [newMember] = await db
        .insert(member)
        .values({
          id: generateId('member'),
          userId: userId as UserId,
          role: 'owner',
          createdAt: new Date(),
        })
        .returning()

      memberRecord = newMember
    }

    // Check if boards exist
    const existingBoards = await db.query.boards.findFirst()

    return {
      memberRecord: memberRecord
        ? {
            id: memberRecord.id,
            userId: memberRecord.userId,
            role: memberRecord.role,
          }
        : null,
      needsInvitation: false,
      hasSettings: true,
      hasBoards: !!existingBoards,
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
  .handler(
    async ({
      data,
    }: {
      data: {
        search?: string
        verified?: boolean
        dateFrom?: string
        dateTo?: string
        sort?: 'newest' | 'oldest' | 'most_active'
        page?: number
        limit?: number
      }
    }) => {
      await requireAuth({ roles: ['owner', 'admin', 'member'] })

      const { listPortalUsers } = await import('@/lib/users')
      const result = await listPortalUsers({
        search: data.search,
        verified: data.verified,
        dateFrom: data.dateFrom ? new Date(data.dateFrom) : undefined,
        dateTo: data.dateTo ? new Date(data.dateTo) : undefined,
        sort: data.sort,
        page: data.page,
        limit: data.limit,
      })

      if (!result.success) {
        throw new Error(result.error.message)
      }

      // Serialize Date fields for client
      return {
        ...result.value,
        items: result.value.items.map((user) => ({
          ...user,
          joinedAt: user.joinedAt.toISOString(),
        })),
      }
    }
  )

/**
 * Get a portal user's details.
 */
export const getPortalUserFn = createServerFn({ method: 'GET' })
  .inputValidator(getPortalUserSchema)
  .handler(async ({ data }: { data: { memberId: MemberId } }) => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const { getPortalUserDetail } = await import('@/lib/users')

    const result = await getPortalUserDetail(data.memberId)

    if (!result.success) {
      throw new Error(result.error.message)
    }

    // Serialize Date fields for client
    if (!result.value) {
      return null
    }

    return {
      ...result.value,
      joinedAt: result.value.joinedAt.toISOString(),
      createdAt: result.value.createdAt.toISOString(),
      engagedPosts: result.value.engagedPosts.map((post) => ({
        ...post,
        createdAt: post.createdAt.toISOString(),
        engagedAt: post.engagedAt.toISOString(),
      })),
    }
  })

/**
 * Delete (remove) a portal user.
 */
export const deletePortalUserFn = createServerFn({ method: 'GET' })
  .inputValidator(deletePortalUserSchema)
  .handler(async ({ data }: { data: { memberId: MemberId } }) => {
    await requireAuth({ roles: ['owner', 'admin'] })

    const { removePortalUser } = await import('@/lib/users')

    const result = await removePortalUser(data.memberId)

    if (!result.success) {
      throw new Error(result.error.message)
    }

    return { memberId: data.memberId }
  })

// ============================================
// Invitation Operations
// ============================================

const sendInvitationSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(['admin', 'member']),
})

const cancelInvitationSchema = z.object({
  invitationId: inviteIdSchema,
})

const resendInvitationSchema = z.object({
  invitationId: inviteIdSchema,
})

export type SendInvitationInput = z.infer<typeof sendInvitationSchema>
export type CancelInvitationInput = z.infer<typeof cancelInvitationSchema>
export type ResendInvitationInput = z.infer<typeof resendInvitationSchema>

/**
 * Send a team invitation
 */
export const sendInvitationFn = createServerFn({ method: 'POST' })
  .inputValidator(sendInvitationSchema)
  .handler(async ({ data }: { data: SendInvitationInput }) => {
    await requireAuth({ roles: ['owner', 'admin'] })

    const session = await getSession()
    if (!session?.user) {
      throw new Error('Authentication required')
    }

    const settings = await getSettings()
    if (!settings) {
      throw new Error('Settings not found')
    }

    const email = data.email.toLowerCase()

    const existingInvitation = await db.query.invitation.findFirst({
      where: and(eq(invitation.email, email), eq(invitation.status, 'pending')),
    })

    if (existingInvitation) {
      throw new Error('An invitation has already been sent to this email')
    }

    const existingUser = await db.query.user.findFirst({
      where: eq(user.email, email),
    })

    if (existingUser) {
      throw new Error('A user with this email already exists')
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
      inviterId: session.user.id,
      createdAt: now,
    })

    const rootUrl = getRootUrl()
    const inviteLink = `${rootUrl}/accept-invitation/${invitationId}`

    await sendInvitationEmail({
      to: email,
      invitedByName: session.user.name,
      inviteeName: data.name || undefined,
      workspaceName: settings.name,
      inviteLink,
    })

    return { invitationId }
  })

/**
 * Cancel a pending invitation
 */
export const cancelInvitationFn = createServerFn({ method: 'POST' })
  .inputValidator(cancelInvitationSchema)
  .handler(async ({ data }: { data: CancelInvitationInput }) => {
    await requireAuth({ roles: ['owner', 'admin'] })

    const invitationId = data.invitationId as InviteId

    const invitationRecord = await db.query.invitation.findFirst({
      where: and(eq(invitation.id, invitationId), eq(invitation.status, 'pending')),
    })

    if (!invitationRecord) {
      throw new Error('Invitation not found')
    }

    await db.update(invitation).set({ status: 'canceled' }).where(eq(invitation.id, invitationId))

    return { invitationId }
  })

/**
 * Resend an invitation email
 */
export const resendInvitationFn = createServerFn({ method: 'POST' })
  .inputValidator(resendInvitationSchema)
  .handler(async ({ data }: { data: ResendInvitationInput }) => {
    await requireAuth({ roles: ['owner', 'admin'] })

    const session = await getSession()
    if (!session?.user) {
      throw new Error('Authentication required')
    }

    const settings = await getSettings()
    if (!settings) {
      throw new Error('Settings not found')
    }

    const invitationId = data.invitationId as InviteId

    const invitationRecord = await db.query.invitation.findFirst({
      where: and(eq(invitation.id, invitationId), eq(invitation.status, 'pending')),
    })

    if (!invitationRecord) {
      throw new Error('Invitation not found')
    }

    const rootUrl = getRootUrl()
    const inviteLink = `${rootUrl}/accept-invitation/${invitationId}`

    await sendInvitationEmail({
      to: invitationRecord.email,
      invitedByName: session.user.name,
      inviteeName: invitationRecord.name || undefined,
      workspaceName: settings.name,
      inviteLink,
    })

    await db
      .update(invitation)
      .set({ lastSentAt: new Date() })
      .where(eq(invitation.id, invitationId))

    return { invitationId }
  })
