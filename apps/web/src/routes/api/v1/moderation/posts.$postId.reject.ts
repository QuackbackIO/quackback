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
import type { PostId } from '@quackback/ids'

const rejectSchema = z.object({
  reason: z.string().max(500).optional(),
})

export const Route = createFileRoute('/api/v1/moderation/posts/$postId/reject')({
  server: {
    handlers: {
      /** POST /api/v1/moderation/posts/:id/reject — guarded soft-delete of a pending post. */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.POST_APPROVE })
          const postId = parseTypeId<PostId>(params.postId, 'post', 'post ID')

          const parsed = rejectSchema.safeParse(await request.json().catch(() => ({})))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const { rejectPost } = await import('@/lib/server/domains/moderation')
          await rejectPost(
            postId,
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
