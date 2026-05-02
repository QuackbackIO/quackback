import { createFileRoute } from '@tanstack/react-router'
import { inArray, isNull, sql } from 'drizzle-orm'
import { db, posts, boards, principal } from '@/lib/server/db'
import { aiOpsThisMonth } from '@/lib/server/domains/ai/usage-counter'
import { authenticateInternal } from '@/lib/server/domains/api-keys/internal-auth'
import { SCOPE_INTERNAL_TIER_LIMITS } from '@/lib/server/domains/api-keys/scopes'

/**
 * GET /api/v1/internal/usage
 *
 * Reports current usage counters. Used by the cloud control plane
 * admin UI and Stripe metered billing. Self-hosters can also call
 * this with a scoped api key for monitoring.
 */
export const Route = createFileRoute('/api/v1/internal/usage')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateInternal(request, SCOPE_INTERNAL_TIER_LIMITS)
        if (auth instanceof Response) return auth

        const [aiOps, postRow, boardRow, seatRow] = await Promise.all([
          aiOpsThisMonth(),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(posts)
            .where(isNull(posts.deletedAt)),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(boards)
            .where(isNull(boards.deletedAt)),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(principal)
            .where(inArray(principal.role, ['admin', 'member'])),
        ])

        return new Response(
          JSON.stringify({
            aiOpsThisMonth: aiOps,
            postCount: postRow[0]?.count ?? 0,
            boardCount: boardRow[0]?.count ?? 0,
            teamSeatCount: seatRow[0]?.count ?? 0,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      },
    },
  },
})
