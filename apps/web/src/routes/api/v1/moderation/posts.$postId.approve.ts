/**
 * POST /api/v1/moderation/posts/:postId/approve — approve a pending post
 * (guarded pending → published transition).
 */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  forbiddenResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import type { PostId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/moderation/posts/$postId/approve')({
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
          const { approvePost } = await import('@/lib/server/domains/moderation/moderation.service')
          await approvePost(postId, { role: auth.role, type: 'api_key' }, request.headers)
          return successResponse({ ok: true, postId })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
