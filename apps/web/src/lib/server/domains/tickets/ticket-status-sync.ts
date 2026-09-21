import {
  eq,
  and,
  isNull,
  tickets,
  ticketStatuses,
  ticketActivity,
  ticketConversations,
  conversationMessages,
  ticketLinks,
  type Transaction,
  type Ticket,
} from '@/lib/server/db'
import type { TicketId, TicketStatusId, PrincipalId } from '@quackback/ids'
import { emit } from '@/lib/server/events/emit'
import {
  ticketStatusChanged,
  ticketExternalStatusChanged,
} from '@/lib/server/events/catalogue/ticket'
import { resolveStage, statusTransition } from './ticket.lifecycle'
import { emitTicketSystemMessage } from './ticket-message.service'
import { getIntegration } from '@/lib/server/integrations'
import { getStageLabels } from '../settings/settings.tickets'

interface ExternalChange {
  integrationType: string
  externalDisplayId: string | null
  externalUrl: string | null
  externalStatus: string
  transition: 'closed' | 'reopened' | null
  deliveryKey: string
}

/** Uses the same lifecycle rules as agent status changes, with all durable effects in the receipt transaction. */
export async function applySyncedTicketStatus(
  tx: Transaction,
  ticketId: TicketId,
  statusId: TicketStatusId | null,
  principalId: PrincipalId,
  external?: ExternalChange,
  updatedTickets: Ticket[] = [],
  visited = new Set<string>()
) {
  if (visited.has(ticketId)) return
  visited.add(ticketId)
  const [ticket] = await tx
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), isNull(tickets.deletedAt)))
    .for('update')
  if (!ticket) throw new Error('Ticket unavailable')
  const ref = {
    id: ticket.id,
    number: ticket.number,
    type: ticket.type,
    ticketTypeId: ticket.ticketTypeId,
    priority: ticket.priority,
    assignedPrincipalId: ticket.assigneePrincipalId,
    assignedTeamId: ticket.assigneeTeamId,
  }
  const actor = { type: 'service' as const, id: principalId }
  if (external) {
    await emitTicketSystemMessage(
      ticketId,
      'external_status_changed',
      `${getIntegration(external.integrationType)?.catalog.name ?? 'External'} issue ${external.externalDisplayId ?? ''} ${external.transition ? `was ${external.transition}` : `moved to "${external.externalStatus}"`}`,
      { exec: tx, dedupeKey: external.deliveryKey, metadata: { ...external } }
    )
    await emit(tx, ticketExternalStatusChanged, {
      entityId: ticketId,
      actor,
      payload: { ticket: ref, title: ticket.title, ...external },
      context: { source: 'integration-sync' },
    })
  }
  if (!statusId || ticket.statusId === statusId) return
  const [target, previous] = await Promise.all([
    tx.query.ticketStatuses.findFirst({
      where: and(eq(ticketStatuses.id, statusId), isNull(ticketStatuses.deletedAt)),
    }),
    tx.query.ticketStatuses.findFirst({ where: eq(ticketStatuses.id, ticket.statusId) }),
  ])
  if (!target) throw new Error('Status mapping unavailable')
  // Tracker propagation never reopens a customer ticket already closed independently.
  if (!external && previous?.category === 'closed') return
  const previousCategory = previous?.category ?? 'open'
  const now = new Date()
  const transition = statusTransition(previousCategory, target.category, now)
  const stage = resolveStage(target)
  const previousStage = previous ? resolveStage(previous) : null
  const [updated] = await tx
    .update(tickets)
    .set({
      statusId,
      updatedAt: now,
      ...(transition.resolvedAt !== undefined ? { resolvedAt: transition.resolvedAt } : {}),
      ...(transition.reopenedIncrement ? { reopenedCount: ticket.reopenedCount + 1 } : {}),
    })
    .where(eq(tickets.id, ticketId))
    .returning()
  // The worker publishes these only after the entire receipt transaction commits.
  updatedTickets.push(updated)
  await tx.insert(ticketActivity).values({
    ticketId,
    principalId,
    type: 'status.changed',
    metadata: {
      fromId: ticket.statusId,
      fromName: previous?.name ?? null,
      toId: statusId,
      toName: target.name,
    },
  })
  await emit(tx, ticketStatusChanged, {
    entityId: ticketId,
    actor,
    payload: {
      ticket: ref,
      title: ticket.title,
      previousStatus: previousCategory,
      newStatus: target.category,
      stage,
      previousStage,
      requesterPrincipalId: ticket.requesterPrincipalId,
    },
    context: { source: 'integration-sync' },
  })
  if (
    (stage && stage !== previousStage) ||
    (!stage &&
      ticket.type === 'customer' &&
      previousCategory !== 'closed' &&
      target.category === 'closed')
  ) {
    const label = stage ? (await getStageLabels())[stage] : null
    const [pair] = await tx
      .select()
      .from(ticketConversations)
      .where(
        and(
          eq(ticketConversations.ticketId, ticketId),
          eq(ticketConversations.ticketType, 'customer')
        )
      )
      .limit(1)
    await tx.insert(conversationMessages).values({
      ...(pair ? { conversationId: pair.conversationId } : { ticketId }),
      principalId: null,
      senderType: 'system',
      content: label ? `Status updated to ${label}` : 'Ticket closed',
      metadata: {
        systemEvent: label
          ? { kind: 'ticket_status_changed', stageLabel: label }
          : { kind: 'ticket_status_changed', closed: true },
      },
    })
  }
  if (ticket.type === 'tracker' && previousCategory !== target.category) {
    const links = await tx
      .select()
      .from(ticketLinks)
      .where(and(eq(ticketLinks.trackerTicketId, ticketId), eq(ticketLinks.relation, 'tracks')))
    for (const link of links)
      await applySyncedTicketStatus(
        tx,
        link.linkedTicketId,
        statusId,
        principalId,
        undefined,
        updatedTickets,
        visited
      )
  }
}
