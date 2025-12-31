'use server'

import { db, invitation, member, eq } from '@/lib/db'
import { generateId } from '@quackback/ids'
import { getSession } from '@/lib/auth/server'
import type { InviteId, MemberId, UserId } from '@quackback/ids'
import { createServerFn } from '@tanstack/react-start'

/**
 * Accept a team invitation.
 *
 * This server function replaces Better Auth's organization plugin acceptInvitation.
 * It validates the invitation, creates/updates the member record, and marks the
 * invitation as accepted.
 *
 * Note: Uses createServerFn directly instead of withAuth because this needs to be
 * accessible to newly authenticated users who may not yet have a member record.
 */
export const acceptInvitationFn = createServerFn({ method: 'POST' })
  .inputValidator((invitationId: string) => invitationId)
  .handler(async ({ data: invitationId }) => {
    // Get current session
    const session = await getSession()
    if (!session?.user) {
      throw new Error('Not authenticated')
    }

    const userId = session.user.id as UserId
    const userEmail = session.user.email?.toLowerCase()

    if (!userEmail) {
      throw new Error('User email not found')
    }

    // Find the invitation
    const inv = await db.query.invitation.findFirst({
      where: eq(invitation.id, invitationId as InviteId),
    })

    if (!inv) {
      throw new Error('Invitation not found')
    }

    // Verify invitation is pending
    if (inv.status !== 'pending') {
      throw new Error(
        inv.status === 'accepted'
          ? 'This invitation has already been accepted'
          : 'This invitation is no longer valid'
      )
    }

    // Verify invitation hasn't expired
    if (new Date(inv.expiresAt) < new Date()) {
      throw new Error('This invitation has expired')
    }

    // Verify email matches
    if (inv.email.toLowerCase() !== userEmail) {
      throw new Error('This invitation was sent to a different email address')
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

    return { invitationId: invitationId as InviteId }
  })
