import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { serializeTicketMessage } from './-serialize'
import type { TicketId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/tickets/$ticketId/messages')({
  server: {
    handlers: {
      /** GET /api/v1/tickets/:id/messages — the ticket thread, oldest-first.
       *  For a conversation-linked customer ticket this is the pair's SHARED
       *  thread: the union of the linked conversation's messages and the
       *  ticket's own legacy ticket-parented rows (convergence,
       *  scratchpad/convergence-design.md) — new customer-visible replies
       *  land on the conversation, so a conversation-only read would miss
       *  them. Internal notes are excluded unless includeInternal=true.
       *  Keyset scrollback via ?before=<message id>; the page size is fixed. */
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.TICKET_VIEW })
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')

          const url = new URL(request.url)
          const before = url.searchParams.get('before') ?? undefined
          const includeInternal = url.searchParams.get('includeInternal') === 'true'

          const { loadTicketOr404 } = await import('@/lib/server/domains/tickets/ticket.service')
          const { listTicketMessages } =
            await import('@/lib/server/domains/tickets/ticket-message.service')

          // 404 if the ticket doesn't exist (or is soft-deleted) before listing.
          await loadTicketOr404(ticketId)
          const result = await listTicketMessages(ticketId, { before, includeInternal })

          // The page is oldest-first; the cursor for the next (older) page is the
          // oldest message loaded. No more pages -> null cursor.
          const nextCursor = result.hasMore && result.messages.length ? result.messages[0].id : null
          return successResponse(result.messages.map(serializeTicketMessage), {
            pagination: { cursor: nextCursor, hasMore: result.hasMore },
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
