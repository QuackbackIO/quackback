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
import type { TicketId } from '@quackback/ids'

const titleSchema = z.object({
  title: z.string().trim().min(1).max(300),
})

export const Route = createFileRoute('/api/v1/tickets/$ticketId/title')({
  server: {
    handlers: {
      /** POST /api/v1/tickets/:id/title — rename a ticket (gated ticket.set_status). */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.TICKET_SET_STATUS })
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')

          const parsed = titleSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const actor = serviceActorFromApiAuth(auth)
          const { setTicketTitle } = await import('@/lib/server/domains/tickets/ticket.service')
          const dto = await setTicketTitle(ticketId, parsed.data.title, actor)

          return successResponse(serializeTicket(dto))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
