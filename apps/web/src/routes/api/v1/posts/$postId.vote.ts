import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import type { PostId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/posts/$postId/vote')({
  server: {
    handlers: {
      /**
       * POST /api/v1/posts/:postId/vote
       * Toggle vote on a post (vote if not voted, unvote if already voted)
       */
      POST: async ({ request, params }) => {
        try {
          const { principalId } = await withApiKeyAuth(request, { role: 'team' })

          const postId = parseTypeId<PostId>(params.postId, 'post', 'post ID')

          const { voteOnPost } = await import('@/lib/server/domains/posts/post.voting')

          const result = await voteOnPost(postId, principalId)

          return successResponse({
            voted: result.voted,
            voteCount: result.voteCount,
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
