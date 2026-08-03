/** DELETE /api/v1/tickets/:ticketId/shares/:shareId — revoke a share */
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
  revokeShare,
  getTicket,
  listSharesForTicket,
  toResourceScope,
  canShareCrossTeam,
} from '@/lib/server/domains/tickets'
import type { TicketId, TicketShareId, TeamId, PrincipalId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/tickets/$ticketId/shares/$shareId')({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')
          const shareId = parseTypeId<TicketShareId>(params.shareId, 'ticket_share', 'share ID')
          const ticket = await getTicket(ticketId)
          if (!ticket) return notFoundResponse('Ticket not found')
          const shares = await listSharesForTicket(ticketId)
          const scope = toResourceScope({
            primaryTeamId: ticket.primaryTeamId as TeamId | null,
            assigneePrincipalId: ticket.assigneePrincipalId as PrincipalId | null,
            assigneeTeamId: ticket.assigneeTeamId as TeamId | null,
            shares: shares.map((s) => ({ teamId: s.teamId as TeamId, revokedAt: s.revokedAt })),
          })
          if (!canShareCrossTeam(set, scope)) {
            return forbiddenResponse('ticket.share_cross_team required')
          }
          await revokeShare(shareId, auth.principalId)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
