/** POST /api/v1/tickets/:ticketId/take */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  forbiddenResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import {
  hasPermissionForResource,
  loadPermissionSet,
} from '@/lib/server/domains/authz/authz.service'
import {
  getTicket,
  listSharesForTicket,
  takeTicket,
  toResourceScope,
} from '@/lib/server/domains/tickets'
import type { TicketId, TeamId, PrincipalId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/tickets/$ticketId/take')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          const id = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')
          const ticket = await getTicket(id)
          if (!ticket) return notFoundResponse('Ticket not found')
          const shares = await listSharesForTicket(id)
          const scope = toResourceScope({
            primaryTeamId: ticket.primaryTeamId as TeamId | null,
            assigneePrincipalId: ticket.assigneePrincipalId as PrincipalId | null,
            assigneeTeamId: ticket.assigneeTeamId as TeamId | null,
            shares: shares.map((s) => ({ teamId: s.teamId as TeamId, revokedAt: s.revokedAt })),
          })
          if (!hasPermissionForResource(set, PERMISSIONS.TICKET_ASSIGN_SELF, scope)) {
            return forbiddenResponse('ticket.assign_self required')
          }
          return successResponse(await takeTicket(id, auth.principalId as PrincipalId))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
