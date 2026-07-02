/**
 * GET  /api/v1/tickets/:ticketId/shares     — list active shares
 * POST /api/v1/tickets/:ticketId/shares     — share with a team
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  forbiddenResponse,
  notFoundResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import {
  shareTicketWithTeam,
  listSharesForTicket,
  getTicket,
  toResourceScope,
  canViewTicket,
  canShareCrossTeam,
} from '@/lib/server/domains/tickets'
import { TICKET_SHARE_LEVELS } from '@/lib/server/db'
import type { TicketId, TeamId, PrincipalId } from '@quackback/ids'

const postSchema = z.object({
  teamId: z.string().min(1),
  accessLevel: z.enum(TICKET_SHARE_LEVELS).optional(),
})

export const Route = createFileRoute('/api/v1/tickets/$ticketId/shares')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          const id = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')
          const ticket = await getTicket(id)
          if (!ticket) return notFoundResponse('Ticket not found')
          const shares = await listSharesForTicket(id)
          const scope = toResourceScope({
            primaryTeamId: ticket.primaryTeamId as TeamId | null,
            assigneePrincipalId: ticket.assigneePrincipalId as PrincipalId | null,
            assigneeTeamId: ticket.assigneeTeamId as TeamId | null,
            shares: shares.map((s) => ({ teamId: s.teamId as TeamId, revokedAt: s.revokedAt })),
          })
          if (!canViewTicket(set, scope)) {
            return forbiddenResponse('Cannot view this ticket')
          }
          return successResponse(shares)
        } catch (error) {
          return handleDomainError(error)
        }
      },
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          const id = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')
          const body = await request.json().catch(() => null)
          const parsed = postSchema.safeParse(body)
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
          if (!canShareCrossTeam(set, scope)) {
            return forbiddenResponse('ticket.share_cross_team required')
          }
          const grant = await shareTicketWithTeam({
            ticketId: id,
            teamId: parsed.data.teamId as TeamId,
            accessLevel: parsed.data.accessLevel,
            grantedByPrincipalId: auth.principalId,
          })
          return createdResponse(grant)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
