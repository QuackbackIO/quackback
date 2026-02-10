import { createFileRoute } from '@tanstack/react-router'
import { getWidgetSession } from '@/lib/server/functions/widget-auth'
import { getAllUserVotedPostIds } from '@/lib/server/domains/posts/post.public'

function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status })
}

export const Route = createFileRoute('/api/widget/voted-posts')({
  server: {
    handlers: {
      GET: async () => {
        const auth = await getWidgetSession()
        if (!auth) {
          return jsonError('UNAUTHORIZED', 'Authentication required', 401)
        }

        try {
          const votedIds = await getAllUserVotedPostIds(auth.principal.id)
          return Response.json({ data: { votedPostIds: Array.from(votedIds) } })
        } catch (error) {
          console.error('[widget:voted-posts] Error:', error)
          return jsonError('SERVER_ERROR', 'Failed to fetch voted posts', 500)
        }
      },
    },
  },
})
