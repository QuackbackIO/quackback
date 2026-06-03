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
          const { principalId, role } = await withApiKeyAuth(request, { role: 'team' })

          const postId = parseTypeId<PostId>(params.postId, 'post', 'post ID')

          // Chokepoint: resolves the post + board, then runs canVotePost
          // (which composes canViewPost). Team API keys (the only callers
          // here) always pass the tier check; this primarily enforces
          // post.deletedAt / board.deletedAt — protections that voteOnPost
          // alone skipped.
          const { assertPostVotable } = await import('@/lib/server/domains/posts/post.access')
          const { segmentIdsForPrincipal } =
            await import('@/lib/server/domains/segments/segment-membership.service')
          await assertPostVotable(postId, {
            principalId,
            role,
            principalType: 'user',
            segmentIds: await segmentIdsForPrincipal(principalId),
          })

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
