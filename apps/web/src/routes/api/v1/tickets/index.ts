import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { serializeTicket } from './-serialize'
import type { TicketType, TicketStatusCategory, TicketStage } from '@/lib/server/db'
import type { TicketSort } from '@/lib/server/domains/tickets/ticket.types'
import type { PrincipalId, CompanyId, SegmentId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/tickets/')({
  server: {
    handlers: {
      /** GET /api/v1/tickets — list tickets (team API key). Filters mirror the
       *  admin list; results are team-wide (a service actor sees every ticket). */
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.TICKET_VIEW })

          const url = new URL(request.url)
          const limit = Math.min(
            100,
            Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20)
          )
          const type = (url.searchParams.get('type') as TicketType | null) ?? undefined
          const statusCategory =
            (url.searchParams.get('statusCategory') as TicketStatusCategory | null) ?? undefined
          const stage = (url.searchParams.get('stage') as TicketStage | null) ?? undefined
          const requesterPrincipalId =
            (url.searchParams.get('requesterPrincipalId') as PrincipalId | null) ?? undefined
          const companyId = (url.searchParams.get('companyId') as CompanyId | null) ?? undefined
          const sort = (url.searchParams.get('sort') as TicketSort | null) ?? undefined

          const actor = {
            principalId: auth.principalId,
            role: auth.role,
            principalType: 'service' as const,
            segmentIds: new Set<SegmentId>(),
          }

          const { listTickets } = await import('@/lib/server/domains/tickets/ticket.service')
          const tickets = await listTickets(
            { type, statusCategory, stage, requesterPrincipalId, companyId, sort, limit },
            actor
          )

          return successResponse(tickets.map(serializeTicket))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
