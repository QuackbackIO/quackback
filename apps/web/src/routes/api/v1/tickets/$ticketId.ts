import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { serializeTicket } from './-serialize'
import type { TicketId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/tickets/$ticketId')({
  server: {
    handlers: {
      /** GET /api/v1/tickets/:id — single ticket (team API key). 404 if missing
       *  or soft-deleted. A service key is workspace-wide, so no audience narrowing. */
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.TICKET_VIEW })
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')

          const { getTicket } = await import('@/lib/server/domains/tickets/ticket.service')
          const dto = await getTicket(ticketId)
          return successResponse(serializeTicket(dto))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
