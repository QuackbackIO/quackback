import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { handleDomainError, noContentResponse } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { serviceActorFromApiAuth } from '@/lib/server/domains/api/service-actor'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { TicketId, PrincipalId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/tickets/$ticketId/participants/$principalId')({
  server: {
    handlers: {
      /** DELETE /api/v1/tickets/:id/participants/:principalId — stop sharing
       *  the ticket with someone. 204 whether or not it was shared with them. */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.TICKET_REPLY })
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')
          const principalId = parseTypeId<PrincipalId>(
            params.principalId,
            'principal',
            'participant principal ID'
          )
          const { removeTicketParticipant } =
            await import('@/lib/server/domains/tickets/ticket-sharing.service')
          await removeTicketParticipant(ticketId, principalId, serviceActorFromApiAuth(auth))
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
