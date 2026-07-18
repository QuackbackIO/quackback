import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { moderationAuditFromApiAuth } from './-audit'
import type { PostCommentId } from '@quackback/ids'

const rejectSchema = z.object({
  reason: z.string().max(500).optional(),
})

export const Route = createFileRoute('/api/v1/moderation/comments/$commentId/reject')({
  server: {
    handlers: {
      /** POST /api/v1/moderation/comments/:id/reject — guarded soft-delete of a pending comment. */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.POST_APPROVE })
          const commentId = parseTypeId<PostCommentId>(
            params.commentId,
            'post_comment',
            'comment ID'
          )

          const parsed = rejectSchema.safeParse(await request.json().catch(() => ({})))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const { rejectComment } = await import('@/lib/server/domains/moderation')
          await rejectComment(
            commentId,
            parsed.data.reason,
            moderationAuditFromApiAuth(auth, request.headers)
          )

          return successResponse({ ok: true })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
