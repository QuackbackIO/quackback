import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { validateTypeId } from '@/lib/server/domains/api/validation'
import type { PostId } from '@quackback/ids'

const mergeSchema = z.object({
  canonicalPostId: z.string().min(1, 'Canonical post ID is required'),
})

export const Route = createFileRoute('/api/v1/posts/$postId/merge')({
  server: {
    handlers: {
      /**
       * POST /api/v1/posts/:postId/merge
       * Merge this post (duplicate) into a canonical post (admin only)
       */
      POST: async ({ request, params }) => {
        const authResult = await withApiKeyAuth(request, { role: 'admin' })
        if (authResult instanceof Response) return authResult
        const { principalId } = authResult

        try {
          const { postId } = params

          const postError = validateTypeId(postId, 'post', 'post ID')
          if (postError) return postError

          const body = await request.json()
          const parsed = mergeSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const canonicalError = validateTypeId(
            parsed.data.canonicalPostId,
            'post',
            'canonical post ID'
          )
          if (canonicalError) return canonicalError

          const { mergePost } = await import('@/lib/server/domains/posts/post.merge')
          const result = await mergePost(
            postId as PostId,
            parsed.data.canonicalPostId as PostId,
            principalId
          )

          return successResponse({
            canonicalPost: {
              id: result.canonicalPost.id,
              voteCount: result.canonicalPost.voteCount,
            },
            duplicatePost: {
              id: result.duplicatePost.id,
            },
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
