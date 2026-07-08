/**
 * POST /api/v1/teams/:teamId/unarchive — restore an archived team.
 */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  forbiddenResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import type { TeamId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/teams/$teamId/unarchive')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.TEAM_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.TEAM_MANAGE)) {
            return forbiddenResponse('team.manage permission required')
          }
          const teamId = parseTypeId<TeamId>(params.teamId, 'team', 'team ID')
          const { unarchiveTeam, getTeam } = await import('@/lib/server/domains/teams/team.service')
          await unarchiveTeam(teamId, { principalId: auth.principalId })
          const team = await getTeam(teamId)
          if (!team) return notFoundResponse('Team')
          return successResponse(team)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
