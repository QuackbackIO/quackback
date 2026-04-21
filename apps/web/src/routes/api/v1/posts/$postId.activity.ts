import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import type { PostId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/posts/$postId/activity')({
  server: {
    handlers: {
      /**
       * GET /api/v1/posts/:postId/activity
       * Get the activity log for a post
       */
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })

          const postId = parseTypeId<PostId>(params.postId, 'post', 'post ID')

          const { getActivityForPost } =
            await import('@/lib/server/domains/activity/activity.service')

          const activities = await getActivityForPost(postId)

          return successResponse(
            activities.map((a) => ({
              id: a.id,
              postId: a.postId,
              principalId: a.principalId,
              actorName: a.actorName,
              type: a.type,
              metadata: a.metadata,
              createdAt: a.createdAt.toISOString(),
            }))
          )
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
