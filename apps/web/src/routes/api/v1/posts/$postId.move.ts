import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  successResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import type { BoardId, PostId } from '@quackback/ids'

const moveSchema = z.object({
  boardId: z.string().min(1, 'Board ID is required'),
})

export const Route = createFileRoute('/api/v1/posts/$postId/move')({
  server: {
    handlers: {
      /**
       * POST /api/v1/posts/:postId/move
       * Move a post to another board (requires post.set_board)
       */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, {
            permission: PERMISSIONS.POST_SET_BOARD,
          })

          const postId = parseTypeId<PostId>(params.postId, 'post', 'post ID')

          const body = await request.json().catch(() => undefined)
          const parsed = moveSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const boardId = parseTypeId<BoardId>(parsed.data.boardId, 'board', 'board ID')

          const { changeBoard } = await import('@/lib/server/domains/posts/post.board')
          const result = await changeBoard(postId, boardId, {
            principalId: auth.principalId,
            displayName: auth.apiKey.name,
          })

          return successResponse({ id: result.id, boardId: result.boardId })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
