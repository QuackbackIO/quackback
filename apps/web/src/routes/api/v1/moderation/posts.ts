/**
 * GET /api/v1/moderation/posts — list posts awaiting moderation review.
 *
 * Scope-gated with moderation.view (read): the API key must carry the scope
 * AND the calling principal must hold the permission.
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

export const Route = createFileRoute('/api/v1/moderation/posts')({
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
          const { listPendingPosts } =
            await import('@/lib/server/domains/moderation/moderation.service')
          const { posts } = await listPendingPosts()
          return successResponse(posts)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
