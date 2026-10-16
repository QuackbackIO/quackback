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
import { ticketDueAtWireSchema } from '@/lib/shared/schemas/tickets'
import { serializeTicket } from './-serialize'
import type { TicketId } from '@quackback/ids'

// The key is required: an explicit null clears the due date, so a body that
// forgot the field can't wipe it by accident.
const dueSchema = z.object({
  dueAt: ticketDueAtWireSchema.nullable(),
})

export const Route = createFileRoute('/api/v1/tickets/$ticketId/due')({
  server: {
    handlers: {
      /** POST /api/v1/tickets/:id/due — set or clear the shared due date (gated ticket.set_status). */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.TICKET_SET_STATUS })
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')

          const parsed = dueSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const actor = serviceActorFromApiAuth(auth)
          const { setTicketDueAt } = await import('@/lib/server/domains/tickets/ticket-due.service')
          const dueAt = parsed.data.dueAt === null ? null : new Date(parsed.data.dueAt)
          const dto = await setTicketDueAt(ticketId, dueAt, actor)

          return successResponse(serializeTicket(dto))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
