/**
 * PATCH  /api/v1/tickets/:ticketId/threads/:threadId
 * DELETE /api/v1/tickets/:ticketId/threads/:threadId
 *
 * Authorization:
 *   - PATCH (edit): author only. The thread's original author may rewrite
 *     `bodyJson` / `bodyText`. We do not allow moderators to silently edit
 *     someone else's message.
 *   - DELETE (soft-delete): author OR an agent with `ticket.edit_fields`,
 *     so a moderator can remove a misposted thread. The action is recorded
 *     in `ticket_activity` with the calling principal as the actor.
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
  getThread,
  editThread,
  softDeleteThread,
  listSharesForTicket,
  toResourceScope,
  canViewTicket,
  canEditFields,
} from '@/lib/server/domains/tickets'
import type { TicketId, TicketThreadId, TeamId, PrincipalId } from '@quackback/ids'

const tiptapDocSchema = z
  .object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() })
  .passthrough()

const patchSchema = z
  .object({
    bodyJson: tiptapDocSchema.nullable().optional(),
    bodyText: z.string().max(100_000).nullable().optional(),
  })
  .refine(
    (v) => v.bodyJson !== undefined || v.bodyText !== undefined,
    'must include bodyJson or bodyText'
  )

async function loadTicketScope(ticketId: TicketId) {
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

export const Route = createFileRoute('/api/v1/tickets/$ticketId/threads/$threadId')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')
          const threadId = parseTypeId<TicketThreadId>(
            params.threadId,
            'ticket_thread',
            'thread ID'
          )

          const body = await request.json().catch(() => null)
          const parsed = patchSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }

          const loaded = await loadTicketScope(ticketId)
          if (!loaded) return notFoundResponse('Ticket')
          if (!canViewTicket(set, loaded.scope)) {
            return forbiddenResponse('Cannot view this ticket')
          }

          const thread = await getThread(threadId)
          if (!thread || thread.deletedAt || thread.ticketId !== ticketId) {
            return notFoundResponse('Thread')
          }

          const isAuthor = thread.principalId !== null && thread.principalId === auth.principalId
          if (!isAuthor) {
            return forbiddenResponse('only the original author may edit this thread')
          }

          const updated = await editThread({
            threadId,
            actorPrincipalId: auth.principalId,
            bodyJson: (parsed.data.bodyJson ?? null) as never,
            bodyText: parsed.data.bodyText ?? null,
          })
          return successResponse(updated)
        } catch (error) {
          return handleDomainError(error)
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')
          const threadId = parseTypeId<TicketThreadId>(
            params.threadId,
            'ticket_thread',
            'thread ID'
          )

          const loaded = await loadTicketScope(ticketId)
          if (!loaded) return notFoundResponse('Ticket')
          if (!canViewTicket(set, loaded.scope)) {
            return forbiddenResponse('Cannot view this ticket')
          }

          const thread = await getThread(threadId)
          if (!thread || thread.ticketId !== ticketId) return notFoundResponse('Thread')

          const isAuthor = thread.principalId !== null && thread.principalId === auth.principalId
          const canModerate = canEditFields(set, loaded.scope)
          if (!isAuthor && !canModerate) {
            return forbiddenResponse('must be the thread author or hold ticket.edit_fields')
          }

          await softDeleteThread(threadId, auth.principalId)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
