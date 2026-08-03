/**
 * GET  /api/v1/roles — list roles (with permission counts)
 * POST /api/v1/roles — create a custom role
 *
 * Gated by admin.manage_roles.
 */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  forbiddenResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { createRoleSchema } from '@/lib/shared/schemas/roles'
import type { PermissionKey } from '@/lib/server/domains/authz/authz.permissions'

export const Route = createFileRoute('/api/v1/roles/')({
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
          const { listRoles } = await import('@/lib/server/domains/authz/role.service')
          return successResponse(await listRoles())
        } catch (error) {
          return handleDomainError(error)
        }
      },

      POST: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.ADMIN_MANAGE_ROLES)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.ADMIN_MANAGE_ROLES)) {
            return forbiddenResponse('admin.manage_roles permission required')
          }
          const parsed = createRoleSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { createRole, getRoleWithPermissions } =
            await import('@/lib/server/domains/authz/role.service')
          const roleId = await createRole({
            key: parsed.data.key,
            name: parsed.data.name,
            description: parsed.data.description,
            permissionKeys: parsed.data.permissionKeys as PermissionKey[],
            actorPrincipalId: auth.principalId,
          })
          return createdResponse(await getRoleWithPermissions(roleId))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
