import { createFileRoute } from '@tanstack/react-router'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db, posts, boards, principal } from '@/lib/server/db'
import { aiTokensThisMonth } from '@/lib/server/domains/ai/usage-counter'
import { authenticateInternal } from '@/lib/server/domains/api-keys/internal-auth'
import { SCOPE_INTERNAL_TIER_LIMITS } from '@/lib/server/domains/api-keys/scopes'

/**
 * GET /api/v1/internal/usage
 *
 * Reports current usage counters (AI tokens, posts, boards, team seats).
 * Trusted endpoint authenticated with a scoped API key — useful for
 * monitoring dashboards or any external tool tracking workspace activity.
 */
export const Route = createFileRoute('/api/v1/internal/usage')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateInternal(request, SCOPE_INTERNAL_TIER_LIMITS)
        if (auth instanceof Response) return auth

        const [aiTokens, postRow, boardRow, seatRow] = await Promise.all([
          aiTokensThisMonth(),
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
            // Mirror enforceSeatLimit's predicate — humans only,
            // service principals (API keys / integrations) don't count.
            .where(and(inArray(principal.role, ['admin', 'member']), eq(principal.type, 'user'))),
        ])

        return new Response(
          JSON.stringify({
            aiTokensThisMonth: aiTokens,
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
