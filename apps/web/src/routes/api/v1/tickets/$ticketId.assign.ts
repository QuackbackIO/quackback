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
import type { AssignTicketInput } from '@/lib/server/domains/tickets/ticket.types'
import type { TicketId, PrincipalId, TeamId } from '@quackback/ids'

// Both keys are optional AND nullable: an absent key leaves that side untouched,
// an explicit null clears it (mirrors `functions/tickets.ts`, minus the 'me'
// sentinel — a service key has no personal identity to resolve).
const assignSchema = z.object({
  assigneePrincipalId: z.string().nullable().optional(),
  assigneeTeamId: z.string().nullable().optional(),
})

export const Route = createFileRoute('/api/v1/tickets/$ticketId/assign')({
  server: {
    handlers: {
      /** POST /api/v1/tickets/:id/assign — (re)assign to a teammate and/or team. */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.TICKET_ASSIGN })
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')

          const parsed = assignSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const input: AssignTicketInput = {}
          if (parsed.data.assigneePrincipalId !== undefined) {
            input.assigneePrincipalId =
              parsed.data.assigneePrincipalId === null
                ? null
                : parseTypeId<PrincipalId>(
                    parsed.data.assigneePrincipalId,
                    'principal',
                    'assignee principal ID'
                  )
          }
          if (parsed.data.assigneeTeamId !== undefined) {
            input.assigneeTeamId =
              parsed.data.assigneeTeamId === null
                ? null
                : parseTypeId<TeamId>(parsed.data.assigneeTeamId, 'team', 'assignee team ID')
          }

          const actor = serviceActorFromApiAuth(auth)
          const { assignTicket } = await import('@/lib/server/domains/tickets/ticket.service')
          const dto = await assignTicket(ticketId, input, actor)

          return successResponse(serializeTicket(dto))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
