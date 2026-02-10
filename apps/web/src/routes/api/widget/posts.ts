import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import type { BoardId } from '@quackback/ids'
import { getWidgetSession } from '@/lib/server/functions/widget-auth'
import { createPost } from '@/lib/server/domains/posts/post.service'
import { getPublicBoardById } from '@/lib/server/domains/boards/board.public'
import { getDefaultStatus } from '@/lib/server/domains/statuses/status.service'

const createPostSchema = z.object({
  boardId: z.string().min(1),
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().max(10000).optional().default(''),
})

function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status })
}

export const Route = createFileRoute('/api/widget/posts')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await getWidgetSession()
        if (!auth) {
          return jsonError('UNAUTHORIZED', 'Authentication required', 401)
        }

        let body: z.infer<typeof createPostSchema>
        try {
          const raw = await request.json()
          body = createPostSchema.parse(raw)
        } catch {
          return jsonError('VALIDATION_ERROR', 'boardId and title are required', 400)
        }

        try {
          const boardId = body.boardId as BoardId
          const [board, defaultStatus] = await Promise.all([
            getPublicBoardById(boardId),
            getDefaultStatus(),
          ])

          if (!board || !board.isPublic) {
            return jsonError('NOT_FOUND', 'Board not found', 404)
          }

          const post = await createPost(
            {
              boardId,
              title: body.title,
              content: body.content,
              statusId: defaultStatus?.id,
            },
            {
              principalId: auth.principal.id,
              userId: auth.user.id,
              name: auth.user.name,
              email: auth.user.email,
            }
          )

          return Response.json({
            data: {
              id: post.id,
              title: post.title,
              content: post.content,
              statusId: post.statusId,
              voteCount: post.voteCount,
              createdAt: post.createdAt.toISOString(),
              board: { id: board.id, name: board.name, slug: board.slug },
            },
          })
        } catch (error) {
          console.error('[widget:posts] Error:', error)
          return jsonError('SERVER_ERROR', 'Failed to create post', 500)
        }
      },
    },
  },
})
