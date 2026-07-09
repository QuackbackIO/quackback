/**
 * PUT /api/v1/roles/:roleId/permissions — replace a role's permission set.
 */
import { createFileRoute } from '@tanstack/react-router'
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
import { setRolePermissionsSchema } from '@/lib/shared/schemas/roles'
import type { PermissionKey } from '@/lib/server/domains/authz/authz.permissions'
import type { RoleId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/roles/$roleId/permissions')({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.ADMIN_MANAGE_ROLES)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.ADMIN_MANAGE_ROLES)) {
            return forbiddenResponse('admin.manage_roles permission required')
          }
          const roleId = parseTypeId<RoleId>(params.roleId, 'role', 'role ID')
          const parsed = setRolePermissionsSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { setRolePermissions, getRoleWithPermissions } =
            await import('@/lib/server/domains/authz/role.service')
          await setRolePermissions({
            roleId,
            permissionKeys: parsed.data.permissionKeys as PermissionKey[],
            actorPrincipalId: auth.principalId,
          })
          return successResponse(await getRoleWithPermissions(roleId))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
