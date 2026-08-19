import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { serviceActorFromApiAuth } from '@/lib/server/domains/api/service-actor'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { serializeTicketMessage } from './-serialize'
import {
  messageContentSchema,
  attachmentsSchema,
  toAttachments,
  markdownToSanitizedJson,
} from './-validation'
import type { TicketId } from '@quackback/ids'

const replySchema = z.object({
  content: messageContentSchema,
  attachments: attachmentsSchema,
})

export const Route = createFileRoute('/api/v1/tickets/$ticketId/reply')({
  server: {
    handlers: {
      /** POST /api/v1/tickets/:id/reply — customer-visible agent reply. For a
       *  conversation-linked customer ticket the reply writes to the pair's
       *  SHARED thread — it lands on the linked conversation (convergence
       *  Phase 1a redirect), appears in both the ticket thread and the
       *  conversation, and the conversation pipeline owns SLA/notification
       *  side effects. Internal notes stay ticket-scoped (see ./:id/note). */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.TICKET_REPLY })
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')

          const parsed = replySchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const actor = serviceActorFromApiAuth(auth)
          const { sendTicketMessage } =
            await import('@/lib/server/domains/tickets/ticket-message.service')
          const { message } = await sendTicketMessage(actor, {
            ticketId,
            content: parsed.data.content,
            // Derive a sanitized rich doc from the markdown so the reply renders
            // like every other write path (D3) — matches the MCP reply tool and
            // the create/conversation routes.
            contentJson: markdownToSanitizedJson(parsed.data.content),
            attachments: toAttachments(parsed.data.attachments),
          })

          return createdResponse(serializeTicketMessage(message))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
