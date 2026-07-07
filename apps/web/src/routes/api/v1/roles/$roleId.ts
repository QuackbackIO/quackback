/**
 * GET    /api/v1/roles/:roleId — fetch a role with its permissions
 * PATCH  /api/v1/roles/:roleId — rename / re-describe a role
 * DELETE /api/v1/roles/:roleId — delete a custom role (system roles rejected)
 */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  forbiddenResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { updateRoleSchema } from '@/lib/shared/schemas/roles'
import type { RoleId } from '@quackback/ids'

async function gate(request: Request) {
  const auth = await withApiKeyAuth(request, { role: 'team' })
  assertScopeAllowed(auth, PERMISSIONS.ADMIN_MANAGE_ROLES)
  const set = await loadPermissionSet(auth.principalId)
  if (!hasPermission(set, PERMISSIONS.ADMIN_MANAGE_ROLES)) return { auth, ok: false as const }
  return { auth, ok: true as const }
}

export const Route = createFileRoute('/api/v1/roles/$roleId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const g = await gate(request)
          if (!g.ok) return forbiddenResponse('admin.manage_roles permission required')
          const roleId = parseTypeId<RoleId>(params.roleId, 'role', 'role ID')
          const { getRoleWithPermissions } = await import('@/lib/server/domains/authz/role.service')
          return successResponse(await getRoleWithPermissions(roleId))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      PATCH: async ({ request, params }) => {
        try {
          const g = await gate(request)
          if (!g.ok) return forbiddenResponse('admin.manage_roles permission required')
          const roleId = parseTypeId<RoleId>(params.roleId, 'role', 'role ID')
          const parsed = updateRoleSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { updateRole, getRoleWithPermissions } =
            await import('@/lib/server/domains/authz/role.service')
          await updateRole({
            id: roleId,
            name: parsed.data.name,
            description: parsed.data.description,
            actorPrincipalId: g.auth.principalId,
          })
          return successResponse(await getRoleWithPermissions(roleId))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      DELETE: async ({ request, params }) => {
        try {
          const g = await gate(request)
          if (!g.ok) return forbiddenResponse('admin.manage_roles permission required')
          const roleId = parseTypeId<RoleId>(params.roleId, 'role', 'role ID')
          const { deleteRole } = await import('@/lib/server/domains/authz/role.service')
          await deleteRole({ id: roleId, actorPrincipalId: g.auth.principalId })
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
