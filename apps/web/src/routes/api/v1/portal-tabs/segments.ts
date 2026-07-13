/**
 * GET /api/v1/portal-tabs/segments — list all segments that have portal tab overrides
 *
 * Returns the per-segment overrides (with segment name) for admin/management
 * display. Config-plane resource: scope-gated with portal.manage.
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

export const Route = createFileRoute('/api/v1/portal-tabs/segments')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.PORTAL_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.PORTAL_MANAGE)) {
            return forbiddenResponse('portal.manage permission required')
          }
          const { getAllSegmentTabOverrides } =
            await import('@/lib/server/domains/portal/index.server')
          const rows = await getAllSegmentTabOverrides()
          return successResponse(rows)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
