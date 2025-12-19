'use server'

import { z } from 'zod'
import { withAction, mapDomainError } from './with-action'
import { actionOk, actionErr } from './types'
import { getUserService } from '@/lib/services'
import { db, invitation, user, workspaceDomain, eq, and } from '@/lib/db'
import { sendInvitationEmail } from '@quackback/email'
import {
  workspaceIdSchema,
  memberIdSchema,
  inviteIdSchema,
  generateId,
  type WorkspaceId,
  type MemberId,
  type InviteId,
} from '@quackback/ids'

// ============================================
// Schemas
// ============================================

const listPortalUsersSchema = z.object({
  workspaceId: workspaceIdSchema,
  search: z.string().optional(),
  verified: z.boolean().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sort: z.enum(['newest', 'oldest', 'most_active', 'name']).optional().default('newest'),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(20),
})

const getPortalUserSchema = z.object({
  workspaceId: workspaceIdSchema,
  memberId: memberIdSchema,
})

const deletePortalUserSchema = z.object({
  workspaceId: workspaceIdSchema,
  memberId: memberIdSchema,
})

const sendInvitationSchema = z.object({
  workspaceId: workspaceIdSchema,
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(['admin', 'member']),
})

const cancelInvitationSchema = z.object({
  workspaceId: workspaceIdSchema,
  invitationId: inviteIdSchema,
})

const resendInvitationSchema = z.object({
  workspaceId: workspaceIdSchema,
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
// Helper Functions
// ============================================

/**
 * Get the primary workspace domain URL
 */
async function getTenantUrl(workspaceId: WorkspaceId): Promise<string> {
  const domain = await db.query.workspaceDomain.findFirst({
    where: and(eq(workspaceDomain.workspaceId, workspaceId), eq(workspaceDomain.isPrimary, true)),
  })

  if (!domain) {
    throw new Error('No primary workspace domain configured')
  }

  const isLocalhost = domain.domain.includes('localhost')
  const protocol = isLocalhost ? 'http' : 'https'
  return `${protocol}://${domain.domain}`
}

// ============================================
// Actions
// ============================================

/**
 * List portal users for an organization.
 */
export const listPortalUsersAction = withAction(
  listPortalUsersSchema,
  async (input, ctx) => {
    const result = await getUserService().listPortalUsers(ctx.workspace.id, {
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
  },
  { roles: ['owner', 'admin', 'member'] }
)

/**
 * Get a portal user's details.
 */
export const getPortalUserAction = withAction(
  getPortalUserSchema,
  async (input, ctx) => {
    const result = await getUserService().getPortalUserDetail(
      input.memberId as MemberId,
      ctx.workspace.id
    )

    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }

    return actionOk(result.value)
  },
  { roles: ['owner', 'admin', 'member'] }
)

/**
 * Delete a portal user (remove from organization).
 */
export const deletePortalUserAction = withAction(
  deletePortalUserSchema,
  async (input, ctx) => {
    const result = await getUserService().removePortalUser(
      input.memberId as MemberId,
      ctx.workspace.id
    )

    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }

    return actionOk({ success: true })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Send a team member invitation.
 */
export const sendInvitationAction = withAction(
  sendInvitationSchema,
  async (input, ctx) => {
    const workspaceId = ctx.workspace.id
    const email = input.email.toLowerCase()

    // Check if there's already a pending invitation for this email
    const existingInvitation = await db.query.invitation.findFirst({
      where: and(
        eq(invitation.workspaceId, workspaceId),
        eq(invitation.email, email),
        eq(invitation.status, 'pending')
      ),
    })

    if (existingInvitation) {
      return actionErr({
        code: 'CONFLICT',
        message: 'An invitation has already been sent to this email',
        status: 409,
      })
    }

    // Check if user with this email already exists in the organization
    const existingUserInOrg = await db.query.user.findFirst({
      where: and(eq(user.workspaceId, workspaceId), eq(user.email, email)),
    })

    if (existingUserInOrg) {
      return actionErr({
        code: 'CONFLICT',
        message: 'A user with this email already exists in this organization',
        status: 409,
      })
    }

    // Create the invitation
    const invitationId = generateId('invite')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    const now = new Date()

    await db.insert(invitation).values({
      id: invitationId,
      workspaceId,
      email,
      name: input.name || null,
      role: input.role,
      status: 'pending',
      expiresAt,
      lastSentAt: now,
      inviterId: ctx.user.id,
    })

    // Build invitation link using workspace domain
    const tenantUrl = await getTenantUrl(workspaceId)
    const inviteLink = `${tenantUrl}/accept-invitation/${invitationId}`

    // Send invitation email
    await sendInvitationEmail({
      to: email,
      invitedByName: ctx.user.name,
      inviteeName: input.name || undefined,
      workspaceName: ctx.workspace.name,
      inviteLink,
    })

    return actionOk({
      success: true,
      invitationId,
      message: 'Invitation sent successfully',
    })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Cancel a pending invitation.
 */
export const cancelInvitationAction = withAction(
  cancelInvitationSchema,
  async (input, ctx) => {
    const invitationId = input.invitationId as InviteId

    const invitationRecord = await db.query.invitation.findFirst({
      where: and(
        eq(invitation.id, invitationId),
        eq(invitation.workspaceId, ctx.workspace.id),
        eq(invitation.status, 'pending')
      ),
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
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Resend an invitation email.
 */
export const resendInvitationAction = withAction(
  resendInvitationSchema,
  async (input, ctx) => {
    const invitationId = input.invitationId as InviteId

    const invitationRecord = await db.query.invitation.findFirst({
      where: and(
        eq(invitation.id, invitationId),
        eq(invitation.workspaceId, ctx.workspace.id),
        eq(invitation.status, 'pending')
      ),
    })

    if (!invitationRecord) {
      return actionErr({
        code: 'NOT_FOUND',
        message: 'Invitation not found',
        status: 404,
      })
    }

    // Build invitation link using workspace domain
    const tenantUrl = await getTenantUrl(ctx.workspace.id)
    const inviteLink = `${tenantUrl}/accept-invitation/${invitationId}`

    // Update last sent timestamp
    await db
      .update(invitation)
      .set({ lastSentAt: new Date() })
      .where(eq(invitation.id, invitationId))

    // Resend invitation email
    await sendInvitationEmail({
      to: invitationRecord.email,
      invitedByName: ctx.user.name,
      inviteeName: invitationRecord.name || undefined,
      workspaceName: ctx.workspace.name,
      inviteLink,
    })

    return actionOk({
      success: true,
      message: 'Invitation resent successfully',
    })
  },
  { roles: ['owner', 'admin'] }
)
