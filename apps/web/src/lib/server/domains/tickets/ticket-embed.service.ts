/**
 * Viewer-scoped read backing the `ticket` link embed (the live ticket card
 * Quinn drops into a widget conversation). Loads a ticket + its status,
 * projects the status to its customer-facing stage label (never the internal
 * status name), and applies {@link scopeTicketEmbed}: the card resolves only for
 * a team member or the ticket's own requester. Anything else — including a
 * different visitor or a soft-deleted ticket — returns null, which the embed
 * resolver degrades to "unavailable" without leaking existence.
 */
import { db, eq, and, tickets, ticketStatuses, ticketConversations } from '@/lib/server/db'
import type { TicketId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { scopeTicketEmbed, type TicketEmbedRow } from '@/lib/server/functions/embeds'
import { getStageLabels } from '../settings/settings.tickets'
import { resolveStage } from './ticket.lifecycle'

/** Resolve a ticket the viewer may embed, or null when unavailable to them. */
export async function getTicketEmbedForViewer(
  id: TicketId,
  actor: Actor
): Promise<TicketEmbedRow | null> {
  // The status join omits the deletedAt guard on ticket_statuses so a ticket
  // sitting on a since-deleted status still resolves its stage + color, the
  // same tolerance setTicketStatus applies when reading the current status.
  const [row] = await db
    .select({
      id: tickets.id,
      number: tickets.number,
      title: tickets.title,
      type: tickets.type,
      requesterPrincipalId: tickets.requesterPrincipalId,
      deletedAt: tickets.deletedAt,
      priority: tickets.priority,
      createdAt: tickets.createdAt,
      statusColor: ticketStatuses.color,
      publicStage: ticketStatuses.publicStage,
      // The pair's conversation: the requester-facing card links there
      // (converged Messages — there is no standalone ticket page).
      conversationId: ticketConversations.conversationId,
    })
    .from(tickets)
    .leftJoin(ticketStatuses, eq(ticketStatuses.id, tickets.statusId))
    .leftJoin(
      ticketConversations,
      and(
        eq(ticketConversations.ticketId, tickets.id),
        eq(ticketConversations.ticketType, 'customer')
      )
    )
    .where(eq(tickets.id, id))
    .limit(1)
  if (!row) return null

  const stage = resolveStage({ publicStage: row.publicStage ?? null })
  const stageLabels = await getStageLabels()
  const embedRow: TicketEmbedRow = {
    id: row.id,
    number: row.number,
    title: row.title,
    type: row.type,
    requesterPrincipalId: row.requesterPrincipalId,
    deletedAt: row.deletedAt,
    conversationId: row.conversationId ?? null,
    statusLabel: stage ? stageLabels[stage] : null,
    statusColor: row.statusColor ?? '#6b7280',
    priority: row.priority,
    createdAt: row.createdAt,
  }
  return scopeTicketEmbed(embedRow, actor)
}
