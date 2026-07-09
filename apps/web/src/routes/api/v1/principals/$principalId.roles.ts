/**
 * GET  /api/v1/principals/:principalId/roles — list a principal's role assignments
 * POST /api/v1/principals/:principalId/roles — assign a role { roleId, teamId? }
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
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { assignRoleSchema } from '@/lib/shared/schemas/roles'
import type { PrincipalId, RoleId, TeamId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/principals/$principalId/roles')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.ADMIN_MANAGE_ROLES)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.ADMIN_MANAGE_ROLES)) {
            return forbiddenResponse('admin.manage_roles permission required')
          }
          const principalId = parseTypeId<PrincipalId>(
            params.principalId,
            'principal',
            'principal ID'
          )
          const { listAssignmentsForPrincipal } =
            await import('@/lib/server/domains/authz/role.service')
          return successResponse(await listAssignmentsForPrincipal(principalId))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.ADMIN_MANAGE_ROLES)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.ADMIN_MANAGE_ROLES)) {
            return forbiddenResponse('admin.manage_roles permission required')
          }
          const principalId = parseTypeId<PrincipalId>(
            params.principalId,
            'principal',
            'principal ID'
          )
          const parsed = assignRoleSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const roleId = parseTypeId<RoleId>(parsed.data.roleId, 'role', 'role ID')
          const { assignRole } = await import('@/lib/server/domains/authz/role.service')
          const assignmentId = await assignRole({
            principalId,
            roleId,
            teamId: (parsed.data.teamId as TeamId | null | undefined) ?? null,
            actorPrincipalId: auth.principalId,
          })
          return createdResponse({ id: assignmentId, principalId, roleId })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
