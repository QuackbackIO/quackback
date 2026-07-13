/**
 * GET  /api/v1/teams — list teams (?includeArchived=true)
 * POST /api/v1/teams — create a team
 *
 * Scope-gated with team.view / team.manage.
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
import { createTeamSchema } from '@/lib/shared/schemas/teams'

export const Route = createFileRoute('/api/v1/teams/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.TEAM_VIEW)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.TEAM_VIEW)) {
            return forbiddenResponse('team.view permission required')
          }
          const includeArchived =
            new URL(request.url).searchParams.get('includeArchived') === 'true'
          const { listTeams } = await import('@/lib/server/domains/teams/team.service')
          return successResponse(await listTeams({ includeArchived }))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      POST: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.TEAM_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.TEAM_MANAGE)) {
            return forbiddenResponse('team.manage permission required')
          }
          const parsed = createTeamSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { createTeam } = await import('@/lib/server/domains/teams/team.service')
          const team = await createTeam(parsed.data, { principalId: auth.principalId })
          return createdResponse(team)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
