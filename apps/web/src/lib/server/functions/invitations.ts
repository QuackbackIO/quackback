import { createServerFn } from '@tanstack/react-start'
import type { InviteId, PrincipalId, UserId } from '@quackback/ids'
import { generateId } from '@quackback/ids'
import { db, invitation, principal, eq } from '@/lib/server/db'
import { getSession } from './auth'

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
    console.log(`[fn:invitations] acceptInvitationFn: invitationId=${invitationId}`)
    try {
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

      // Parallelize invitation and member queries - they're independent
      const [inv, existingPrincipal] = await Promise.all([
        db.query.invitation.findFirst({
          where: eq(invitation.id, invitationId as InviteId),
        }),
        db.query.principal.findFirst({
          where: eq(principal.userId, userId),
        }),
      ])

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

      if (existingPrincipal) {
        // Update existing principal's role if the invitation grants a higher role
        const roleHierarchy = ['user', 'member', 'admin']
        const existingRoleIndex = roleHierarchy.indexOf(existingPrincipal.role)
        const newRoleIndex = roleHierarchy.indexOf(role)

        if (newRoleIndex > existingRoleIndex) {
          await db
            .update(principal)
            .set({ role })
            .where(eq(principal.id, existingPrincipal.id as PrincipalId))
        }
      } else {
        // Create new principal record
        await db.insert(principal).values({
          id: generateId('principal'),
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

      console.log(`[fn:invitations] acceptInvitationFn: accepted`)
      return { invitationId: invitationId as InviteId }
    } catch (error) {
      console.error(`[fn:invitations] ❌ acceptInvitationFn failed:`, error)
      throw error
    }
  })
