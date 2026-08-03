/**
 * Widget ticket resolve - POST /api/widget/tickets/:ticketId/resolve
 *
 * Lets the requester themselves mark a ticket as solved from the widget. The
 * agent UI keeps its richer status workflow; this is a single-button shortcut
 * for end-users on the host page.
 *
 * Auth: Bearer-authenticated identified widget session.
 * Ownership: enforced by `getTicketForPortalUser` (404 on miss, never 403).
 *
 * If the ticket is already in the `solved` or `closed` category we return
 * `{ ok: true, alreadyResolved: true }` instead of attempting an update - a
 * pointless `transitionStatus` call would write activity rows for a no-op.
 */
import { createFileRoute } from '@tanstack/react-router'
import { and, asc, db, eq, isNull, principal, ticketStatuses } from '@/lib/server/db'
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
import type { PrincipalId, TicketId, TicketStatusId, UserId } from '@quackback/ids'

export async function handleResolveWidgetTicket({
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
      'Identify the widget user before resolving tickets',
      403
    )
  }

  const ticketId = params.ticketId as TicketId

  try {
    // Enforce ownership and capture the current updatedAt for the optimistic
    // concurrency guard inside `transitionStatus`.
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

    if (currentStatus?.category === 'solved' || currentStatus?.category === 'closed') {
      return Response.json(
        {
          data: {
            id: ticket.id as TicketId,
            statusId: ticket.statusId as TicketStatusId,
            statusCategory: currentStatus.category,
            alreadyResolved: true,
            updatedAt: ticket.updatedAt.toISOString(),
          },
        },
        { headers: widgetCorsHeaders() }
      )
    }

    // Pick the first non-deleted status in the `solved` category by position.
    const solvedStatus = await db.query.ticketStatuses.findFirst({
      where: and(eq(ticketStatuses.category, 'solved'), isNull(ticketStatuses.deletedAt)),
      orderBy: [asc(ticketStatuses.position), asc(ticketStatuses.name)],
    })
    if (!solvedStatus) {
      return widgetJsonError('TICKET_NO_SOLVED_STATUS', 'No solved-category status configured', 409)
    }

    // Look up the requester's principal to attribute the activity row.
    const viewerPrincipal = await db.query.principal.findFirst({
      where: eq(principal.userId, session.user.id as UserId),
    })

    const updated = await transitionStatus(ticketId, {
      expectedUpdatedAt: ticket.updatedAt,
      actorPrincipalId: (viewerPrincipal?.id as PrincipalId | undefined) ?? null,
      statusId: solvedStatus.id as TicketStatusId,
    })

    return Response.json(
      {
        data: {
          id: updated.id as TicketId,
          statusId: updated.statusId as TicketStatusId,
          statusCategory: 'solved' as const,
          alreadyResolved: false,
          updatedAt: updated.updatedAt.toISOString(),
        },
      },
      { headers: widgetCorsHeaders() }
    )
  } catch (err) {
    const mapped = mapDomainErrorToResponse(err)
    if (mapped) return mapped
    console.error('[widget:tickets] resolve error', err)
    return widgetJsonError('SERVER_ERROR', 'Failed to resolve ticket', 500)
  }
}

export const Route = createFileRoute('/api/widget/tickets/$ticketId/resolve')({
  server: {
    handlers: {
      POST: handleResolveWidgetTicket,
    },
  },
})
