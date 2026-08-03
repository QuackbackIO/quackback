/**
 * GET  /api/v1/tickets/:ticketId/threads
 * POST /api/v1/tickets/:ticketId/threads
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
  addThread,
  listThreads,
  getTicket,
  listSharesForTicket,
  toResourceScope,
  canViewTicket,
  canReplyPublic,
  canCommentInternal,
  canShareCrossTeam,
} from '@/lib/server/domains/tickets'
import { TICKET_THREAD_AUDIENCES } from '@/lib/server/db'
import type { TicketId, TeamId, PrincipalId } from '@quackback/ids'

const postSchema = z.object({
  audience: z.enum(TICKET_THREAD_AUDIENCES),
  bodyJson: z.unknown().nullable().optional(),
  bodyText: z.string().max(100_000).nullable().optional(),
  sharedWithTeamId: z.string().nullable().optional(),
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

export const Route = createFileRoute('/api/v1/tickets/$ticketId/threads')({
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
          const threads = await listThreads(id, {
            viewerTeamIds: set.teamIds,
            canSeeInternal: canCommentInternal(set, loaded.scope),
            isRequester: loaded.ticket.requesterPrincipalId === auth.principalId,
          })
          return successResponse(threads)
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
          const loaded = await loadScope(id)
          if (!loaded) return notFoundResponse('Ticket not found')
          if (parsed.data.audience === 'public' && !canReplyPublic(set, loaded.scope)) {
            return forbiddenResponse('ticket.reply_public required')
          }
          if (parsed.data.audience === 'internal' && !canCommentInternal(set, loaded.scope)) {
            return forbiddenResponse('ticket.comment_internal required')
          }
          if (parsed.data.audience === 'shared_team' && !canShareCrossTeam(set, loaded.scope)) {
            return forbiddenResponse('ticket.share_cross_team required')
          }
          const thread = await addThread({
            ticketId: id,
            principalId: auth.principalId,
            audience: parsed.data.audience,
            bodyJson: (parsed.data.bodyJson ?? null) as never,
            bodyText: parsed.data.bodyText ?? null,
            sharedWithTeamId: (parsed.data.sharedWithTeamId ?? null) as TeamId | null,
          })
          return createdResponse(thread)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
