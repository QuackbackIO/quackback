import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
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
        try {
          const { principalId } = await withApiKeyAuth(request, { role: 'admin' })

          const postId = parseTypeId<PostId>(params.postId, 'post', 'post ID')

          const body = await request.json()
          const parsed = mergeSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const canonicalPostId = parseTypeId<PostId>(
            parsed.data.canonicalPostId,
            'post',
            'canonical post ID'
          )

          const { mergePost } = await import('@/lib/server/domains/posts/post.merge')
          const result = await mergePost(postId, canonicalPostId, principalId)

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
