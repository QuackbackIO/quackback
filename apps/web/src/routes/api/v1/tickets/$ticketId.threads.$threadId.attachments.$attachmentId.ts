/**
 * DELETE /api/v1/tickets/:ticketId/threads/:threadId/attachments/:attachmentId
 *
 * Authorization: uploader OR an agent with `ticket.edit_fields`. The
 * underlying object in S3 is intentionally NOT deleted here — same
 * behaviour as the dashboard, which keeps blob retention separate from
 * metadata removal so we can audit/restore later if needed.
 */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  noContentResponse,
  forbiddenResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { db, ticketAttachments, ticketThreads, eq } from '@/lib/server/db'
import {
  getTicket,
  removeAttachment,
  listSharesForTicket,
  toResourceScope,
  canViewTicket,
  canEditFields,
} from '@/lib/server/domains/tickets'
import type {
  TicketId,
  TicketThreadId,
  TicketAttachmentId,
  TeamId,
  PrincipalId,
} from '@quackback/ids'

export const Route = createFileRoute(
  '/api/v1/tickets/$ticketId/threads/$threadId/attachments/$attachmentId'
)({
  server: {
    handlers: {
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
          const attachmentId = parseTypeId<TicketAttachmentId>(
            params.attachmentId,
            'ticket_att',
            'attachment ID'
          )

          const ticket = await getTicket(ticketId)
          if (!ticket) return notFoundResponse('Ticket')
          const shares = await listSharesForTicket(ticketId)
          const scope = toResourceScope({
            primaryTeamId: ticket.primaryTeamId as TeamId | null,
            assigneePrincipalId: ticket.assigneePrincipalId as PrincipalId | null,
            assigneeTeamId: ticket.assigneeTeamId as TeamId | null,
            shares: shares.map((s) => ({ teamId: s.teamId as TeamId, revokedAt: s.revokedAt })),
          })
          if (!canViewTicket(set, scope)) {
            return forbiddenResponse('Cannot view this ticket')
          }

          const attachment = await db.query.ticketAttachments.findFirst({
            where: eq(ticketAttachments.id, attachmentId),
          })
          if (!attachment || attachment.threadId !== threadId) {
            return notFoundResponse('Attachment')
          }
          // Confirm the thread actually belongs to this ticket — guards
          // against a caller swapping threadId to leak ownership info.
          const thread = await db.query.ticketThreads.findFirst({
            where: eq(ticketThreads.id, threadId),
            columns: { ticketId: true },
          })
          if (!thread || thread.ticketId !== ticketId) {
            return notFoundResponse('Thread')
          }

          const isUploader =
            attachment.uploadedByPrincipalId !== null &&
            attachment.uploadedByPrincipalId === auth.principalId
          if (!isUploader && !canEditFields(set, scope)) {
            return forbiddenResponse('must be the uploader or hold ticket.edit_fields')
          }

          await removeAttachment(attachmentId, auth.principalId)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
