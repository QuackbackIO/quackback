/** POST /api/v1/tickets/:ticketId/transition */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  forbiddenResponse,
  notFoundResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import {
  transitionStatus,
  getTicket,
  listSharesForTicket,
  toResourceScope,
  canEditFields,
} from '@/lib/server/domains/tickets'
import type { TicketId, TicketStatusId, TeamId, PrincipalId } from '@quackback/ids'

const schema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  statusId: z.string().min(1),
})

export const Route = createFileRoute('/api/v1/tickets/$ticketId/transition')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          const id = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')
          const body = await request.json().catch(() => null)
          const parsed = schema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          const ticket = await getTicket(id)
          if (!ticket) return notFoundResponse('Ticket not found')
          const shares = await listSharesForTicket(id)
          const scope = toResourceScope({
            primaryTeamId: ticket.primaryTeamId as TeamId | null,
            assigneePrincipalId: ticket.assigneePrincipalId as PrincipalId | null,
            assigneeTeamId: ticket.assigneeTeamId as TeamId | null,
            shares: shares.map((s) => ({ teamId: s.teamId as TeamId, revokedAt: s.revokedAt })),
          })
          if (!canEditFields(set, scope)) {
            return forbiddenResponse('ticket.edit_fields required')
          }
          const updated = await transitionStatus(id, {
            expectedUpdatedAt: new Date(parsed.data.expectedUpdatedAt),
            actorPrincipalId: auth.principalId,
            statusId: parsed.data.statusId as TicketStatusId,
          })
          return successResponse(updated)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
