import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { handleDomainError, noContentResponse } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { serviceActorFromApiAuth } from '@/lib/server/domains/api/service-actor'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { TicketId, PrincipalId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/tickets/$ticketId/watchers/$principalId')({
  server: {
    handlers: {
      /** DELETE /api/v1/tickets/:id/watchers/:principalId — stop someone
       *  watching the ticket. 204 whether or not they were watching. */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.TICKET_ASSIGN })
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')
          const principalId = parseTypeId<PrincipalId>(
            params.principalId,
            'principal',
            'watcher principal ID'
          )
          const { removeTicketWatcher } =
            await import('@/lib/server/domains/tickets/ticket-watchers.service')
          await removeTicketWatcher(ticketId, principalId, serviceActorFromApiAuth(auth))
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
