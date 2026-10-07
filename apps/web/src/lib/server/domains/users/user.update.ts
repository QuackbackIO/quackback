/**
 * Admin profile edit for a portal person (the People directory's edit pencil).
 *
 * One entry point, two storage targets keyed off principal type:
 *
 * - Identified user — the address is identity (`user.email`), guarded by the
 *   case-insensitive uniqueness rule every other writer obeys.
 * - Lead (anonymous principal) — the address is a contact hint
 *   (`principal.contactEmail`). This is an OVERWRITE, deliberately unlike the
 *   capture-once widget paths (`UPDATE ... WHERE contact_email IS NULL`): an
 *   admin correcting a typo must be able to replace an address already on
 *   file. The lead's `user.email` is a synthetic placeholder and is never
 *   touched. The edit re-keys duplicate detection immediately —
 *   `user.dedup.findDuplicatesForPrincipal` reads contactEmail.
 */

import { db, eq, and, sql, ne, isNull, principal, user } from '@/lib/server/db'
import type { PrincipalId, UserId } from '@quackback/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { acceptableContactEmail } from '@/lib/server/domains/principals/contact-email'
import { realEmail } from '@/lib/shared/anonymous-email'
import { syncPrincipalProfileById } from '@/lib/server/domains/principals/principal.factory'

export interface UpdatePortalUserProfileInput {
  principalId: PrincipalId
  /** New display name; undefined leaves it alone. */
  name?: string
  /** New address; null clears it; undefined leaves it alone. */
  email?: string | null
}

/**
 * The stored address, after checking that "Require SSO" allows the move: an
 * address at a domain that requires SSO belongs to that domain's provider, for
 * an admin's edit as for the person's own. Unchanged addresses pass, so renaming
 * someone at such a domain still works. The caller writes only while the address
 * is still this one, so a change in between cannot slip past the check.
 */
async function storedEmailAfterSsoCheck(userId: UserId, to: string | null): Promise<string | null> {
  const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId))
  const stored = row?.email ?? null
  const from = realEmail(stored)
  if (from?.toLowerCase() !== to) {
    const { assertEmailMoveAllowed } = await import('@/lib/server/auth/sso-managed-email')
    await assertEmailMoveAllowed({ userId, from, to })
  }
  return stored
}

function stillEmail(stored: string | null) {
  return stored === null ? isNull(user.email) : eq(user.email, stored)
}

function emailChangedMeanwhile(): never {
  throw new ConflictError(
    'EMAIL_CHANGED',
    "This person's email just changed. Reload and try again."
  )
}

export async function updatePortalUserProfile(
  input: UpdatePortalUserProfileInput
): Promise<{ updated: boolean }> {
  const rows = await db
    .select({ id: principal.id, userId: principal.userId, type: principal.type })
    .from(principal)
    .where(and(eq(principal.id, input.principalId), eq(principal.role, 'user')))
    .limit(1)
  const target = rows[0]
  if (!target?.userId) {
    throw new NotFoundError('USER_NOT_FOUND', 'User not found')
  }
  const isLead = target.type === 'anonymous'

  let updated = false

  if (input.email !== undefined) {
    if (isLead) {
      // Null clears; anything else must be an address we are willing to send to.
      const contactEmail = input.email === null ? null : acceptableContactEmail(input.email)
      if (input.email !== null && contactEmail === null) {
        throw new ValidationError('INVALID_EMAIL', 'Enter a valid email address')
      }
      await db.update(principal).set({ contactEmail }).where(eq(principal.id, input.principalId))
    } else if (input.email === null) {
      const stored = await storedEmailAfterSsoCheck(target.userId, null)
      const written = await db
        .update(user)
        .set({ email: null, emailVerified: false })
        .where(and(eq(user.id, target.userId), stillEmail(stored)))
        .returning({ id: user.id })
      if (written.length === 0) emailChangedMeanwhile()
    } else {
      const normalized = input.email.toLowerCase().trim()
      const stored = await storedEmailAfterSsoCheck(target.userId, normalized)
      const existing = await db
        .select({ id: user.id })
        .from(user)
        .where(and(sql`LOWER(${user.email}) = ${normalized}`, ne(user.id, target.userId)))
        .limit(1)
      if (existing.length > 0) {
        throw new ConflictError('EMAIL_IN_USE', 'Email already in use')
      }
      // An admin's typed address is not a proven one. Verification survives
      // only when the address itself is unchanged; otherwise providers that
      // match on verified addresses could sign someone else in to this account.
      const written = await db
        .update(user)
        .set({
          email: normalized,
          emailVerified: sql`CASE WHEN LOWER(${user.email}) = ${normalized} THEN ${user.emailVerified} ELSE false END`,
        })
        .where(and(eq(user.id, target.userId), stillEmail(stored)))
        .returning({ id: user.id })
      if (written.length === 0) emailChangedMeanwhile()
    }
    updated = true
  }

  if (input.name !== undefined) {
    const name = input.name.trim()
    await db.update(user).set({ name }).where(eq(user.id, target.userId))
    await syncPrincipalProfileById(input.principalId, { displayName: name })
    updated = true
  }

  return { updated }
}
