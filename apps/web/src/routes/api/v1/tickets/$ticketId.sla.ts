/**
 * GET /api/v1/tickets/:ticketId/sla — SLA clocks for a ticket
 */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  forbiddenResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { getActiveClocksForTicket, getAllClocksForTicket } from '@/lib/server/domains/sla'
import type { TicketId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/tickets/$ticketId/sla')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.SLA_VIEW)
          if (!hasPermission(set, PERMISSIONS.SLA_VIEW)) {
            return forbiddenResponse('sla.view permission required')
          }
          const id = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')
          const url = new URL(request.url)
          const includeAll = url.searchParams.get('includeAll') === 'true'
          const clocks = includeAll
            ? await getAllClocksForTicket(id)
            : await getActiveClocksForTicket(id)
          return successResponse({ clocks })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
