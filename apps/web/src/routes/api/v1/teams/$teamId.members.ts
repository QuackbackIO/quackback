/**
 * GET  /api/v1/teams/:teamId/members — list team members
 * POST /api/v1/teams/:teamId/members — add/update a member { principalId, role? }
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
import { addTeamMemberSchema } from '@/lib/shared/schemas/teams'
import type { TeamId, PrincipalId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/teams/$teamId/members')({
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
          const { listMembers } = await import('@/lib/server/domains/teams/team.service')
          return successResponse(await listMembers(teamId))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.TEAM_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.TEAM_MANAGE)) {
            return forbiddenResponse('team.manage permission required')
          }
          const teamId = parseTypeId<TeamId>(params.teamId, 'team', 'team ID')
          const parsed = addTeamMemberSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const principalId = parseTypeId<PrincipalId>(
            parsed.data.principalId,
            'principal',
            'principal ID'
          )
          const { addMember } = await import('@/lib/server/domains/teams/team.service')
          return createdResponse(await addMember(teamId, principalId, parsed.data.role ?? 'member'))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
