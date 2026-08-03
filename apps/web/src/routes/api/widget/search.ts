import { createFileRoute } from '@tanstack/react-router'
import { listPublicPosts } from '@/lib/server/domains/posts/post.public'
import { getWidgetSession } from '@/lib/server/functions/widget-auth'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy'
import { segmentIdsForPrincipal } from '@/lib/server/domains/segments/segment-membership.service'
import { getWidgetRequestContext } from '@/lib/server/widget/context'
import { mapDomainErrorToResponse, widgetCorsHeaders } from '@/lib/server/widget/cors'

import { logger } from '@/lib/server/logger'
const log = logger.child({ component: 'widget-search' })
export const Route = createFileRoute('/api/widget/search')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const q = url.searchParams.get('q')?.trim()
        const board = url.searchParams.get('board') || undefined
        const limit = Math.min(Number(url.searchParams.get('limit')) || 5, 20)

        if (!q) {
          return Response.json({ data: { posts: [] } }, { headers: corsHeaders() })
        }

        try {
          const widgetContext = await getWidgetRequestContext(request)
          const feedbackFilters = widgetContext.contentFilters.feedback
          const allowedBoardIds = new Set(feedbackFilters?.boardIds ?? [])
          const allowedBoardSlugs = new Set(feedbackFilters?.boardSlugs ?? [])
          const allowedStatusIds = new Set(feedbackFilters?.statusIds ?? [])
          const hasBoardFilter = allowedBoardIds.size > 0 || allowedBoardSlugs.size > 0
          const hasStatusFilter = allowedStatusIds.size > 0

          if (board && hasBoardFilter && !allowedBoardSlugs.has(board)) {
            return Response.json({ data: { posts: [] } }, { headers: corsHeaders() })
          }

          // Read the widget session so identified widget users see
          // `authenticated` and segment-allowed boards in search. An
          // unidentified caller stays anonymous (sees only public).
          const session = await getWidgetSession()
          let actor: Actor = ANONYMOUS_ACTOR
          if (session) {
            const segmentIds = await segmentIdsForPrincipal(session.principal.id)
            actor = {
              principalId: session.principal.id,
              role: session.principal.role,
              principalType: session.principal.type === 'user' ? 'user' : 'anonymous',
              segmentIds,
            }
          }
          const result = await listPublicPosts({
            search: q,
            boardSlug: board,
            sort: 'top',
            limit,
            page: 1,
            actor,
          })

          const posts = result.items
            .filter((p) => p.board)
            .filter((p) => {
              if (!p.board) return false
              if (
                hasBoardFilter &&
                !allowedBoardIds.has(p.board.id) &&
                !allowedBoardSlugs.has(p.board.slug)
              ) {
                return false
              }
              if (hasStatusFilter && (!p.statusId || !allowedStatusIds.has(p.statusId))) {
                return false
              }
              return true
            })
            .map((p) => ({
              id: p.id,
              title: p.title,
              voteCount: p.voteCount,
              statusId: p.statusId,
              commentCount: p.commentCount,
              board: { id: p.board!.id, name: p.board!.name, slug: p.board!.slug },
            }))

          return Response.json({ data: { posts } }, { headers: corsHeaders() })
        } catch (error) {
          const mapped = mapDomainErrorToResponse(error)
          if (mapped) return mapped
          log.error({ err: error }, 'Search failed')
          return Response.json(
            { error: { code: 'SERVER_ERROR', message: 'Search failed' } },
            { status: 500, headers: corsHeaders() }
          )
        }
      },
    },
  },
})

function corsHeaders(): HeadersInit {
  return widgetCorsHeaders()
}
