/**
 * Anonymous vote rate limiting.
 *
 * Counts anonymous sessions created from the given IP address within the
 * last hour. This limits how many anonymous identities (and thus unique
 * votes) a single IP can generate, regardless of vote/unvote toggling.
 */

import { db, principal, session, eq, and, sql } from '@/lib/server/db'

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
