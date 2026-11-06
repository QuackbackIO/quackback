import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { serviceActorFromApiAuth } from '@/lib/server/domains/api/service-actor'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { serializeTicketParticipant } from './-serialize'
import type { TicketId } from '@quackback/ids'

const addParticipantSchema = z.object({ email: z.string().email().max(320) })

export const Route = createFileRoute('/api/v1/tickets/$ticketId/participants')({
  server: {
    handlers: {
      /** GET /api/v1/tickets/:id/participants — the customers the ticket is shared with. */
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.TICKET_VIEW })
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')
          const { listTicketParticipants } =
            await import('@/lib/server/domains/tickets/ticket-sharing.service')
          const participants = await listTicketParticipants(ticketId, serviceActorFromApiAuth(auth))
          return successResponse(participants.map(serializeTicketParticipant))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /** POST /api/v1/tickets/:id/participants — share a customer ticket with
       *  someone by email. 201 when shared, 200 when they already had it. */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.TICKET_REPLY })
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')
          const parsed = addParticipantSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const actor = serviceActorFromApiAuth(auth)
          const { addTicketParticipantByEmail, listTicketParticipants } =
            await import('@/lib/server/domains/tickets/ticket-sharing.service')
          const { added } = await addTicketParticipantByEmail(ticketId, parsed.data.email, actor)
          const participants = (await listTicketParticipants(ticketId, actor)).map(
            serializeTicketParticipant
          )
          return added ? createdResponse(participants) : successResponse(participants)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
