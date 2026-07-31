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

import { db, eq, ne, and, or, inArray, sql, principal, user } from '@/lib/server/db'
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

export type DuplicateMatchReason = 'email' | 'name'

export interface DuplicatePrincipalMatch {
  principalId: PrincipalId
  userId: UserId | null
  /** Anonymous (lead) principals can be merged away; identified users cannot. */
  isLead: boolean
  /** Display name — principal.displayName with user.name as fallback. */
  name: string
  /** The match's reachable address (user.email, else contactEmail), if any. */
  email: string | null
  avatarUrl: string | null
  /** Why the principal is flagged; both when email and name collide. */
  reasons: DuplicateMatchReason[]
}

/**
 * Trigram floor for "near-identical" names. similarity('Jon Smith',
 * 'John Smith') ≈ 0.64; 0.5 catches one-token edits and swaps without
 * matching merely-similar first names. pg_trgm is provisioned by migrations.
 */
const NAME_SIMILARITY_THRESHOLD = 0.5

/**
 * Find other portal principals that look like the same person as the given
 * one: sharing an address (user.email OR contactEmail, compared
 * case-insensitively across BOTH sources) or carrying a near-identical
 * display name. Team members and service principals are out of scope — the
 * warning lives on the portal-people directory. Returns [] for an unknown
 * principal. Capped: a profile warning lists a handful, not a report.
 */
export async function findDuplicatesForPrincipal(
  principalId: PrincipalId
): Promise<DuplicatePrincipalMatch[]> {
  const selfRows = await db
    .select({
      id: principal.id,
      displayName: principal.displayName,
      contactEmail: principal.contactEmail,
      userName: user.name,
      userEmail: user.email,
    })
    .from(principal)
    .leftJoin(user, eq(user.id, principal.userId))
    .where(eq(principal.id, principalId))

  const self = selfRows[0]
  if (!self) return []

  // The synthetic placeholder minted for leads (temp-…@anon.quackback.io) is
  // unique per identity, so including user.email here is collision-free.
  const emails = [self.userEmail, self.contactEmail]
    .map((e) => e?.trim().toLowerCase())
    .filter((e): e is string => !!e)
  const selfName = (self.displayName || self.userName || '').trim().toLowerCase()

  const matched = new Map<string, DuplicatePrincipalMatch>()
  const addMatch = (
    row: {
      principalId: string
      userId: string | null
      type: string
      displayName: string | null
      userName: string | null
      userEmail: string | null
      contactEmail: string | null
      avatarUrl: string | null
    },
    reason: DuplicateMatchReason
  ) => {
    const existing = matched.get(row.principalId)
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason)
      return
    }
    matched.set(row.principalId, {
      principalId: row.principalId as PrincipalId,
      userId: row.userId as UserId | null,
      isLead: row.type === 'anonymous',
      name: row.displayName || row.userName || 'Anonymous visitor',
      email: row.userEmail ?? row.contactEmail,
      avatarUrl: row.avatarUrl,
      reasons: [reason],
    })
  }

  const candidateColumns = {
    principalId: principal.id,
    userId: principal.userId,
    type: principal.type,
    displayName: principal.displayName,
    userName: user.name,
    userEmail: user.email,
    contactEmail: principal.contactEmail,
    avatarUrl: principal.avatarUrl,
  }
  // Portal people only — the directory surface this warning renders on.
  const scope = and(ne(principal.id, principalId), eq(principal.role, 'user'))

  if (emails.length > 0) {
    const emailRows = await db
      .select(candidateColumns)
      .from(principal)
      .leftJoin(user, eq(user.id, principal.userId))
      .where(
        and(
          scope,
          or(
            inArray(sql`LOWER(${user.email})`, emails),
            inArray(sql`LOWER(${principal.contactEmail})`, emails)
          )
        )
      )
      .limit(10)
    for (const row of emailRows) addMatch(row, 'email')
  }

  // Short names trigram-match too loosely ("Al" ≈ "Al B"); require 4+ chars.
  if (selfName.length >= 4) {
    const nameRows = await db
      .select(candidateColumns)
      .from(principal)
      .leftJoin(user, eq(user.id, principal.userId))
      .where(
        and(
          scope,
          sql`similarity(LOWER(COALESCE(${principal.displayName}, ${user.name})), ${selfName}) >= ${NAME_SIMILARITY_THRESHOLD}`
        )
      )
      .limit(10)
    for (const row of nameRows) addMatch(row, 'name')
  }

  // Address collisions are the stronger signal; list them first.
  return [...matched.values()]
    .sort((a, b) => Number(b.reasons.includes('email')) - Number(a.reasons.includes('email')))
    .slice(0, 10)
}
