import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { serviceActorFromApiAuth } from '@/lib/server/domains/api/service-actor'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { serializeTicket } from './-serialize'
import type { TicketId, TicketStatusId } from '@quackback/ids'

const statusSchema = z.object({
  statusId: z.string().min(1),
})

export const Route = createFileRoute('/api/v1/tickets/$ticketId/status')({
  server: {
    handlers: {
      /** POST /api/v1/tickets/:id/status — move a ticket to a workspace status id. */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.TICKET_SET_STATUS })
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')

          const parsed = statusSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const statusId = parseTypeId<TicketStatusId>(
            parsed.data.statusId,
            'ticket_status',
            'status ID'
          )

          const actor = serviceActorFromApiAuth(auth)
          const { setTicketStatus } = await import('@/lib/server/domains/tickets/ticket.service')
          const dto = await setTicketStatus(ticketId, statusId, actor)

          return successResponse(serializeTicket(dto))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
