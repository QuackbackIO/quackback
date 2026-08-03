/** POST /api/v1/tickets/:ticketId/assign */
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
  assignTicket,
  getTicket,
  listSharesForTicket,
  toResourceScope,
  canAssign,
  canAssignSelf,
} from '@/lib/server/domains/tickets'
import type { TicketId, TeamId, PrincipalId } from '@quackback/ids'

const schema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  assigneePrincipalId: z.string().nullable().optional(),
  assigneeTeamId: z.string().nullable().optional(),
})

export const Route = createFileRoute('/api/v1/tickets/$ticketId/assign')({
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
          const isSelf = parsed.data.assigneePrincipalId === auth.principalId
          const ok = isSelf ? canAssignSelf(set, scope) : canAssign(set, scope)
          if (!ok) return forbiddenResponse('ticket.assign_any required')
          const updated = await assignTicket(id, {
            expectedUpdatedAt: new Date(parsed.data.expectedUpdatedAt),
            actorPrincipalId: auth.principalId,
            assigneePrincipalId: (parsed.data.assigneePrincipalId ?? null) as PrincipalId | null,
            assigneeTeamId: (parsed.data.assigneeTeamId ?? null) as TeamId | null,
          })
          return successResponse(updated)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
