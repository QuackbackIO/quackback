/**
 * GET /api/v1/tickets/:ticketId/activity
 *
 * Read-only timeline feed for a single ticket. Reverse-chronological.
 *
 * Query params:
 *   before  ISO datetime — return rows strictly older than this (cursor)
 *   limit   1..200, default 50
 *
 * Response: `{ data: { activity: [...], nextCursor: string | null } }`
 * `nextCursor` is the `createdAt` of the oldest returned row when the page
 * is full, otherwise `null`.
 */
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
  getTicket,
  listSharesForTicket,
  toResourceScope,
  canViewTicket,
  listTicketActivity,
} from '@/lib/server/domains/tickets'
import type { TicketId, TeamId, PrincipalId } from '@quackback/ids'

const querySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

export const Route = createFileRoute('/api/v1/tickets/$ticketId/activity')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          const id = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')

          const url = new URL(request.url)
          const parsed = querySchema.safeParse({
            before: url.searchParams.get('before') ?? undefined,
            limit: url.searchParams.get('limit') ?? undefined,
          })
          if (!parsed.success) {
            return badRequestResponse('Invalid query params', { issues: parsed.error.issues })
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
          if (!canViewTicket(set, scope)) {
            return forbiddenResponse('Cannot view this ticket')
          }

          const limit = parsed.data.limit ?? 50
          const rows = await listTicketActivity(id, {
            before: parsed.data.before ? new Date(parsed.data.before) : undefined,
            limit,
          })
          const nextCursor =
            rows.length === limit ? rows[rows.length - 1].createdAt.toISOString() : null
          return successResponse({
            activity: rows.map((row) => ({
              id: row.id,
              ticketId: row.ticketId,
              principalId: row.principalId,
              type: row.type,
              metadata: row.metadata,
              createdAt: row.createdAt.toISOString(),
              actorName: row.actorName,
              actorAvatarUrl: row.actorAvatarUrl,
            })),
            nextCursor,
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
