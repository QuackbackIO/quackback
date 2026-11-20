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
import { serializeTicketWatcher } from './-serialize'
import type { TicketId, PrincipalId } from '@quackback/ids'

const addWatcherSchema = z.object({ principalId: z.string() })

export const Route = createFileRoute('/api/v1/tickets/$ticketId/watchers')({
  server: {
    handlers: {
      /** GET /api/v1/tickets/:id/watchers — everyone watching the ticket. */
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.TICKET_VIEW })
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')
          const { listWatchersOfTicket } =
            await import('@/lib/server/domains/tickets/ticket-watchers.service')
          const watchers = await listWatchersOfTicket(ticketId, serviceActorFromApiAuth(auth))
          return successResponse(watchers.map(serializeTicketWatcher))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /** POST /api/v1/tickets/:id/watchers — add a teammate who can see the
       *  ticket as a watcher. 201 when added, 200 when they already watched. */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.TICKET_ASSIGN })
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')

          const parsed = addWatcherSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const principalId = parseTypeId<PrincipalId>(
            parsed.data.principalId,
            'principal',
            'watcher principal ID'
          )

          const actor = serviceActorFromApiAuth(auth)
          const { addTicketWatcher, listWatchersOfTicket } =
            await import('@/lib/server/domains/tickets/ticket-watchers.service')
          const { added } = await addTicketWatcher(ticketId, principalId, actor)
          const watchers = (await listWatchersOfTicket(ticketId, actor)).map(serializeTicketWatcher)
          return added ? createdResponse(watchers) : successResponse(watchers)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
