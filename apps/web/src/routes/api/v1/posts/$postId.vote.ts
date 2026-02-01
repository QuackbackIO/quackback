import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/api/auth'
import { successResponse, handleDomainError } from '@/lib/api/responses'
import { validateTypeId } from '@/lib/api/validation'
import type { PostId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/posts/$postId/vote')({
  server: {
    handlers: {
      /**
       * POST /api/v1/posts/:postId/vote
       * Toggle vote on a post (vote if not voted, unvote if already voted)
       */
      POST: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult
        const { memberId } = authResult

        try {
          const { postId } = params

          // Validate TypeID format
          const validationError = validateTypeId(postId, 'post', 'post ID')
          if (validationError) return validationError

          // Import service function
          const { voteOnPost } = await import('@/lib/posts/post.voting')

          const result = await voteOnPost(postId as PostId, memberId)

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
