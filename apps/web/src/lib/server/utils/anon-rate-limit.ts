/**
 * Anonymous vote rate limiting.
 *
 * Counts anonymous sessions created from the given IP address within the
 * last hour. This limits how many anonymous identities (and thus unique
 * votes) a single IP can generate, regardless of vote/unvote toggling.
 *
 * Callers pass `getClientIp()`; anonymous sessions record the same resolved
 * address when they are minted (see `assignSessionScope` in `auth/session-audience.ts`).
 */

import { db, principal, session, eq, and, sql } from '@/lib/server/db'
import { bucketRetryAfter, incrementBucket, incrementBuckets } from '@/lib/server/utils/rate-bucket'

const ANON_RATE_LIMIT = 50
const ANON_VOTE_WINDOW_S = 60 * 60

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

/**
 * Seconds until an address over the vote limit may vote again: when the
 * oldest anonymous session it minted in the last hour leaves the window.
 * Only called on the refused path.
 */
export async function anonVoteRetryAfter(clientIp: string): Promise<number> {
  const [row] = await db
    .select({
      seconds: sql<number>`ceil(extract(epoch from (min(${session.createdAt}) + interval '1 hour' - now())))::int`,
    })
    .from(session)
    .innerJoin(principal, eq(session.userId, principal.userId))
    .where(
      and(
        eq(principal.type, 'anonymous'),
        eq(session.ipAddress, clientIp),
        sql`${session.createdAt} > now() - interval '1 hour'`
      )
    )
  const seconds = row?.seconds
  return typeof seconds === 'number' && seconds > 0 ? seconds : ANON_VOTE_WINDOW_S
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

/** Articles one address may count a view of in an hour. */
export const ARTICLE_VIEW_RATE_LIMIT = 120
const ARTICLE_VIEW_WINDOW_S = 60 * 60

/**
 * Reserve one article view for an address. A view counts once per article per
 * address in an hour (a reload or reopen does not count again), and one
 * address counts at most {@link ARTICLE_VIEW_RATE_LIMIT} views an hour, so the
 * public view endpoint cannot push an article up the popular list. Both
 * buckets move in one statement. Fails open, like the other rate limits.
 * @returns true if the view should be counted
 */
export async function reserveArticleView(clientIp: string, articleId: string): Promise<boolean> {
  const [perAddress, perArticle] = await incrementBuckets([
    { key: `hc:view:ip:${clientIp}`, windowSeconds: ARTICLE_VIEW_WINDOW_S },
    { key: `hc:view:ip:${clientIp}:article:${articleId}`, windowSeconds: ARTICLE_VIEW_WINDOW_S },
  ])
  const underCap = perAddress === null || perAddress <= ARTICLE_VIEW_RATE_LIMIT
  const firstView = perArticle === null || perArticle === 1
  return underCap && firstView
}

/** Seconds until an address over the anonymous idea limit may post again. */
export async function anonPostRetryAfter(clientIp: string): Promise<number> {
  return bucketRetryAfter({ key: `anon:post:ip:${clientIp}`, windowSeconds: ANON_POST_WINDOW_S })
}
