/**
 * Widget ticket reply — POST /api/widget/tickets/:ticketId/replies
 *
 * Auth: Bearer-authenticated identified widget session.
 * Authorisation, audience pinning, and reopen-vs-closed semantics are all
 * delegated to `addPortalReply`, which:
 *   - re-checks ownership via `getTicketForPortalUser` (404 on miss)
 *   - hard-codes `audience='public'`
 *   - rejects replies on `closed` tickets with `ConflictError`
 *
 * The widget never offers an `audience` field — staff notes never traverse
 * the widget surface.
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  addPortalReply,
  getTicketForPortalUser,
} from '@/lib/server/domains/tickets/ticket.portal-query'
import { getWidgetSession } from '@/lib/server/functions/widget-auth'
import {
  mapDomainErrorToResponse,
  widgetCorsHeaders,
  widgetJsonError,
} from '@/lib/server/widget/cors'
import { widgetTicketingGate } from '@/lib/server/widget/ticketing-gate'
import { getWidgetRequestContext } from '@/lib/server/widget/context'
import { assertTicketMatchesWidgetContext } from '@/lib/server/widget/ticket-scope'
import type { TicketId, UserId } from '@quackback/ids'

const tiptapDocSchema = z
  .object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() })
  .passthrough()

const replySchema = z.object({
  bodyJson: tiptapDocSchema.nullable().optional(),
  bodyText: z.string().max(100_000).nullable().optional(),
})

export async function handleReplyToWidgetTicket({
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
    return widgetJsonError('IDENTITY_REQUIRED', 'Identify the widget user before replying', 403)
  }

  let body: z.infer<typeof replySchema>
  try {
    const raw = await request.json()
    body = replySchema.parse(raw)
  } catch {
    return widgetJsonError('VALIDATION_ERROR', 'Invalid request body', 400)
  }

  try {
    const ticket = await getTicketForPortalUser({
      userId: session.user.id as UserId,
      ticketId: params.ticketId as TicketId,
    })
    assertTicketMatchesWidgetContext(ticket, await getWidgetRequestContext(request))

    const thread = await addPortalReply({
      userId: session.user.id as UserId,
      ticketId: params.ticketId as TicketId,
      bodyJson: (body.bodyJson ?? null) as never,
      bodyText: body.bodyText ?? null,
    })
    return Response.json(
      {
        data: {
          id: thread.id,
          ticketId: thread.ticketId as TicketId,
          // Hard-coded by `addPortalReply`; we narrow the response type.
          audience: 'public' as const,
          createdAt: thread.createdAt.toISOString(),
        },
      },
      { headers: widgetCorsHeaders() }
    )
  } catch (err) {
    const mapped = mapDomainErrorToResponse(err)
    if (mapped) return mapped
    console.error('[widget:tickets] reply error', err)
    return widgetJsonError('SERVER_ERROR', 'Failed to post reply', 500)
  }
}

export const Route = createFileRoute('/api/widget/tickets/$ticketId/replies')({
  server: {
    handlers: {
      POST: handleReplyToWidgetTicket,
    },
  },
})
