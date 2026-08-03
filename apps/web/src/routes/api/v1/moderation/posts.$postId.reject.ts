/**
 * POST /api/v1/moderation/posts/:postId/reject — reject a pending post (optional reason).
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  forbiddenResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import type { PostId } from '@quackback/ids'

const bodySchema = z.object({ reason: z.string().max(1000).optional() })

export const Route = createFileRoute('/api/v1/moderation/posts/$postId/reject')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.MODERATION_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.MODERATION_MANAGE)) {
            return forbiddenResponse('moderation.manage permission required')
          }
          const postId = parseTypeId<PostId>(params.postId, 'post', 'post ID')
          const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { rejectPost } = await import('@/lib/server/domains/moderation/moderation.service')
          await rejectPost(
            postId,
            parsed.data.reason,
            { role: auth.role, type: 'api_key' },
            request.headers
          )
          return successResponse({ ok: true, postId })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
