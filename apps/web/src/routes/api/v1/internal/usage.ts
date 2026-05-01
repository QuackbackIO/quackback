import { createFileRoute } from '@tanstack/react-router'
import { inArray, isNull, sql } from 'drizzle-orm'
import { db, posts, boards, principal } from '@/lib/server/db'
import { IS_CLOUD } from '@/lib/server/edition'
import { aiOpsThisMonth } from '@/lib/server/domains/ai/usage-counter'
import { verifyApiKeyWithScope } from '@/lib/server/domains/api-keys/api-key.service'

const SCOPE = 'internal:tier-limits'

/**
 * GET /api/v1/internal/usage
 *
 * Reports current usage counters for the control plane to display in
 * its admin UI and to drive Stripe metered billing if/when we add it.
 *
 * Returns 404 when EDITION != cloud.
 */
export const Route = createFileRoute('/api/v1/internal/usage')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!IS_CLOUD) {
          return new Response('Not Found', { status: 404 })
        }

        const auth = request.headers.get('authorization')
        const bearer = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null
        if (!bearer) {
          return new Response(JSON.stringify({ error: 'unauthenticated' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          })
        }

        const key = await verifyApiKeyWithScope(bearer, SCOPE)
        if (!key) {
          return new Response(JSON.stringify({ error: 'forbidden' }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          })
        }

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
