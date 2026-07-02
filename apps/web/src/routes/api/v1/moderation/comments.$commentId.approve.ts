/**
 * POST /api/v1/moderation/comments/:commentId/approve — approve a pending comment.
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
import type { CommentId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/moderation/comments/$commentId/approve')({
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
          const commentId = parseTypeId<CommentId>(params.commentId, 'comment', 'comment ID')
          const { approveComment } =
            await import('@/lib/server/domains/moderation/moderation.service')
          await approveComment(commentId, { role: auth.role, type: 'api_key' }, request.headers)
          return successResponse({ ok: true, commentId })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
