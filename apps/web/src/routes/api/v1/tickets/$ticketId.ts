/**
 * GET    /api/v1/tickets/:ticketId
 * PATCH  /api/v1/tickets/:ticketId
 * DELETE /api/v1/tickets/:ticketId   (soft delete)
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  forbiddenResponse,
  notFoundResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import {
  getTicket,
  updateTicket,
  softDeleteTicket,
  listSharesForTicket,
  toResourceScope,
  canViewTicket,
  canEditFields,
} from '@/lib/server/domains/tickets'
import { TICKET_PRIORITIES, TICKET_VISIBILITY_SCOPES } from '@/lib/server/db'
import type { TicketId, TeamId, PrincipalId } from '@quackback/ids'

const tiptapDocSchema = z
  .object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() })
  .passthrough()

const patchSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  subject: z.string().min(1).max(500).optional(),
  descriptionJson: tiptapDocSchema.nullable().optional(),
  descriptionText: z.string().max(100_000).nullable().optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  visibilityScope: z.enum(TICKET_VISIBILITY_SCOPES).optional(),
  primaryTeamId: z.string().nullable().optional(),
  organizationId: z.string().nullable().optional(),
  requesterContactId: z.string().nullable().optional(),
})

async function loadScope(ticketId: TicketId) {
  const ticket = await getTicket(ticketId)
  if (!ticket) return null
  const shares = await listSharesForTicket(ticketId)
  return {
    ticket,
    scope: toResourceScope({
      primaryTeamId: ticket.primaryTeamId as TeamId | null,
      assigneePrincipalId: ticket.assigneePrincipalId as PrincipalId | null,
      assigneeTeamId: ticket.assigneeTeamId as TeamId | null,
      shares: shares.map((s) => ({ teamId: s.teamId as TeamId, revokedAt: s.revokedAt })),
    }),
  }
}

export const Route = createFileRoute('/api/v1/tickets/$ticketId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          const id = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')
          const loaded = await loadScope(id)
          if (!loaded) return notFoundResponse('Ticket not found')
          if (!canViewTicket(set, loaded.scope)) {
            return forbiddenResponse('Cannot view this ticket')
          }
          return successResponse(loaded.ticket)
        } catch (error) {
          return handleDomainError(error)
        }
      },
      PATCH: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          const id = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')
          const body = await request.json().catch(() => null)
          const parsed = patchSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          const loaded = await loadScope(id)
          if (!loaded) return notFoundResponse('Ticket not found')
          if (!canEditFields(set, loaded.scope)) {
            return forbiddenResponse('ticket.edit_fields required')
          }
          const { expectedUpdatedAt, ...rest } = parsed.data
          const updated = await updateTicket(id, {
            ...(rest as Record<string, unknown>),
            expectedUpdatedAt: new Date(expectedUpdatedAt),
            actorPrincipalId: auth.principalId,
          } as never)
          return successResponse(updated)
        } catch (error) {
          return handleDomainError(error)
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          const id = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')
          const loaded = await loadScope(id)
          if (!loaded) return notFoundResponse('Ticket not found')
          if (!canEditFields(set, loaded.scope)) {
            return forbiddenResponse('ticket.edit_fields required')
          }
          await softDeleteTicket(id, auth.principalId)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
