'use server'

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
import { getSettings } from '@/lib/tenant'

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
// Actions
// ============================================

/**
 * List portal users for an organization.
 */
export async function listPortalUsersAction(rawInput: ListPortalUsersInput) {
  // 1. Validate input
  const parseResult = listPortalUsersSchema.safeParse(rawInput)
  if (!parseResult.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parseResult.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }
  const input = parseResult.data

  // 2. Get session
  const session = await getSession()
  if (!session?.user) {
    return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
  }

  // 3. Get member record
  const memberRecord = await db.query.member.findFirst({
    where: eq(member.userId, session.user.id as UserId),
  })
  if (!memberRecord) {
    return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
  }

  // 4. Check role
  const allowedRoles = ['owner', 'admin', 'member']
  if (!allowedRoles.includes(memberRecord.role)) {
    return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
  }

  // 5. Call service
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
}

/**
 * Get a portal user's details.
 */
export async function getPortalUserAction(rawInput: GetPortalUserInput) {
  // 1. Validate input
  const parseResult = getPortalUserSchema.safeParse(rawInput)
  if (!parseResult.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parseResult.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }
  const input = parseResult.data

  // 2. Get session
  const session = await getSession()
  if (!session?.user) {
    return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
  }

  // 3. Get member record
  const memberRecord = await db.query.member.findFirst({
    where: eq(member.userId, session.user.id as UserId),
  })
  if (!memberRecord) {
    return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
  }

  // 4. Check role
  const allowedRoles = ['owner', 'admin', 'member']
  if (!allowedRoles.includes(memberRecord.role)) {
    return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
  }

  // 5. Call service
  const result = await getPortalUserDetail(input.memberId as MemberId)

  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }

  return actionOk(result.value)
}

/**
 * Delete a portal user (remove from organization).
 */
export async function deletePortalUserAction(rawInput: DeletePortalUserInput) {
  // 1. Validate input
  const parseResult = deletePortalUserSchema.safeParse(rawInput)
  if (!parseResult.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parseResult.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }
  const input = parseResult.data

  // 2. Get session
  const session = await getSession()
  if (!session?.user) {
    return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
  }

  // 3. Get member record
  const memberRecord = await db.query.member.findFirst({
    where: eq(member.userId, session.user.id as UserId),
  })
  if (!memberRecord) {
    return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
  }

  // 4. Check role
  const allowedRoles = ['owner', 'admin']
  if (!allowedRoles.includes(memberRecord.role)) {
    return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
  }

  // 5. Call service
  const result = await removePortalUser(input.memberId as MemberId)

  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }

  return actionOk({ success: true })
}

/**
 * Send a team member invitation.
 */
export async function sendInvitationAction(rawInput: SendInvitationInput) {
  // 1. Validate input
  const parseResult = sendInvitationSchema.safeParse(rawInput)
  if (!parseResult.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parseResult.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }
  const input = parseResult.data

  // 2. Get session
  const session = await getSession()
  if (!session?.user) {
    return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
  }

  // 3. Get member record
  const memberRecord = await db.query.member.findFirst({
    where: eq(member.userId, session.user.id as UserId),
  })
  if (!memberRecord) {
    return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
  }

  // 4. Check role
  const allowedRoles = ['owner', 'admin']
  if (!allowedRoles.includes(memberRecord.role)) {
    return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
  }

  // 5. Get settings (needed for workspace name)
  const settings = await getSettings()
  if (!settings) {
    return actionErr({ code: 'INTERNAL_ERROR', message: 'Settings not found', status: 500 })
  }

  const email = input.email.toLowerCase()

  // Check if there's already a pending invitation for this email
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

  // Check if user with this email already exists
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

  // Create the invitation
  const invitationId = generateId('invite')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
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

  // Build invitation link
  const rootUrl = getRootUrl()
  const inviteLink = `${rootUrl}/accept-invitation/${invitationId}`

  // Send invitation email
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
}

/**
 * Cancel a pending invitation.
 */
export async function cancelInvitationAction(rawInput: CancelInvitationInput) {
  // 1. Validate input
  const parseResult = cancelInvitationSchema.safeParse(rawInput)
  if (!parseResult.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parseResult.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }
  const input = parseResult.data

  // 2. Get session
  const session = await getSession()
  if (!session?.user) {
    return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
  }

  // 3. Get member record
  const memberRecord = await db.query.member.findFirst({
    where: eq(member.userId, session.user.id as UserId),
  })
  if (!memberRecord) {
    return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
  }

  // 4. Check role
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
}

/**
 * Resend an invitation email.
 */
export async function resendInvitationAction(rawInput: ResendInvitationInput) {
  // 1. Validate input
  const parseResult = resendInvitationSchema.safeParse(rawInput)
  if (!parseResult.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parseResult.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }
  const input = parseResult.data

  // 2. Get session
  const session = await getSession()
  if (!session?.user) {
    return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
  }

  // 3. Get member record
  const memberRecord = await db.query.member.findFirst({
    where: eq(member.userId, session.user.id as UserId),
  })
  if (!memberRecord) {
    return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
  }

  // 4. Check role
  const allowedRoles = ['owner', 'admin']
  if (!allowedRoles.includes(memberRecord.role)) {
    return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
  }

  // 5. Get settings (needed for workspace name)
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

  // Build invitation link
  const rootUrl = getRootUrl()
  const inviteLink = `${rootUrl}/accept-invitation/${invitationId}`

  // Update last sent timestamp
  await db.update(invitation).set({ lastSentAt: new Date() }).where(eq(invitation.id, invitationId))

  // Resend invitation email
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
}
