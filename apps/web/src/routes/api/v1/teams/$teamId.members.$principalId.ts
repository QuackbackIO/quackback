/**
 * DELETE /api/v1/teams/:teamId/members/:principalId — remove a team member.
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
import type { TeamId, PrincipalId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/teams/$teamId/members/$principalId')({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.TEAM_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.TEAM_MANAGE)) {
            return forbiddenResponse('team.manage permission required')
          }
          const teamId = parseTypeId<TeamId>(params.teamId, 'team', 'team ID')
          const principalId = parseTypeId<PrincipalId>(
            params.principalId,
            'principal',
            'principal ID'
          )
          const { removeMember } = await import('@/lib/server/domains/teams/team.service')
          await removeMember(teamId, principalId)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
