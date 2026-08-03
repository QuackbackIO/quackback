/**
 * POST /api/v1/tickets/:ticketId/restore
 *
 * Restores a soft-deleted ticket. Pairs with `DELETE /api/v1/tickets/:ticketId`.
 * Admin-only (deletion is admin-only too).
 */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { restoreTicket } from '@/lib/server/domains/tickets'
import type { TicketId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/tickets/$ticketId/restore')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'admin' })
          const id = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')
          const restored = await restoreTicket(id, auth.principalId)
          return successResponse(restored)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
