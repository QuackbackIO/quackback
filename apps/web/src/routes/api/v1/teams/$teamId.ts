/**
 * GET    /api/v1/teams/:teamId — fetch one team
 * PATCH  /api/v1/teams/:teamId — update a team
 * DELETE /api/v1/teams/:teamId — archive a team (use POST /unarchive to restore)
 */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  forbiddenResponse,
  badRequestResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { updateTeamSchema } from '@/lib/shared/schemas/teams'
import type { TeamId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/teams/$teamId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.TEAM_VIEW)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.TEAM_VIEW)) {
            return forbiddenResponse('team.view permission required')
          }
          const teamId = parseTypeId<TeamId>(params.teamId, 'team', 'team ID')
          const { getTeam } = await import('@/lib/server/domains/teams/team.service')
          const team = await getTeam(teamId)
          if (!team) return notFoundResponse('Team')
          return successResponse(team)
        } catch (error) {
          return handleDomainError(error)
        }
      },

      PATCH: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.TEAM_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.TEAM_MANAGE)) {
            return forbiddenResponse('team.manage permission required')
          }
          const teamId = parseTypeId<TeamId>(params.teamId, 'team', 'team ID')
          const parsed = updateTeamSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { updateTeam } = await import('@/lib/server/domains/teams/team.service')
          const team = await updateTeam(teamId, parsed.data, { principalId: auth.principalId })
          return successResponse(team)
        } catch (error) {
          return handleDomainError(error)
        }
      },

      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.TEAM_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.TEAM_MANAGE)) {
            return forbiddenResponse('team.manage permission required')
          }
          const teamId = parseTypeId<TeamId>(params.teamId, 'team', 'team ID')
          const { archiveTeam } = await import('@/lib/server/domains/teams/team.service')
          await archiveTeam(teamId, { principalId: auth.principalId })
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
