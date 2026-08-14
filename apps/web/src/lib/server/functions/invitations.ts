import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import type { InviteId, PrincipalId, UserId } from '@quackback/ids'
import { generateId } from '@quackback/ids'
import { db, invitation, principal, user, and, eq, gt, or, sql } from '@/lib/server/db'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import { getSession } from '@/lib/server/auth/session'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'invitations' })

/**
 * Get invitation details for the complete-signup page.
 * Returns invite info + whether password auth is enabled.
 *
 * Note: Uses createServerFn directly instead of withAuth because this needs to be
 * accessible to newly authenticated users who may not yet have a member record.
 */
export const getInvitationDetailsFn = createServerFn({ method: 'GET' })
  .validator((invitationId: string) => invitationId)
  .handler(async ({ data: invitationId }) => {
    log.debug({ invitation_id: invitationId }, 'get invitation details: entry')

    const session = await getSession()
    if (!session?.user) {
      log.warn('get invitation details: no session')
      throw new Error('Not authenticated')
    }

    log.debug({ user_id: session.user.id }, 'get invitation details: session resolved')

    const [inv, settings, authConfig] = await Promise.all([
      db.query.invitation.findFirst({
        where: and(eq(invitation.id, invitationId as InviteId), eq(invitation.kind, 'team')),
        with: { inviter: true },
      }),
      db.query.settings.findFirst(),
      import('@/lib/server/domains/settings/settings.service').then((m) => m.getPublicAuthConfig()),
    ])

    if (!inv) {
      log.warn({ invitation_id: invitationId }, 'get invitation details: invitation not found')
      throw new Error(
        'This invitation could not be found. It may have been cancelled. Please contact your administrator.'
      )
    }

    log.debug(
      { invitation_id: invitationId, status: inv.status },
      'get invitation details: invitation found'
    )

    if (inv.status !== 'pending') {
      log.warn(
        { invitation_id: invitationId, status: inv.status },
        'get invitation details: invalid status'
      )
      throw new Error(
        inv.status === 'accepted'
          ? "This invitation has already been accepted. If you're having trouble accessing the dashboard, try signing in."
          : 'This invitation has been cancelled. Please ask your administrator to send a new one.'
      )
    }

    if (new Date(inv.expiresAt) < new Date()) {
      log.warn({ invitation_id: invitationId }, 'get invitation details: invitation expired')
      throw new Error('This invitation has expired. Please ask your administrator to resend it.')
    }

    // Verify the authenticated user's email matches the invitation
    if (inv.email.toLowerCase() !== session.user.email?.toLowerCase()) {
      log.warn(
        { invitation_id: invitationId, user_id: session.user.id },
        'get invitation details: email mismatch'
      )
      throw new Error(
        'This invitation was sent to a different email address. Please sign in with the email address that received the invitation, or ask your administrator to send a new invitation to your current email.'
      )
    }

    // If the user existed before this invitation, they already have an auth method —
    // skip password setup entirely (it's just a role upgrade).
    // For new users created by the magic link, offer optional password setup.
    const isExistingUser = new Date(session.user.createdAt) < inv.createdAt
    const passwordEnabled = !isExistingUser && (authConfig.oauth.password ?? true)

    log.debug(
      {
        invitation_id: invitationId,
        password_enabled: passwordEnabled,
        is_existing_user: isExistingUser,
      },
      'get invitation details: ok'
    )

    return {
      invite: {
        name: inv.name,
        email: inv.email,
        role: inv.role,
        workspaceName: settings?.name ?? 'Quackback',
        inviterName: inv.inviter?.name ?? null,
      },
      passwordEnabled,
    }
  })

const acceptInvitationSchema = z.object({
  invitationId: z.string(),
  name: z.string().min(2).optional(),
})

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
  .validator(acceptInvitationSchema)
  .handler(async ({ data }) => {
    const { invitationId, name } = data
    log.debug({ invitation_id: invitationId }, 'accept invitation: entry')

    const session = await getSession()
    if (!session?.user) {
      log.warn('accept invitation: no session')
      throw new Error('Your session has expired. Please sign in again using the invitation link.')
    }

    const userId = session.user.id as UserId
    const userEmail = session.user.email?.toLowerCase()
    log.debug({ user_id: userId }, 'accept invitation: session resolved')

    if (!userEmail) {
      throw new Error(
        'Your account is missing an email address. Please contact your administrator.'
      )
    }

    let claimed: typeof invitation.$inferSelect
    try {
      claimed = await db.transaction(async (tx) => {
        // Email and expiry stay in the UPDATE so a rejected accept never writes accepted.
        const [row] = await tx
          .update(invitation)
          .set({ status: 'accepted' })
          .where(
            and(
              eq(invitation.id, invitationId as InviteId),
              eq(invitation.status, 'pending'),
              eq(invitation.kind, 'team'),
              sql`lower(${invitation.email}) = ${userEmail}`,
              gt(invitation.expiresAt, new Date())
            )
          )
          .returning()

        if (!row) {
          const inv = await tx.query.invitation.findFirst({
            where: and(eq(invitation.id, invitationId as InviteId), eq(invitation.kind, 'team')),
          })
          log.warn(
            { invitation_id: invitationId, exists: !!inv, status: inv?.status },
            'accept invitation: claim failed'
          )
          if (!inv) {
            throw new Error('This invitation could not be found. It may have been cancelled.')
          }
          if (inv.status === 'accepted') {
            throw new Error('This invitation has already been accepted')
          }
          if (inv.status === 'canceled') {
            throw new Error(
              'This invitation has been cancelled. Please ask your administrator to send a new one.'
            )
          }
          if (inv.status === 'expired' || new Date(inv.expiresAt) < new Date()) {
            throw new Error(
              'This invitation has expired. Please ask your administrator to resend it.'
            )
          }
          if (inv.email.toLowerCase() !== userEmail) {
            throw new Error(
              'This invitation was sent to a different email address. Please sign in with the correct email.'
            )
          }
          throw new Error(
            'This invitation has been cancelled. Please ask your administrator to send a new one.'
          )
        }

        const role = row.role || 'member'
        const displayName = name?.trim() || undefined

        const existingPrincipal = await tx.query.principal.findFirst({
          where: eq(principal.userId, userId),
        })

        if (existingPrincipal) {
          const roleHierarchy = ['user', 'member', 'admin']
          const existingRoleIndex = roleHierarchy.indexOf(existingPrincipal.role)
          const newRoleIndex = roleHierarchy.indexOf(role)

          const updates: Record<string, unknown> = {}
          if (newRoleIndex > existingRoleIndex) updates.role = role
          if (displayName) updates.displayName = displayName

          if (Object.keys(updates).length > 0) {
            await tx
              .update(principal)
              .set(updates)
              .where(eq(principal.id, existingPrincipal.id as PrincipalId))
          }
        } else {
          await tx.insert(principal).values({
            id: generateId('principal'),
            userId,
            role,
            displayName,
            createdAt: new Date(),
          })
        }

        if (displayName) {
          await tx.update(user).set({ name: displayName }).where(eq(user.id, userId))
        }

        return row
      })
    } catch (error) {
      log.error({ err: error }, 'accept invitation failed')
      throw error
    }

    try {
      const { revokeMagicLinkTokens } = await import('@/lib/server/auth/magic-link-mint')
      await revokeMagicLinkTokens(claimed.magicLinkTokens)
    } catch (revokeError) {
      log.error({ err: revokeError }, 'token revoke failed')
    }

    log.info({ invitation_id: invitationId }, 'accept invitation: accepted')
    return { invitationId: invitationId as InviteId }
  })

/**
 * Set a password for the current user via Better Auth's internal API.
 *
 * Better Auth's setPassword endpoint has no HTTP path (server-side only),
 * so we must call auth.api.setPassword() from a server function.
 */
export const setPasswordFn = createServerFn({ method: 'POST' })
  .validator(z.object({ newPassword: z.string().min(8) }))
  .handler(async ({ data }) => {
    const { auth } = await import('@/lib/server/auth')
    await auth.api.setPassword({
      body: { newPassword: data.newPassword },
      headers: getRequestHeaders(),
    })
    return { status: true }
  })

/**
 * Get workspace branding for the invite page.
 * Public - no authentication required.
 */
export const getInviteBrandingFn = createServerFn({ method: 'GET' })
  .validator((invitationId: string) => invitationId)
  .handler(async ({ data: invitationId }) => {
    const [settings, inv] = await Promise.all([
      db.query.settings.findFirst(),
      db.query.invitation
        .findFirst({
          where: and(
            eq(invitation.id, invitationId as InviteId),
            or(eq(invitation.kind, 'team'), eq(invitation.kind, 'portal'))
          ),
          with: { inviter: true },
        })
        .catch(() => null),
    ])

    return {
      workspaceName: settings?.name ?? 'Quackback',
      logoUrl: getPublicUrlOrNull(settings?.logoKey),
      inviterName: inv?.inviter?.name ?? null,
    }
  })
