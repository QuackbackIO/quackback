/**
 * Widget ticket detail — GET /api/widget/tickets/:ticketId
 *                        PATCH /api/widget/tickets/:ticketId
 *
 * Auth: Bearer-authenticated identified widget session.
 * Ownership: reuses `getTicketForPortalUser` which throws `NotFoundError`
 * (never `Forbidden`) on miss to avoid existence leaks.
 *
 * Threads are filtered to `audience='public'` only via
 * `listPublicThreadsForTicket`. Internal/shared_team notes never reach the
 * widget — enforced at the data layer, not just the response shape.
 *
 * Compared to the portal `getMyTicketFn`, we deliberately omit
 * `requesterPrincipalId` from the response: the widget UI doesn't need it,
 * and one less identifier crosses an arbitrary host page's CORS boundary.
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  db,
  eq,
  inArray,
  principal,
  ticketStatuses,
  user,
  type TiptapContent,
} from '@/lib/server/db'
import { getWidgetSession } from '@/lib/server/functions/widget-auth'
import {
  getTicketForPortalUser,
  updatePortalTicketDescription,
} from '@/lib/server/domains/tickets/ticket.portal-query'
import { listPublicThreadsForTicket } from '@/lib/server/domains/tickets/ticket.threads'
import {
  mapDomainErrorToResponse,
  widgetCorsHeaders,
  widgetJsonError,
} from '@/lib/server/widget/cors'
import { widgetTicketingGate } from '@/lib/server/widget/ticketing-gate'
import { getWidgetRequestContext } from '@/lib/server/widget/context'
import { assertTicketMatchesWidgetContext } from '@/lib/server/widget/ticket-scope'
import type { PrincipalId, TicketId, TicketStatusId, UserId } from '@quackback/ids'

const tiptapDocSchema = z
  .object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() })
  .passthrough()

const patchSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  descriptionJson: tiptapDocSchema.nullable().optional(),
  descriptionText: z.string().max(100_000).nullable().optional(),
})

interface SerializedThread {
  id: string
  principalId: PrincipalId | null
  audience: 'public'
  bodyJson: TiptapContent | null
  bodyText: string
  createdAt: string
  editedAt: string | null
}

export async function handleGetWidgetTicket({
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
      'Identify the widget user before viewing tickets',
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

    const [threads, status, viewerPrincipal] = await Promise.all([
      listPublicThreadsForTicket(ticket.id as TicketId),
      ticket.statusId
        ? db.query.ticketStatuses.findFirst({ where: eq(ticketStatuses.id, ticket.statusId) })
        : Promise.resolve(undefined),
      db.query.principal.findFirst({ where: eq(principal.userId, session.user.id as UserId) }),
    ])

    const principalIds = Array.from(
      new Set(threads.map((t) => t.principalId).filter((p): p is PrincipalId => p != null))
    )
    const principalRows = principalIds.length
      ? await db
          .select({ id: principal.id, userName: user.name })
          .from(principal)
          .leftJoin(user, eq(principal.userId, user.id))
          .where(inArray(principal.id, principalIds))
      : []
    const principalNames: Record<string, string> = {}
    for (const row of principalRows) {
      principalNames[row.id] = row.userName ?? 'User'
    }

    return Response.json(
      {
        data: {
          ticket: {
            id: ticket.id as TicketId,
            subject: ticket.subject,
            descriptionJson: (ticket.descriptionJson as TiptapContent | null) ?? null,
            descriptionText: ticket.descriptionText ?? null,
            statusId: ticket.statusId as TicketStatusId,
            statusCategory: (status?.category ?? 'open') as
              | 'open'
              | 'pending'
              | 'on_hold'
              | 'solved'
              | 'closed',
            statusName: status?.name ?? 'Unknown',
            statusColor: status?.color ?? null,
            createdAt: ticket.createdAt.toISOString(),
            lastActivityAt: ticket.lastActivityAt.toISOString(),
            updatedAt: ticket.updatedAt.toISOString(),
          },
          threads: threads.map(
            (t): SerializedThread => ({
              id: t.id,
              principalId: (t.principalId as PrincipalId | null) ?? null,
              // The data-layer helper guarantees this; we narrow the response type.
              audience: 'public',
              bodyJson: (t.bodyJson as TiptapContent | null) ?? null,
              bodyText: t.bodyText,
              createdAt: t.createdAt.toISOString(),
              editedAt: t.editedAt ? t.editedAt.toISOString() : null,
            })
          ),
          principalNames,
          viewerPrincipalId: (viewerPrincipal?.id as PrincipalId | undefined) ?? null,
        },
      },
      { headers: widgetCorsHeaders() }
    )
  } catch (err) {
    const mapped = mapDomainErrorToResponse(err)
    if (mapped) return mapped
    console.error('[widget:tickets] detail error', err)
    return widgetJsonError('SERVER_ERROR', 'Failed to load ticket', 500)
  }
}

export async function handlePatchWidgetTicket({
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
      'Identify the widget user before editing tickets',
      403
    )
  }

  let body: z.infer<typeof patchSchema>
  try {
    const raw = await request.json()
    body = patchSchema.parse(raw)
  } catch {
    return widgetJsonError('VALIDATION_ERROR', 'Invalid request body', 400)
  }

  try {
    const ticket = await getTicketForPortalUser({
      userId: session.user.id as UserId,
      ticketId: params.ticketId as TicketId,
    })
    assertTicketMatchesWidgetContext(ticket, await getWidgetRequestContext(request))

    const updated = await updatePortalTicketDescription({
      userId: session.user.id as UserId,
      ticketId: params.ticketId as TicketId,
      expectedUpdatedAt: new Date(body.expectedUpdatedAt),
      descriptionJson: (body.descriptionJson ?? null) as never,
      descriptionText: body.descriptionText ?? null,
    })
    return Response.json(
      {
        data: {
          id: updated.id as TicketId,
          updatedAt: updated.updatedAt.toISOString(),
        },
      },
      { headers: widgetCorsHeaders() }
    )
  } catch (err) {
    const mapped = mapDomainErrorToResponse(err)
    if (mapped) return mapped
    console.error('[widget:tickets] patch error', err)
    return widgetJsonError('SERVER_ERROR', 'Failed to update ticket', 500)
  }
}

export const Route = createFileRoute('/api/widget/tickets/$ticketId')({
  server: {
    handlers: {
      GET: handleGetWidgetTicket,
      PATCH: handlePatchWidgetTicket,
    },
  },
})
