/**
 * Anonymous vote rate limiting.
 *
 * Counts votes from anonymous principals whose sessions originated from
 * the given IP address within the last hour.
 */

import { db, votes, principal, session, eq, and, sql } from '@/lib/server/db'

const ANON_RATE_LIMIT = 50

/**
 * Check if an IP is under the anonymous vote rate limit.
 * @returns true if the request is allowed (under limit)
 */
export async function checkAnonVoteRateLimit(clientIp: string): Promise<boolean> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(votes)
    .innerJoin(principal, eq(votes.principalId, principal.id))
    .where(
      and(
        eq(principal.type, 'anonymous'),
        sql`${votes.createdAt} > now() - interval '1 hour'`,
        sql`${principal.userId} IN (
          SELECT DISTINCT ${session.userId} FROM ${session}
          WHERE ${session.ipAddress} = ${clientIp}
        )`
      )
    )

  return (result?.count ?? 0) < ANON_RATE_LIMIT
}
