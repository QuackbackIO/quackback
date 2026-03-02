import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import type { InviteId, PrincipalId, UserId } from '@quackback/ids'
import { generateId } from '@quackback/ids'
import { db, invitation, principal, user, account, and, eq } from '@/lib/server/db'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import { getSession } from './auth'

/**
 * Get invitation details for the accept-invitation page.
 * Returns invite info + whether password auth is enabled.
 *
 * Note: Uses createServerFn directly instead of withAuth because this needs to be
 * accessible to newly authenticated users who may not yet have a member record.
 */
export const getInvitationDetailsFn = createServerFn({ method: 'GET' })
  .inputValidator((invitationId: string) => invitationId)
  .handler(async ({ data: invitationId }) => {
    const session = await getSession()
    if (!session?.user) {
      throw new Error('Not authenticated')
    }

    const [inv, settings, authConfig, credentialAccount] = await Promise.all([
      db.query.invitation.findFirst({
        where: eq(invitation.id, invitationId as InviteId),
        with: { inviter: true },
      }),
      db.query.settings.findFirst(),
      import('@/lib/server/domains/settings/settings.service').then((m) => m.getPublicAuthConfig()),
      db.query.account.findFirst({
        where: and(
          eq(account.userId, session.user.id as UserId),
          eq(account.providerId, 'credential')
        ),
        columns: { password: true },
      }),
    ])

    if (!inv) {
      throw new Error(
        'This invitation could not be found. It may have been cancelled. Please contact your administrator.'
      )
    }

    if (inv.status !== 'pending') {
      throw new Error(
        inv.status === 'accepted'
          ? "This invitation has already been accepted. If you're having trouble accessing the dashboard, try signing in."
          : 'This invitation has been cancelled. Please ask your administrator to send a new one.'
      )
    }

    if (new Date(inv.expiresAt) < new Date()) {
      throw new Error('This invitation has expired. Please ask your administrator to resend it.')
    }

    // Verify the authenticated user's email matches the invitation
    if (inv.email.toLowerCase() !== session.user.email?.toLowerCase()) {
      throw new Error(
        'This invitation was sent to a different email address. Please sign in with the email address that received the invitation, or ask your administrator to send a new invitation to your current email.'
      )
    }

    const passwordEnabled = authConfig.oauth.password ?? true
    const requiresPasswordSetup = passwordEnabled && !credentialAccount?.password

    return {
      invite: {
        name: inv.name,
        email: inv.email,
        role: inv.role,
        workspaceName: settings?.name ?? 'Quackback',
        inviterName: inv.inviter?.name ?? null,
      },
      passwordEnabled,
      requiresPasswordSetup,
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
  .inputValidator(acceptInvitationSchema)
  .handler(async ({ data }) => {
    const { invitationId, name } = data
    console.log(`[fn:invitations] acceptInvitationFn: invitationId=${invitationId}`)
    // Track whether we successfully claimed the invitation so the catch
    // block only rolls back when we actually changed its status.
    let didClaim = false
    try {
      // Get current session
      const session = await getSession()
      if (!session?.user) {
        throw new Error('Your session has expired. Please sign in again using the invitation link.')
      }

      const userId = session.user.id as UserId
      const userEmail = session.user.email?.toLowerCase()

      if (!userEmail) {
        throw new Error(
          'Your account is missing an email address. Please contact your administrator.'
        )
      }

      // Atomically claim the invitation with a conditional update to prevent
      // double-accept race conditions (e.g., double-click, network retry).
      const [claimed] = await db
        .update(invitation)
        .set({ status: 'accepted' })
        .where(and(eq(invitation.id, invitationId as InviteId), eq(invitation.status, 'pending')))
        .returning()

      if (!claimed) {
        // Either doesn't exist, already accepted, cancelled, or expired
        const inv = await db.query.invitation.findFirst({
          where: eq(invitation.id, invitationId as InviteId),
        })
        if (!inv) throw new Error('This invitation could not be found. It may have been cancelled.')
        throw new Error(
          inv.status === 'accepted'
            ? 'This invitation has already been accepted'
            : 'This invitation has been cancelled. Please ask your administrator to send a new one.'
        )
      }

      didClaim = true

      async function rollbackAndThrow(message: string): Promise<never> {
        await db
          .update(invitation)
          .set({ status: 'pending' })
          .where(eq(invitation.id, invitationId as InviteId))
        throw new Error(message)
      }

      if (new Date(claimed.expiresAt) < new Date()) {
        await rollbackAndThrow(
          'This invitation has expired. Please ask your administrator to resend it.'
        )
      }

      if (claimed.email.toLowerCase() !== userEmail) {
        await rollbackAndThrow(
          'This invitation was sent to a different email address. Please sign in with the correct email.'
        )
      }

      const role = claimed.role || 'member'
      const displayName = name?.trim() || undefined

      const existingPrincipal = await db.query.principal.findFirst({
        where: eq(principal.userId, userId),
      })

      if (existingPrincipal) {
        // Update existing principal's role if the invitation grants a higher role
        const roleHierarchy = ['user', 'member', 'admin']
        const existingRoleIndex = roleHierarchy.indexOf(existingPrincipal.role)
        const newRoleIndex = roleHierarchy.indexOf(role)

        const updates: Record<string, unknown> = {}
        if (newRoleIndex > existingRoleIndex) updates.role = role
        if (displayName) updates.displayName = displayName

        if (Object.keys(updates).length > 0) {
          await db
            .update(principal)
            .set(updates)
            .where(eq(principal.id, existingPrincipal.id as PrincipalId))
        }
      } else {
        // Create new principal record
        await db.insert(principal).values({
          id: generateId('principal'),
          userId,
          role,
          displayName,
          createdAt: new Date(),
        })
      }

      // Update user name if provided
      if (displayName) {
        await db.update(user).set({ name: displayName }).where(eq(user.id, userId))
      }

      console.log(`[fn:invitations] acceptInvitationFn: accepted`)
      return { invitationId: invitationId as InviteId }
    } catch (error) {
      console.error(`[fn:invitations] ❌ acceptInvitationFn failed:`, error)
      // Only roll back if we actually claimed the invitation. If the error
      // came from the !claimed branch (already accepted / invalid), rolling
      // back would incorrectly reopen it to 'pending'.
      if (didClaim) {
        try {
          await db
            .update(invitation)
            .set({ status: 'pending' })
            .where(eq(invitation.id, invitationId as InviteId))
        } catch (rollbackError) {
          console.error(`[fn:invitations] ❌ rollback failed:`, rollbackError)
        }
      }
      throw error
    }
  })

/**
 * Set a password for the current user via Better Auth's internal API.
 *
 * Better Auth's setPassword endpoint has no HTTP path (server-side only),
 * so we must call auth.api.setPassword() from a server function.
 */
export const setPasswordFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ newPassword: z.string().min(8) }))
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
  .inputValidator((invitationId: string) => invitationId)
  .handler(async ({ data: invitationId }) => {
    const [settings, inv] = await Promise.all([
      db.query.settings.findFirst(),
      db.query.invitation
        .findFirst({
          where: eq(invitation.id, invitationId as InviteId),
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
