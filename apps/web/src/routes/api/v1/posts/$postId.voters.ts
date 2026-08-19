import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import type { PostId, PostVoteId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/posts/$postId/voters')({
  server: {
    handlers: {
      /**
       * GET /api/v1/posts/:postId/voters
       * List the voters on a post with cursor pagination
       */
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.POST_VIEW_PRIVATE })

          const postId = parseTypeId<PostId>(params.postId, 'post', 'post ID')

          const url = new URL(request.url)
          const cursor = url.searchParams.get('cursor') ?? undefined
          const limit = Math.min(
            100,
            Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20)
          )

          const { isValidTypeId } = await import('@quackback/ids')
          const cursorVoteId =
            cursor && isValidTypeId(cursor, 'post_vote') ? (cursor as PostVoteId) : undefined

          const { listPostVoters } = await import('@/lib/server/domains/posts/post.voting')
          const result = await listPostVoters(postId, { limit, cursor: cursorVoteId })

          return successResponse(
            result.items.map((v) => ({
              principalId: v.principalId,
              displayName: v.displayName,
              email: v.email,
              avatarUrl: v.avatarUrl,
              isAnonymous: v.isAnonymous,
              sourceType: v.sourceType,
              sourceExternalUrl: v.sourceExternalUrl,
              addedByName: v.addedByName,
              createdAt: new Date(v.createdAt).toISOString(),
            })),
            {
              pagination: {
                cursor: result.nextCursor,
                hasMore: result.hasMore,
              },
            }
          )
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
