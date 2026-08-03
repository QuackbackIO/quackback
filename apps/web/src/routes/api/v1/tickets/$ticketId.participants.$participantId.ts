/** DELETE /api/v1/tickets/:ticketId/participants/:participantId */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  noContentResponse,
  forbiddenResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import {
  removeParticipant,
  getTicket,
  listSharesForTicket,
  toResourceScope,
  canManageParticipants,
} from '@/lib/server/domains/tickets'
import type { TicketId, TicketParticipantId, TeamId, PrincipalId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/tickets/$ticketId/participants/$participantId')({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')
          const participantId = parseTypeId<TicketParticipantId>(
            params.participantId,
            'ticket_part',
            'participant ID'
          )
          const ticket = await getTicket(ticketId)
          if (!ticket) return notFoundResponse('Ticket not found')
          const shares = await listSharesForTicket(ticketId)
          const scope = toResourceScope({
            primaryTeamId: ticket.primaryTeamId as TeamId | null,
            assigneePrincipalId: ticket.assigneePrincipalId as PrincipalId | null,
            assigneeTeamId: ticket.assigneeTeamId as TeamId | null,
            shares: shares.map((s) => ({ teamId: s.teamId as TeamId, revokedAt: s.revokedAt })),
          })
          if (!canManageParticipants(set, scope)) {
            return forbiddenResponse('ticket.manage_participants required')
          }
          await removeParticipant(participantId, auth.principalId)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
