import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { moderationAuditFromApiAuth } from './-audit'
import type { PostCommentId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/moderation/comments/$commentId/approve')({
  server: {
    handlers: {
      /** POST /api/v1/moderation/comments/:id/approve — pending → published. */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.POST_APPROVE })
          const commentId = parseTypeId<PostCommentId>(
            params.commentId,
            'post_comment',
            'comment ID'
          )

          const { approveComment } = await import('@/lib/server/domains/moderation')
          await approveComment(commentId, moderationAuditFromApiAuth(auth, request.headers))

          return successResponse({ ok: true })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
