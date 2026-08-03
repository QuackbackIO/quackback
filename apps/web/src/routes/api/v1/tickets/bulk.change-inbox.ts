/** POST /api/v1/tickets/bulk/change-inbox */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  forbiddenResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import {
  hasPermission,
  hasPermissionForResource,
  loadPermissionSet,
} from '@/lib/server/domains/authz/authz.service'
import { bulkChangeInbox } from '@/lib/server/domains/tickets'
import type { TicketId, InboxId, PrincipalId } from '@quackback/ids'

const schema = z.object({
  ticketIds: z.array(z.string().min(1)).min(1).max(500),
  inboxId: z.string().min(1).nullable(),
})

export const Route = createFileRoute('/api/v1/tickets/bulk/change-inbox')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.TICKET_BULK_OPERATE)
          if (!hasPermission(set, PERMISSIONS.TICKET_BULK_OPERATE)) {
            return forbiddenResponse('ticket.bulk_operate permission required')
          }
          const body = await request.json().catch(() => null)
          const parsed = schema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          const result = await bulkChangeInbox({
            ticketIds: parsed.data.ticketIds as TicketId[],
            actorPrincipalId: auth.principalId as PrincipalId,
            inboxId: parsed.data.inboxId as InboxId | null,
            permit: (scope) => hasPermissionForResource(set, PERMISSIONS.TICKET_EDIT_FIELDS, scope),
          })
          return successResponse(result)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
