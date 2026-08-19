import { createFileRoute } from '@tanstack/react-router'
import { listPublicPosts } from '@/lib/server/domains/posts/post.public'
import { resolveWidgetViewer } from '@/lib/server/widget/widget-viewer'
import {
  widgetCorsHeaders,
  widgetJsonError,
  enforceWidgetQuota,
} from '@/lib/server/widget/public-endpoint'
import { getSettings } from '@/lib/server/functions/workspace'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'widget-search' })

export const Route = createFileRoute('/api/widget/search')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const settings = await getSettings()
        if (!settings) return widgetJsonError(503, 'WORKSPACE_UNAVAILABLE', 'Workspace unavailable')
        const limited = await enforceWidgetQuota(request, {
          keyPrefix: 'widget-search',
          tenantId: settings.id,
          limit: 60,
          windowSeconds: 60,
          message: 'Too many searches, slow down',
        })
        if (limited) return limited
        const url = new URL(request.url)
        const q = url.searchParams.get('q')?.trim()
        const board = url.searchParams.get('board') || undefined
        const limit = Math.min(Number(url.searchParams.get('limit')) || 5, 20)

        if (!q) {
          return Response.json({ data: { posts: [] } }, { headers: widgetCorsHeaders() })
        }

        try {
          // Resolve the widget viewer so identified widget users see
          // `authenticated` and segment-allowed boards in search. An
          // unidentified caller stays anonymous (sees only public).
          const actor = await resolveWidgetViewer()
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
            .map((p) => ({
              id: p.id,
              title: p.title,
              voteCount: p.voteCount,
              statusId: p.statusId,
              commentCount: p.commentCount,
              board: { id: p.board!.id, name: p.board!.name, slug: p.board!.slug },
            }))

          return Response.json({ data: { posts } }, { headers: widgetCorsHeaders() })
        } catch (error) {
          log.error({ err: error }, 'widget search failed')
          return widgetJsonError(500, 'SERVER_ERROR', 'Search failed')
        }
      },
    },
  },
})
