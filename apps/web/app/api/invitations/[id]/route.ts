import { withApiHandlerParams, ApiError, successResponse, parseId } from '@/lib/api-handler'
import { db, invitation, eq, and } from '@quackback/db'

/**
 * DELETE /api/invitations/[id]
 *
 * Cancel a pending invitation.
 */
export const DELETE = withApiHandlerParams<{ id: string }>(
  async (request, { validation, params }) => {
    // Parse TypeID to UUID for database query
    const id = parseId(params.id, 'invite')
    const organizationId = validation.organization.id

    // Find the invitation
    const inv = await db.query.invitation.findFirst({
      where: and(eq(invitation.id, id), eq(invitation.organizationId, organizationId)),
    })

    if (!inv) {
      throw new ApiError('Invitation not found', 404)
    }

    if (inv.status !== 'pending') {
      throw new ApiError('Only pending invitations can be cancelled', 400)
    }

    // Update status to cancelled
    await db.update(invitation).set({ status: 'cancelled' }).where(eq(invitation.id, id))

    return successResponse({
      success: true,
      message: 'Invitation cancelled',
    })
  },
  { roles: ['owner', 'admin'] }
)
