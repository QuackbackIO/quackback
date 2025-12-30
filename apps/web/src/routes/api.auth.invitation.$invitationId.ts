import { createFileRoute } from '@tanstack/react-router'
import { db, invitation, eq } from '@/lib/db'
import { isValidTypeId, type InviteId } from '@quackback/ids'

export const Route = createFileRoute('/api/auth/invitation/$invitationId')({
  server: {
    handlers: {
      /**
       * GET /api/auth/invitation/[invitationId]
       * Public endpoint to get invitation details for signup form
       */
      GET: async ({ request: _request, params }) => {
        try {
          const { invitationId: invitationIdParam } = params

          // Validate TypeID format
          if (!isValidTypeId(invitationIdParam, 'invite')) {
            return Response.json({ error: 'Invalid invitation ID format' }, { status: 400 })
          }
          const invitationId = invitationIdParam as InviteId

          // Get app settings
          const org = await db.query.settings.findFirst()
          if (!org) {
            return Response.json({ error: 'App not configured' }, { status: 500 })
          }

          // Find the invitation
          const inv = await db.query.invitation.findFirst({
            where: eq(invitation.id, invitationId),
            with: {
              inviter: true,
            },
          })

          if (!inv) {
            return Response.json({ error: 'Invitation not found' }, { status: 404 })
          }

          // Check invitation status
          if (inv.status !== 'pending') {
            return Response.json(
              { error: 'This invitation has already been used or cancelled' },
              { status: 400 }
            )
          }

          // Check expiration
          if (new Date() > inv.expiresAt) {
            return Response.json(
              { error: 'This invitation has expired. Please request a new one.' },
              { status: 400 }
            )
          }

          // Return invitation details (limited info for security)
          return Response.json({
            id: inv.id,
            email: inv.email,
            name: inv.name || null,
            role: inv.role,
            workspaceName: org.name,
            inviterName: inv.inviter?.name || null,
          })
        } catch (error) {
          console.error('[Get Invitation] Error:', error)
          return Response.json({ error: 'Failed to get invitation' }, { status: 500 })
        }
      },
    },
  },
})
