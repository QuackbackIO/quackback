import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { moderationAuditFromApiAuth } from './-audit'
import type { PostId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/moderation/posts/$postId/approve')({
  server: {
    handlers: {
      /** POST /api/v1/moderation/posts/:id/approve — pending → published. */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.POST_APPROVE })
          const postId = parseTypeId<PostId>(params.postId, 'post', 'post ID')

          const { approvePost } = await import('@/lib/server/domains/moderation')
          await approvePost(postId, moderationAuditFromApiAuth(auth, request.headers))

          return successResponse({ ok: true })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
