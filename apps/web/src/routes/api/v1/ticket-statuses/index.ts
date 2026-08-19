import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { TicketStatusEntity } from '@/lib/server/db'

/** Public, stable ticket-status shape for the read API. Exposes the id callers
 *  need for `POST /tickets/:id/status` plus the display + category/stage
 *  metadata to render a picker (D11 discovery endpoint). */
function serializeTicketStatus(row: TicketStatusEntity) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    color: row.color,
    category: row.category,
    stage: row.publicStage,
    position: row.position,
    isDefault: row.isDefault,
  }
}

export const Route = createFileRoute('/api/v1/ticket-statuses/')({
  server: {
    handlers: {
      /** GET /api/v1/ticket-statuses — the workspace's ticket statuses, ordered by
       *  category then position. Discovery for the opaque ids the status write
       *  endpoint requires. Requires a team-role API key. */
      GET: async ({ request }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.TICKET_VIEW })

          const { listTicketStatuses } =
            await import('@/lib/server/domains/tickets/ticket-status.service')
          const statuses = await listTicketStatuses()

          return successResponse(statuses.map(serializeTicketStatus))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
