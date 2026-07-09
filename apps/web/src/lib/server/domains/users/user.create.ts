/**
 * Ad-hoc portal user creation (admin-initiated).
 *
 * Used by the AuthorSelector (attribute feedback to someone not yet in the
 * system) and the Users view's "New person" dialog. Email is optional —
 * external contacts may not have one.
 *
 * `emailVerified` is a TRUST decision, not a data field: it grants the same
 * portal access as a confirmed email (domain-match, invite claim, segment
 * portal-access grants). Asserting it therefore emits a
 * `user.email_verified.asserted` audit event recording who vouched for it.
 */

import { db, eq, user } from '@/lib/server/db'
import { generateId, type PrincipalId, type UserId } from '@quackback/ids'
import { createPrincipal } from '@/lib/server/domains/principals/principal.factory'
import { recordAuditEvent, type AuditActor } from '@/lib/server/audit/log'
import { ValidationError } from '@/lib/shared/errors'

export interface CreatePortalUserInput {
  name: string
  email?: string
  /**
   * Assert the email as verified without the user confirming it.
   * Ignored when no email is provided. Defaults to false.
   */
  emailVerified?: boolean
}

export interface CreatePortalUserResult {
  principalId: PrincipalId
  userId: UserId
  name: string
  email: string | null
  emailVerified: boolean
}

/**
 * Create a portal user + principal (role='user'). Throws ValidationError when
 * the email is already taken. When `emailVerified` is asserted, `audit.actor`
 * identifies who vouched for the address in the audit trail.
 */
export async function createPortalUser(
  input: CreatePortalUserInput,
  audit?: { actor: AuditActor; headers?: Headers }
): Promise<CreatePortalUserResult> {
  const normalizedEmail = input.email ? input.email.toLowerCase().trim() : null

  // Check email uniqueness if provided
  if (normalizedEmail) {
    const existing = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, normalizedEmail))
      .limit(1)
    if (existing.length > 0) {
      throw new ValidationError('EMAIL_TAKEN', 'A user with this email already exists')
    }
  }

  const userId = generateId('user')
  const principalId = generateId('principal')
  const trimmedName = input.name.trim()
  // Verified is only meaningful with an email to verify.
  const emailVerified = normalizedEmail ? (input.emailVerified ?? false) : false

  await db.insert(user).values({
    id: userId,
    name: trimmedName,
    email: normalizedEmail,
    emailVerified,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  await createPrincipal({
    id: principalId,
    userId,
    role: 'user',
    displayName: trimmedName,
  })

  if (emailVerified) {
    await recordAuditEvent({
      event: 'user.email_verified.asserted',
      actor: audit?.actor ?? {},
      headers: audit?.headers,
      target: { type: 'user', id: userId },
      // The user did not exist before this call — the assertion is part of creation.
      before: null,
      after: { emailVerified: true },
      metadata: { source: 'admin.create_portal_user', email: normalizedEmail },
    })
  }

  return {
    principalId,
    userId,
    name: trimmedName,
    email: normalizedEmail,
    emailVerified,
  }
}
