/**
 * Auto-link a portal user to a CRM contact based on their verified email.
 *
 * Called from better-auth's `databaseHooks.user.create.after` and
 * `user.update.after`. Idempotent and best-effort — failures are logged
 * but never thrown so a transient DB hiccup cannot break signup or session
 * mutation.
 *
 * Gated on `emailVerified === true` so we only ever associate identities
 * the user has demonstrably proven they own.
 */
import type { ContactId, UserId } from '@quackback/ids'

export interface LinkContactForUserInput {
  userId: UserId
  email: string | null | undefined
  emailVerified: boolean
  /** Anonymous (widget-only) users have no real email and must be skipped. */
  anonymous: boolean
}

export async function linkContactForUser(input: LinkContactForUserInput): Promise<void> {
  if (input.anonymous) return
  if (!input.email) return
  if (!input.emailVerified) return

  try {
    const { findOrCreateByEmail, linkContactToUser } =
      await import('@/lib/server/domains/organizations/contact.service')
    const contact = await findOrCreateByEmail({ email: input.email })
    await linkContactToUser({
      contactId: contact.id,
      userId: input.userId,
      linkedByPrincipalId: null,
    })
  } catch (err) {
    console.error('[auth:link-contact] failed to link user to contact', {
      userId: input.userId,
      error: err instanceof Error ? err.message : err,
    })
  }
}

export interface LinkContactForWidgetUserInput {
  userId: UserId
  email: string | null | undefined
  /**
   * True only when the identify call carried a verified `ssoToken` (HS256 JWT
   * signed with the workspace widget secret). Unverified identifies carry an
   * attacker-spoofable email and must NOT auto-link to a contact, mirroring
   * the portal's `emailVerified` gate.
   */
  verified: boolean
}

/**
 * Auto-link a widget user to a CRM contact when their identity has been
 * cryptographically verified via `ssoToken`. Used by `POST /api/widget/identify`
 * so subsequent widget requests can resolve a `contactId` and authorise
 * ticket list/detail/reply operations.
 *
 * Best-effort and idempotent — failures are logged and never thrown so a
 * transient DB hiccup cannot break widget identify.
 */
export async function linkContactForWidgetUser(
  input: LinkContactForWidgetUserInput
): Promise<{ contactId: ContactId | null }> {
  if (!input.verified) return { contactId: null }
  if (!input.email) return { contactId: null }

  try {
    const { findOrCreateByEmail, linkContactToUser } =
      await import('@/lib/server/domains/organizations/contact.service')
    const contact = await findOrCreateByEmail({ email: input.email })
    await linkContactToUser({
      contactId: contact.id,
      userId: input.userId,
      linkedByPrincipalId: null,
    })
    return { contactId: contact.id as ContactId }
  } catch (err) {
    console.error('[auth:link-contact] failed to link widget user to contact', {
      userId: input.userId,
      error: err instanceof Error ? err.message : err,
    })
    return { contactId: null }
  }
}
