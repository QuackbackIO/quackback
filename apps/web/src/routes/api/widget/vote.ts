import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import type { PostId } from '@quackback/ids'
import { getWidgetSession } from '@/lib/server/functions/widget-auth'
import { voteOnPost } from '@/lib/server/domains/posts/post.voting'

const voteSchema = z.object({
  postId: z.string().min(1),
})

function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status })
}

export const Route = createFileRoute('/api/widget/vote')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await getWidgetSession()
        if (!auth) {
          return jsonError('UNAUTHORIZED', 'Authentication required', 401)
        }

        let body: z.infer<typeof voteSchema>
        try {
          const raw = await request.json()
          body = voteSchema.parse(raw)
        } catch {
          return jsonError('VALIDATION_ERROR', 'postId is required', 400)
        }

        try {
          const result = await voteOnPost(body.postId as PostId, auth.principal.id)
          return Response.json({ data: result })
        } catch (error) {
          console.error('[widget:vote] Error:', error)
          return jsonError('SERVER_ERROR', 'Failed to vote', 500)
        }
      },
    },
  },
})
