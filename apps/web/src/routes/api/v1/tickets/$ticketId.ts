import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { serviceActorFromApiAuth } from '@/lib/server/domains/api/service-actor'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { serializeTicket } from './-serialize'
import type { TicketId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/tickets/$ticketId')({
  server: {
    handlers: {
      /** GET /api/v1/tickets/:id — single ticket (team API key). 404 if missing,
       *  soft-deleted, or outside what the key's creator can see. */
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.TICKET_VIEW })
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')

          const { assertTicketVisible, getTicket } =
            await import('@/lib/server/domains/tickets/ticket.service')
          await assertTicketVisible(ticketId, serviceActorFromApiAuth(auth))
          const dto = await getTicket(ticketId)
          return successResponse(serializeTicket(dto))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
