import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSession } from '@/lib/auth/server'
import { actionOk, actionErr, mapDomainError } from './types'
import { listPortalUsers, getPortalUserDetail, removePortalUser } from '@/lib/users'
import { db, invitation, user, member, eq, and } from '@/lib/db'
import { sendInvitationEmail } from '@quackback/email'
import {
  memberIdSchema,
  inviteIdSchema,
  generateId,
  type MemberId,
  type InviteId,
  type UserId,
} from '@quackback/ids'
import { getRootUrl } from '@/lib/routing'
import { getSettings } from '@/lib/workspace'

// ============================================
// Schemas
// ============================================

const listPortalUsersSchema = z.object({
  search: z.string().optional(),
  verified: z.boolean().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sort: z.enum(['newest', 'oldest', 'most_active', 'name']).optional().default('newest'),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(20),
})

const getPortalUserSchema = z.object({
  memberId: memberIdSchema,
})

const deletePortalUserSchema = z.object({
  memberId: memberIdSchema,
})

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

// ============================================
// Type Exports
// ============================================

export type ListPortalUsersInput = z.infer<typeof listPortalUsersSchema>
export type GetPortalUserInput = z.infer<typeof getPortalUserSchema>
export type DeletePortalUserInput = z.infer<typeof deletePortalUserSchema>
export type SendInvitationInput = z.infer<typeof sendInvitationSchema>
export type CancelInvitationInput = z.infer<typeof cancelInvitationSchema>
export type ResendInvitationInput = z.infer<typeof resendInvitationSchema>

// ============================================
// Server Functions
// ============================================

/**
 * List portal users for an organization.
 */
export const listPortalUsersAction = createServerFn({ method: 'POST' })
  .inputValidator(listPortalUsersSchema)
  .handler(async ({ data: input }) => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    const allowedRoles = ['owner', 'admin', 'member']
    if (!allowedRoles.includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const result = await listPortalUsers({
      search: input.search,
      verified: input.verified,
      dateFrom: input.dateFrom ? new Date(input.dateFrom) : undefined,
      dateTo: input.dateTo ? new Date(input.dateTo) : undefined,
      sort: input.sort,
      page: input.page,
      limit: input.limit,
    })

    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }

    return actionOk(result.value)
  })

/**
 * Get a portal user's details.
 */
export const getPortalUserAction = createServerFn({ method: 'POST' })
  .inputValidator(getPortalUserSchema)
  .handler(async ({ data: input }) => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    const allowedRoles = ['owner', 'admin', 'member']
    if (!allowedRoles.includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const result = await getPortalUserDetail(input.memberId as MemberId)

    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }

    return actionOk(result.value)
  })

/**
 * Delete a portal user (remove from organization).
 */
export const deletePortalUserAction = createServerFn({ method: 'POST' })
  .inputValidator(deletePortalUserSchema)
  .handler(async ({ data: input }) => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    const allowedRoles = ['owner', 'admin']
    if (!allowedRoles.includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const result = await removePortalUser(input.memberId as MemberId)

    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }

    return actionOk({ success: true })
  })

/**
 * Send a team member invitation.
 */
export const sendInvitationAction = createServerFn({ method: 'POST' })
  .inputValidator(sendInvitationSchema)
  .handler(async ({ data: input }) => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    const allowedRoles = ['owner', 'admin']
    if (!allowedRoles.includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const settings = await getSettings()
    if (!settings) {
      return actionErr({ code: 'INTERNAL_ERROR', message: 'Settings not found', status: 500 })
    }

    const email = input.email.toLowerCase()

    const existingInvitation = await db.query.invitation.findFirst({
      where: and(eq(invitation.email, email), eq(invitation.status, 'pending')),
    })

    if (existingInvitation) {
      return actionErr({
        code: 'CONFLICT',
        message: 'An invitation has already been sent to this email',
        status: 409,
      })
    }

    const existingUser = await db.query.user.findFirst({
      where: eq(user.email, email),
    })

    if (existingUser) {
      return actionErr({
        code: 'CONFLICT',
        message: 'A user with this email already exists',
        status: 409,
      })
    }

    const invitationId = generateId('invite')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const now = new Date()

    await db.insert(invitation).values({
      id: invitationId,
      email,
      name: input.name || null,
      role: input.role,
      status: 'pending',
      expiresAt,
      lastSentAt: now,
      inviterId: session.user.id,
    })

    const rootUrl = getRootUrl()
    const inviteLink = `${rootUrl}/accept-invitation/${invitationId}`

    await sendInvitationEmail({
      to: email,
      invitedByName: session.user.name,
      inviteeName: input.name || undefined,
      workspaceName: settings.name,
      inviteLink,
    })

    return actionOk({
      success: true,
      invitationId,
      message: 'Invitation sent successfully',
    })
  })

/**
 * Cancel a pending invitation.
 */
export const cancelInvitationAction = createServerFn({ method: 'POST' })
  .inputValidator(cancelInvitationSchema)
  .handler(async ({ data: input }) => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    const allowedRoles = ['owner', 'admin']
    if (!allowedRoles.includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const invitationId = input.invitationId as InviteId

    const invitationRecord = await db.query.invitation.findFirst({
      where: and(eq(invitation.id, invitationId), eq(invitation.status, 'pending')),
    })

    if (!invitationRecord) {
      return actionErr({
        code: 'NOT_FOUND',
        message: 'Invitation not found',
        status: 404,
      })
    }

    await db.update(invitation).set({ status: 'canceled' }).where(eq(invitation.id, invitationId))

    return actionOk({ success: true })
  })

/**
 * Resend an invitation email.
 */
export const resendInvitationAction = createServerFn({ method: 'POST' })
  .inputValidator(resendInvitationSchema)
  .handler(async ({ data: input }) => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    const allowedRoles = ['owner', 'admin']
    if (!allowedRoles.includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const settings = await getSettings()
    if (!settings) {
      return actionErr({ code: 'INTERNAL_ERROR', message: 'Settings not found', status: 500 })
    }

    const invitationId = input.invitationId as InviteId

    const invitationRecord = await db.query.invitation.findFirst({
      where: and(eq(invitation.id, invitationId), eq(invitation.status, 'pending')),
    })

    if (!invitationRecord) {
      return actionErr({
        code: 'NOT_FOUND',
        message: 'Invitation not found',
        status: 404,
      })
    }

    const rootUrl = getRootUrl()
    const inviteLink = `${rootUrl}/accept-invitation/${invitationId}`

    await db
      .update(invitation)
      .set({ lastSentAt: new Date() })
      .where(eq(invitation.id, invitationId))

    await sendInvitationEmail({
      to: invitationRecord.email,
      invitedByName: session.user.name,
      inviteeName: invitationRecord.name || undefined,
      workspaceName: settings.name,
      inviteLink,
    })

    return actionOk({
      success: true,
      message: 'Invitation resent successfully',
    })
  })
