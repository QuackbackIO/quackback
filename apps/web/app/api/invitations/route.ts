import { withApiHandler, ApiError, successResponse, validateBody } from '@/lib/api-handler'
import { inviteSchema } from '@/lib/schemas/auth'
import { db, invitation, user, eq, and } from '@/lib/db'
import { sendInvitationEmail } from '@quackback/email'
import { generateId } from '@quackback/ids'

/**
 * POST /api/invitations
 *
 * Create a team member invitation with optional name.
 * This is a custom endpoint that bypasses Better-auth's inviteMember
 * to support the name field.
 */
export const POST = withApiHandler(
  async (request, { validation }) => {
    const body = await request.json()
    const { email, name, role } = validateBody(inviteSchema, body)

    const organizationId = validation.organization.id
    const inviterId = validation.user.id

    // Check if there's already a pending invitation for this email
    const existingInvitation = await db.query.invitation.findFirst({
      where: and(
        eq(invitation.organizationId, organizationId),
        eq(invitation.email, email.toLowerCase()),
        eq(invitation.status, 'pending')
      ),
    })

    if (existingInvitation) {
      throw new ApiError('An invitation has already been sent to this email', 400)
    }

    // Check if user with this email already exists in the organization
    const existingUserInOrg = await db.query.user.findFirst({
      where: and(eq(user.organizationId, organizationId), eq(user.email, email.toLowerCase())),
    })

    if (existingUserInOrg) {
      throw new ApiError('A user with this email already exists in this organization', 400)
    }

    // Create the invitation
    const invitationId = generateId('invite')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    const now = new Date()

    await db.insert(invitation).values({
      id: invitationId,
      organizationId,
      email: email.toLowerCase(),
      name: name || null,
      role,
      status: 'pending',
      expiresAt,
      lastSentAt: now,
      inviterId,
    })

    // Build invitation link
    const domain = process.env.APP_DOMAIN
    if (!domain) {
      throw new ApiError('APP_DOMAIN environment variable is required', 500)
    }
    const isLocalhost = domain.includes('localhost')
    const protocol = isLocalhost ? 'http' : 'https'
    const inviteLink = `${protocol}://${validation.organization.slug}.${domain}/accept-invitation/${invitationId}`

    // Send invitation email
    await sendInvitationEmail({
      to: email,
      invitedByName: validation.user.name,
      inviteeName: name || undefined,
      organizationName: validation.organization.name,
      inviteLink,
    })

    return successResponse(
      {
        success: true,
        invitationId,
        message: 'Invitation sent successfully',
      },
      201
    )
  },
  { roles: ['owner', 'admin'] }
)
