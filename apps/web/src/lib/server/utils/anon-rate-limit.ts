/**
 * Anonymous vote rate limiting.
 *
 * Counts anonymous sessions created from the given IP address within the
 * last hour. This limits how many anonymous identities (and thus unique
 * votes) a single IP can generate, regardless of vote/unvote toggling.
 */

import { db, principal, posts, session, eq, and, exists, sql } from '@/lib/server/db'

const ANON_RATE_LIMIT = 50

/**
 * Check if an IP is under the anonymous vote rate limit.
 * Counts anonymous sessions from this IP in the last hour.
 * @returns true if the request is allowed (under limit)
 */
export async function checkAnonVoteRateLimit(clientIp: string): Promise<boolean> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(session)
    .innerJoin(principal, eq(session.userId, principal.userId))
    .where(
      and(
        eq(principal.type, 'anonymous'),
        eq(session.ipAddress, clientIp),
        sql`${session.createdAt} > now() - interval '1 hour'`
      )
    )

  return (result?.count ?? 0) < ANON_RATE_LIMIT
}

/** Ideas anonymous visitors from one address may post in an hour. */
export const ANON_POST_RATE_LIMIT = 5

/**
 * Check if an IP is under the anonymous idea limit. Counts ideas posted in
 * the last hour by anonymous principals with a session from this address, so
 * minting a new anonymous identity does not reset the budget.
 * @returns true if the request is allowed (under limit)
 */
export async function checkAnonPostRateLimit(clientIp: string): Promise<boolean> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(posts)
    .innerJoin(principal, eq(posts.principalId, principal.id))
    .where(
      and(
        eq(principal.type, 'anonymous'),
        sql`${posts.createdAt} > now() - interval '1 hour'`,
        exists(
          db
            .select({ one: sql`1` })
            .from(session)
            .where(and(eq(session.userId, principal.userId), eq(session.ipAddress, clientIp)))
        )
      )
    )

  return (result?.count ?? 0) < ANON_POST_RATE_LIMIT
}
