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

import { db, eq, and, sql, ne, principal, user } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { acceptableContactEmail } from '@/lib/server/domains/principals/contact-email'
import { syncPrincipalProfileById } from '@/lib/server/domains/principals/principal.factory'

export interface UpdatePortalUserProfileInput {
  principalId: PrincipalId
  /** New display name; undefined leaves it alone. */
  name?: string
  /** New address; null clears it; undefined leaves it alone. */
  email?: string | null
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
      await db.update(user).set({ email: null }).where(eq(user.id, target.userId))
    } else {
      const normalized = input.email.toLowerCase().trim()
      const existing = await db
        .select({ id: user.id })
        .from(user)
        .where(and(sql`LOWER(${user.email}) = ${normalized}`, ne(user.id, target.userId)))
        .limit(1)
      if (existing.length > 0) {
        throw new ConflictError('EMAIL_IN_USE', 'Email already in use')
      }
      await db.update(user).set({ email: normalized }).where(eq(user.id, target.userId))
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
