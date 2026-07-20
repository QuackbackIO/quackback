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

const noteSchema = z.object({
  content: messageContentSchema,
  attachments: attachmentsSchema,
})

export const Route = createFileRoute('/api/v1/tickets/$ticketId/note')({
  server: {
    handlers: {
      /** POST /api/v1/tickets/:id/note — agent-only internal note (never
       *  customer-visible). Notes stay ticket-scoped by design even on a
       *  conversation-linked pair (Intercom's ticket-notes semantics) — only
       *  customer-visible writes redirect to the shared thread. */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.TICKET_NOTE })
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')

          const parsed = noteSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const actor = serviceActorFromApiAuth(auth)
          const { addTicketNote } =
            await import('@/lib/server/domains/tickets/ticket-message.service')
          const { message } = await addTicketNote(actor, {
            ticketId,
            content: parsed.data.content,
            // Derive a sanitized rich doc from the markdown so the note renders
            // richly in the admin inbox (D3) — matches the MCP note tool.
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
