import { withApiHandlerParams, ApiError, successResponse, parseId } from '@/lib/api-handler'
import { db, invitation, eq, and } from '@quackback/db'
import { sendInvitationEmail } from '@quackback/email'

const RESEND_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes

/**
 * POST /api/invitations/[id]/resend
 *
 * Resend an invitation email with a 5-minute cooldown between sends.
 */
export const POST = withApiHandlerParams<{ id: string }>(
  async (request, { validation, params }) => {
    // Parse TypeID to UUID for database query
    const id = parseId(params.id, 'invite')
    const organizationId = validation.organization.id

    // Find the invitation
    const inv = await db.query.invitation.findFirst({
      where: and(
        eq(invitation.id, id),
        eq(invitation.organizationId, organizationId),
        eq(invitation.status, 'pending')
      ),
    })

    if (!inv) {
      throw new ApiError('Invitation not found or already accepted', 404)
    }

    // Check cooldown
    const lastSentAt = inv.lastSentAt || inv.createdAt
    const timeSinceLastSend = Date.now() - lastSentAt.getTime()

    if (timeSinceLastSend < RESEND_COOLDOWN_MS) {
      const remainingSeconds = Math.ceil((RESEND_COOLDOWN_MS - timeSinceLastSend) / 1000)
      throw new ApiError(
        `Please wait ${Math.ceil(remainingSeconds / 60)} minute(s) before resending`,
        429
      )
    }

    // Check if invitation is expired
    if (new Date() > inv.expiresAt) {
      throw new ApiError('This invitation has expired. Please create a new invitation.', 400)
    }

    // Build invitation link
    const domain = process.env.APP_DOMAIN
    if (!domain) {
      throw new ApiError('APP_DOMAIN environment variable is required', 500)
    }
    const isLocalhost = domain.includes('localhost')
    const protocol = isLocalhost ? 'http' : 'https'
    const inviteLink = `${protocol}://${validation.organization.slug}.${domain}/accept-invitation/${id}`

    // Send invitation email
    await sendInvitationEmail({
      to: inv.email,
      invitedByName: validation.user.name,
      inviteeName: inv.name || undefined,
      organizationName: validation.organization.name,
      inviteLink,
    })

    // Update lastSentAt
    const now = new Date()
    await db.update(invitation).set({ lastSentAt: now }).where(eq(invitation.id, id))

    return successResponse({
      success: true,
      message: 'Invitation resent successfully',
      lastSentAt: now.toISOString(),
    })
  },
  { roles: ['owner', 'admin'] }
)
