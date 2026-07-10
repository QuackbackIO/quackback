/**
 * Email-based contact dedup lookup.
 *
 * Backs the admin "New person" dialog: before creating an ad-hoc contact the
 * UI asks whether the email is already known. Two sources can match:
 *
 * - `user.email` — at most ONE row (case-sensitive partial unique index, but
 *   every app writer lowercases before insert). Any user match blocks
 *   creation — the unique index means creating over it can only fail. The
 *   `emailVerified` state is reported for display.
 * - `principal.contactEmail` — captured on anonymous visitors (leads) by the
 *   messenger. NO uniqueness: anonymous identities are localStorage-scoped
 *   per browser, so MULTIPLE leads can legitimately share one email. The
 *   lookup must return every one of them.
 */

import { db, eq, and, sql, principal, user } from '@/lib/server/db'
import type { PrincipalId, UserId } from '@quackback/ids'

export type ContactEmailMatchType = 'verified_user' | 'unverified_user' | 'lead'

export interface ContactEmailMatch {
  type: ContactEmailMatchType
  principalId: PrincipalId
  userId: UserId | null
  /** Display name — principal.displayName with user.name as fallback. */
  name: string
  /** The matched address as stored (user.email or principal.contactEmail). */
  email: string
  avatarUrl: string | null
}

/**
 * Find every existing identity matching an email, case-insensitively:
 * the (single) user row plus every anonymous lead whose captured
 * contactEmail matches. Returns [] for a blank input.
 */
export async function findContactsByEmail(rawEmail: string): Promise<ContactEmailMatch[]> {
  const normalized = rawEmail.trim().toLowerCase()
  if (!normalized) return []

  // LOWER(email) rides the user_email_lower_idx functional index.
  const userRows = await db
    .select({
      principalId: principal.id,
      userId: user.id,
      name: user.name,
      displayName: principal.displayName,
      email: user.email,
      emailVerified: user.emailVerified,
      avatarUrl: principal.avatarUrl,
    })
    .from(user)
    .innerJoin(principal, eq(principal.userId, user.id))
    .where(sql`LOWER(${user.email}) = ${normalized}`)

  // Leads: every anonymous principal whose captured contact email matches.
  // Writers normalize before insert, but compare case-insensitively anyway —
  // the set is small (partial index on contact_email keeps the scan bounded).
  const leadRows = await db
    .select({
      principalId: principal.id,
      userId: principal.userId,
      displayName: principal.displayName,
      contactEmail: principal.contactEmail,
      avatarUrl: principal.avatarUrl,
    })
    .from(principal)
    .where(
      and(eq(principal.type, 'anonymous'), sql`LOWER(${principal.contactEmail}) = ${normalized}`)
    )

  return [
    ...userRows.map(
      (row): ContactEmailMatch => ({
        type: row.emailVerified ? 'verified_user' : 'unverified_user',
        principalId: row.principalId as PrincipalId,
        userId: row.userId as UserId,
        name: row.displayName || row.name,
        email: row.email ?? normalized,
        avatarUrl: row.avatarUrl,
      })
    ),
    ...leadRows.map(
      (row): ContactEmailMatch => ({
        type: 'lead',
        principalId: row.principalId as PrincipalId,
        userId: row.userId as UserId | null,
        name: row.displayName || 'Anonymous visitor',
        email: row.contactEmail ?? normalized,
        avatarUrl: row.avatarUrl,
      })
    ),
  ]
}
