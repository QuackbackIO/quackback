/**
 * GET /api/v1/moderation/comments — list comments awaiting moderation review.
 */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  forbiddenResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'

export const Route = createFileRoute('/api/v1/moderation/comments')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.MODERATION_VIEW)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.MODERATION_VIEW)) {
            return forbiddenResponse('moderation.view permission required')
          }
          const { listPendingComments } =
            await import('@/lib/server/domains/moderation/moderation.service')
          return successResponse(await listPendingComments())
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
