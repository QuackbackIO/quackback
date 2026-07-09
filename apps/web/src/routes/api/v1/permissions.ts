/**
 * GET /api/v1/permissions — list the RBAC permission catalogue (all permission
 * keys grouped by category). Reference data for building role payloads.
 */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  forbiddenResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { PERMISSIONS, PERMISSION_CATEGORIES } from '@/lib/server/domains/authz'
import { ALL_PERMISSIONS } from '@/lib/server/domains/authz/authz.permissions'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'

export const Route = createFileRoute('/api/v1/permissions')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.ADMIN_MANAGE_ROLES)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.ADMIN_MANAGE_ROLES)) {
            return forbiddenResponse('admin.manage_roles permission required')
          }
          return successResponse({
            permissions: ALL_PERMISSIONS,
            categories: Object.fromEntries(
              Object.entries(PERMISSION_CATEGORIES).map(([cat, keys]) => [cat, [...keys]])
            ),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
