/**
 * Widget ticket reopen — POST /api/widget/tickets/:ticketId/reopen
 *
 * Symmetric counterpart to `tickets.$ticketId.resolve.ts`. Lets the requester
 * reopen one of their own previously-solved tickets directly from the widget.
 *
 * Allowed when the ticket's current status category is `solved`. Returns an
 * idempotent `{ alreadyOpen: true }` envelope when the ticket is already in
 * `open` / `pending` / `on_hold`. Rejects with 409 when the ticket is in
 * `closed` (terminal from the requester's perspective — symmetric with
 * `addPortalReply`'s `TICKET_CLOSED` rejection).
 *
 * Target status precedence (first match wins):
 *   1. The ticket's inbox `defaultStatusId` if it points to an open-category status.
 *   2. The workspace `is_default = true` ticket status if it's open-category.
 *   3. First non-deleted `category = 'open'` status by position, then name.
 *
 * Auth: Bearer-authenticated identified widget session.
 * Ownership: enforced by `getTicketForPortalUser` (404 on miss, never 403).
 */
import { createFileRoute } from '@tanstack/react-router'
import { and, asc, db, eq, inboxes, isNull, principal, ticketStatuses } from '@/lib/server/db'
import { getWidgetSession } from '@/lib/server/functions/widget-auth'
import { getTicketForPortalUser } from '@/lib/server/domains/tickets/ticket.portal-query'
import { transitionStatus } from '@/lib/server/domains/tickets/ticket.service'
import {
  mapDomainErrorToResponse,
  widgetCorsHeaders,
  widgetJsonError,
} from '@/lib/server/widget/cors'
import { widgetTicketingGate } from '@/lib/server/widget/ticketing-gate'
import { getWidgetRequestContext } from '@/lib/server/widget/context'
import { assertTicketMatchesWidgetContext } from '@/lib/server/widget/ticket-scope'
import type { InboxId, PrincipalId, TicketId, TicketStatusId, UserId } from '@quackback/ids'

const OPEN_CATEGORIES = new Set(['open', 'pending', 'on_hold'])

async function resolveOpenTargetStatus(
  inboxId: InboxId | null
): Promise<{ id: TicketStatusId; category: string } | null> {
  if (inboxId) {
    const inbox = await db.query.inboxes.findFirst({
      where: eq(inboxes.id, inboxId),
      columns: { defaultStatusId: true },
    })
    if (inbox?.defaultStatusId) {
      const status = await db.query.ticketStatuses.findFirst({
        where: and(eq(ticketStatuses.id, inbox.defaultStatusId), isNull(ticketStatuses.deletedAt)),
      })
      if (status && OPEN_CATEGORIES.has(status.category)) {
        return { id: status.id as TicketStatusId, category: status.category }
      }
    }
  }

  const workspaceDefault = await db.query.ticketStatuses.findFirst({
    where: and(eq(ticketStatuses.isDefault, true), isNull(ticketStatuses.deletedAt)),
  })
  if (workspaceDefault && OPEN_CATEGORIES.has(workspaceDefault.category)) {
    return { id: workspaceDefault.id as TicketStatusId, category: workspaceDefault.category }
  }

  const firstOpen = await db.query.ticketStatuses.findFirst({
    where: and(eq(ticketStatuses.category, 'open'), isNull(ticketStatuses.deletedAt)),
    orderBy: [asc(ticketStatuses.position), asc(ticketStatuses.name)],
  })
  if (firstOpen) {
    return { id: firstOpen.id as TicketStatusId, category: firstOpen.category }
  }
  return null
}

export async function handleReopenWidgetTicket({
  request,
  params,
}: {
  request: Request
  params: { ticketId: string }
}): Promise<Response> {
  const disabled = await widgetTicketingGate()
  if (disabled) return disabled
  const session = await getWidgetSession(request)
  if (!session) {
    return widgetJsonError('AUTH_REQUIRED', 'Valid widget session required', 401)
  }
  if (session.principal.type === 'anonymous') {
    return widgetJsonError(
      'IDENTITY_REQUIRED',
      'Identify the widget user before reopening tickets',
      403
    )
  }

  const ticketId = params.ticketId as TicketId

  try {
    const ticket = await getTicketForPortalUser({
      userId: session.user.id as UserId,
      ticketId,
    })
    assertTicketMatchesWidgetContext(ticket, await getWidgetRequestContext(request))

    const currentStatus = ticket.statusId
      ? await db.query.ticketStatuses.findFirst({
          where: eq(ticketStatuses.id, ticket.statusId),
        })
      : null

    if (currentStatus && OPEN_CATEGORIES.has(currentStatus.category)) {
      return Response.json(
        {
          data: {
            id: ticket.id as TicketId,
            statusId: ticket.statusId as TicketStatusId,
            statusCategory: currentStatus.category,
            alreadyOpen: true,
            updatedAt: ticket.updatedAt.toISOString(),
          },
        },
        { headers: widgetCorsHeaders() }
      )
    }

    if (currentStatus?.category === 'closed') {
      return widgetJsonError('TICKET_REOPEN_NOT_ALLOWED', 'cannot reopen a closed ticket', 409)
    }

    const target = await resolveOpenTargetStatus(ticket.inboxId as InboxId | null)
    if (!target) {
      return widgetJsonError('TICKET_NO_OPEN_STATUS', 'No open-category status configured', 409)
    }

    const viewerPrincipal = await db.query.principal.findFirst({
      where: eq(principal.userId, session.user.id as UserId),
    })

    const updated = await transitionStatus(ticketId, {
      expectedUpdatedAt: ticket.updatedAt,
      actorPrincipalId: (viewerPrincipal?.id as PrincipalId | undefined) ?? null,
      statusId: target.id,
    })

    return Response.json(
      {
        data: {
          id: updated.id as TicketId,
          statusId: updated.statusId as TicketStatusId,
          statusCategory: target.category,
          alreadyOpen: false,
          updatedAt: updated.updatedAt.toISOString(),
        },
      },
      { headers: widgetCorsHeaders() }
    )
  } catch (err) {
    const mapped = mapDomainErrorToResponse(err)
    if (mapped) return mapped
    console.error('[widget:tickets] reopen error', err)
    return widgetJsonError('SERVER_ERROR', 'Failed to reopen ticket', 500)
  }
}

export const Route = createFileRoute('/api/widget/tickets/$ticketId/reopen')({
  server: {
    handlers: {
      POST: handleReopenWidgetTicket,
    },
  },
})
