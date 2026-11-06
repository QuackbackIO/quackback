/**
 * Route a ticket's public reply events to the issues the ticket is linked to,
 * for providers that mirror replies as comments (`issues.comments`). One
 * target per active link; queueing (`queueTicketCommentSync`) decides whether
 * that link's destination takes it (switched on, sending, replies opted in)
 * and the worker asks again before writing.
 *
 * LOOP-SAFETY: a reply the integration's own service principal wrote came
 * from that platform, so it is never sent back to it; other integrations
 * still hear it.
 */
import { db, integrations, ticketExternalLinks, eq, and } from '@/lib/server/db'
import { getIntegration } from '@/lib/server/integrations'
import { TICKET_COMMENT_EVENTS, TICKET_COMMENT_HOOK } from '@/lib/server/integrations/sync/comments'
import type { SinkResolver } from './registry'
import type { DomainEvent } from '../envelope'
import type { HookTarget } from '../hook-types'

/** One active link of the ticket, with its integration's loop-safety key. */
export interface CommentLinkRow {
  linkId: string
  integrationId: string | null
  integrationType: string
  integrationPrincipalId: string | null
}

/** Pure target construction (unit-testable). */
export function buildTicketCommentTargets(params: {
  links: CommentLinkRow[]
  actorType: string
  actorId: string | undefined
  mirrorsReplies: (integrationType: string) => boolean
}): HookTarget[] {
  const targets: HookTarget[] = []
  for (const link of params.links) {
    if (!link.integrationId || !params.mirrorsReplies(link.integrationType)) continue
    if (
      params.actorType === 'service' &&
      params.actorId &&
      link.integrationPrincipalId === params.actorId
    )
      continue
    targets.push({
      type: TICKET_COMMENT_HOOK,
      target: { linkId: link.linkId },
      config: { integrationId: link.integrationId },
      deliveryKey: `comment:${link.linkId}`,
    })
  }
  return targets
}

export const ticketCommentResolver: SinkResolver = {
  sink: TICKET_COMMENT_HOOK,
  interestedIn(type: string): boolean {
    return TICKET_COMMENT_EVENTS.includes(type)
  },
  async resolve(event: DomainEvent): Promise<HookTarget[]> {
    if (event.entityType !== 'ticket') return []
    if (typeof (event.payload as { messageId?: unknown }).messageId !== 'string') return []
    const links = await db
      .select({
        linkId: ticketExternalLinks.id,
        integrationId: ticketExternalLinks.integrationId,
        integrationType: ticketExternalLinks.integrationType,
        integrationPrincipalId: integrations.principalId,
      })
      .from(ticketExternalLinks)
      .innerJoin(integrations, eq(ticketExternalLinks.integrationId, integrations.id))
      .where(
        and(
          eq(ticketExternalLinks.ticketId, event.entityId as never),
          eq(ticketExternalLinks.status, 'active'),
          eq(integrations.status, 'active')
        )
      )
    if (links.length === 0) return []
    return buildTicketCommentTargets({
      links,
      actorType: event.actorType,
      actorId: event.actorId,
      mirrorsReplies: (type) => !!getIntegration(type)?.issues?.comments,
    })
  },
}
