/**
 * DELETE /api/v1/role-assignments/:assignmentId — revoke a role assignment.
 *
 * Gated by admin.manage_roles.
 */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  noContentResponse,
  forbiddenResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import type { RoleAssignmentId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/role-assignments/$assignmentId')({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.ADMIN_MANAGE_ROLES)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.ADMIN_MANAGE_ROLES)) {
            return forbiddenResponse('admin.manage_roles permission required')
          }
          const assignmentId = parseTypeId<RoleAssignmentId>(
            params.assignmentId,
            'role_asgn',
            'role assignment ID'
          )
          const { revokeRoleAssignment } = await import('@/lib/server/domains/authz/role.service')
          await revokeRoleAssignment({ assignmentId, actorPrincipalId: auth.principalId })
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
