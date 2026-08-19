import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { PERMISSIONS } from '@/lib/shared/permissions'

export const Route = createFileRoute('/api/v1/moderation/pending')({
  server: {
    handlers: {
      /** GET /api/v1/moderation/pending — posts and comments awaiting review. */
      GET: async ({ request }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.POST_APPROVE })

          const { listPending } = await import('@/lib/server/domains/moderation')
          const { posts, comments } = await listPending()

          return successResponse({ posts, comments })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
