/**
 * GET  /api/v1/tickets/:ticketId/participants
 * POST /api/v1/tickets/:ticketId/participants
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
  addParticipant,
  listParticipants,
  getTicket,
  listSharesForTicket,
  toResourceScope,
  canViewTicket,
  canManageParticipants,
} from '@/lib/server/domains/tickets'
import { TICKET_PARTICIPANT_ROLES } from '@/lib/server/db'
import type { TicketId, TeamId, PrincipalId, ContactId } from '@quackback/ids'

const postSchema = z.object({
  role: z.enum(TICKET_PARTICIPANT_ROLES),
  principalId: z.string().nullable().optional(),
  contactId: z.string().nullable().optional(),
})

export const Route = createFileRoute('/api/v1/tickets/$ticketId/participants')({
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
          return successResponse(await listParticipants(id))
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
          if (!canManageParticipants(set, scope)) {
            return forbiddenResponse('ticket.manage_participants required')
          }
          const participant = await addParticipant({
            ticketId: id,
            role: parsed.data.role,
            principalId: (parsed.data.principalId ?? null) as PrincipalId | null,
            contactId: (parsed.data.contactId ?? null) as ContactId | null,
            addedByPrincipalId: auth.principalId,
          })
          return createdResponse(participant)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
