import { createFileRoute } from '@tanstack/react-router'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db, posts, boards, principal } from '@/lib/server/db'
import { aiTokensThisMonth } from '@/lib/server/domains/ai/usage-counter'
import { authenticateAdminToken } from '@/lib/server/domains/api-keys/admin-token-auth'

/**
 * GET /api/v1/admin/usage
 *
 * Reports current usage counters (AI tokens, posts, boards, team
 * seats). Trusted endpoint authenticated by ADMIN_API_TOKEN — used
 * by external billing meters or any tool tracking workspace activity.
 * Env-var-unset = 404.
 */
export const Route = createFileRoute('/api/v1/admin/usage')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateAdminToken(request)
        if (auth) return auth

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
