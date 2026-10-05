/**
 * Anonymous vote rate limiting.
 *
 * Counts anonymous sessions created from the given IP address within the
 * last hour. This limits how many anonymous identities (and thus unique
 * votes) a single IP can generate, regardless of vote/unvote toggling.
 *
 * Callers pass `getClientIp()`; anonymous sessions record the same resolved
 * address when they are minted (see `auth/session-create.ts`).
 */

import { db, principal, session, eq, and, sql } from '@/lib/server/db'
import { incrementBucket } from '@/lib/server/utils/rate-bucket'

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
const ANON_POST_WINDOW_S = 60 * 60

/**
 * Reserve one anonymous idea for the submitting address. The reservation is a
 * single atomic bucket increment keyed on that address, so concurrent
 * submissions cannot all slip under the limit, minting a new anonymous identity
 * does not reset the budget, and only the address an idea came from is charged.
 * Fails open when the bucket store errors, like the other rate limits.
 * @returns true if the request is allowed (under limit)
 */
export async function reserveAnonPostSlot(clientIp: string): Promise<boolean> {
  const { count } = await incrementBucket({
    key: `anon:post:ip:${clientIp}`,
    windowSeconds: ANON_POST_WINDOW_S,
  })
  return count === null || count <= ANON_POST_RATE_LIMIT
}
