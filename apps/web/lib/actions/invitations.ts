'use server'

import { db, invitation, member, eq, and } from '@/lib/db'
import { generateId } from '@quackback/ids'
import { getSession } from '@/lib/auth/server'
import { syncWorkspaceSeats, isBillableRole } from '@quackback/ee/billing'
import type { InviteId, MemberId, UserId } from '@quackback/ids'

export type AcceptInvitationResult = {
  success: boolean
  error?: string
}

/**
 * Accept a team invitation.
 *
 * This server action replaces Better Auth's organization plugin acceptInvitation.
 * It validates the invitation, creates/updates the member record, and marks the
 * invitation as accepted.
 */
export async function acceptInvitationAction(
  invitationId: string
): Promise<AcceptInvitationResult> {
  try {
    // Get current session
    const session = await getSession()
    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const userId = session.user.id as UserId
    const userEmail = session.user.email?.toLowerCase()

    if (!userEmail) {
      return { success: false, error: 'User email not found' }
    }

    // Find the invitation
    const inv = await db.query.invitation.findFirst({
      where: eq(invitation.id, invitationId as InviteId),
    })

    if (!inv) {
      return { success: false, error: 'Invitation not found' }
    }

    // Verify invitation is pending
    if (inv.status !== 'pending') {
      return {
        success: false,
        error:
          inv.status === 'accepted'
            ? 'This invitation has already been accepted'
            : 'This invitation is no longer valid',
      }
    }

    // Verify invitation hasn't expired
    if (new Date(inv.expiresAt) < new Date()) {
      return { success: false, error: 'This invitation has expired' }
    }

    // Verify email matches
    if (inv.email.toLowerCase() !== userEmail) {
      return {
        success: false,
        error: 'This invitation was sent to a different email address',
      }
    }

    const role = inv.role || 'member'

    // Check if member record already exists
    const existingMember = await db.query.member.findFirst({
      where: eq(member.userId, userId),
    })

    if (existingMember) {
      // Update existing member's role if the invitation grants a higher role
      const roleHierarchy = ['user', 'member', 'admin', 'owner']
      const existingRoleIndex = roleHierarchy.indexOf(existingMember.role)
      const newRoleIndex = roleHierarchy.indexOf(role)

      if (newRoleIndex > existingRoleIndex) {
        await db
          .update(member)
          .set({ role })
          .where(eq(member.id, existingMember.id as MemberId))
      }
    } else {
      // Create new member record
      await db.insert(member).values({
        id: generateId('member'),
        userId,
        role,
        createdAt: new Date(),
      })
    }

    // Mark invitation as accepted
    await db
      .update(invitation)
      .set({ status: 'accepted' })
      .where(eq(invitation.id, invitationId as InviteId))

    return { success: true }
  } catch (error) {
    console.error('Error accepting invitation:', error)
    return {
      success: false,
      error: 'An unexpected error occurred while accepting the invitation',
    }
  }
}
