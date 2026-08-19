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
import { priorityEnum } from './-validation'
import type { TicketId } from '@quackback/ids'

const prioritySchema = z.object({
  priority: priorityEnum,
})

export const Route = createFileRoute('/api/v1/tickets/$ticketId/priority')({
  server: {
    handlers: {
      /** POST /api/v1/tickets/:id/priority — set triage priority (gated ticket.set_status). */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.TICKET_SET_STATUS })
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')

          const parsed = prioritySchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const actor = serviceActorFromApiAuth(auth)
          const { setTicketPriority } = await import('@/lib/server/domains/tickets/ticket.service')
          const dto = await setTicketPriority(ticketId, parsed.data.priority, actor)

          return successResponse(serializeTicket(dto))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
