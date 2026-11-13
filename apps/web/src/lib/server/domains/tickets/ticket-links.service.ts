/**
 * Tracker links (support platform §4.9): a `tracker` ticket groups the many
 * `customer` tickets it tracks (relation 'tracks'). Linking is a team action; a
 * customer ticket is tracked by at most one tracker (partial-unique in the
 * schema). This module owns the link CRUD + reads. The cascade that copies a
 * tracker's status onto its linked tickets rides setTicketStatus in
 * ticket.service and consumes listLinkedTicketIds here.
 */
import { db, eq, and, isNull, inArray, ticketLinks, tickets } from '@/lib/server/db'
import type { TicketId } from '@quackback/ids'
import { can } from '@/lib/server/policy/authorize'
import { ticketFilter } from '@/lib/server/policy/tickets'
import { boundedServiceActor } from '@/lib/server/policy/service-actor'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { PermissionKey } from '@/lib/shared/permissions'
import { ValidationError, ForbiddenError } from '@/lib/shared/errors'
import { formatTicketNumber } from '@/lib/shared/tickets'
import { logger } from '@/lib/server/logger'
import { assertTicketVisible } from './ticket.service'
import { emitTicketSystemMessage } from './ticket-message.service'
import { buildTicketContext, ticketToDTO } from './ticket.dto'
import type { TicketDTO } from './ticket.types'

const log = logger.child({ component: 'ticket-links' })

/** A workspace-wide reader for counting every link, hidden ones included. */
const SYSTEM_LINK_READER: Actor = boundedServiceActor(new Set())

function assertCan(actor: Actor, permission: PermissionKey, action: string): void {
  if (!can(actor, permission)) throw new ForbiddenError('FORBIDDEN', `You cannot ${action}`)
}

/**
 * Link a customer ticket to a tracker (team-only, TICKET_ASSIGN). The tracker
 * must be type 'tracker' and the linked ticket type 'customer'. Re-linking to
 * the same tracker is a no-op; linking to a different tracker while one already
 * tracks it is rejected (the partial-unique). Records a team-only 'ticket_linked'
 * note on the linked ticket's thread. Either ticket hidden from the actor is
 * NotFound.
 */
export async function linkTicketToTracker(
  trackerTicketId: TicketId,
  linkedTicketId: TicketId,
  actor: Actor
): Promise<void> {
  assertCan(actor, PERMISSIONS.TICKET_ASSIGN, 'link this ticket')
  if (trackerTicketId === linkedTicketId) {
    throw new ValidationError('INVALID_LINK', 'A ticket cannot track itself')
  }

  const [tracker, linked] = await Promise.all([
    assertTicketVisible(trackerTicketId, actor),
    assertTicketVisible(linkedTicketId, actor),
  ])
  if (tracker.type !== 'tracker') {
    throw new ValidationError('INVALID_LINK', 'The tracking ticket must be a tracker')
  }
  if (linked.type !== 'customer') {
    throw new ValidationError('INVALID_LINK', 'Only customer tickets can be tracked')
  }

  const [existing] = await db
    .select({ trackerTicketId: ticketLinks.trackerTicketId })
    .from(ticketLinks)
    .where(and(eq(ticketLinks.linkedTicketId, linkedTicketId), eq(ticketLinks.relation, 'tracks')))
    .limit(1)
  if (existing) {
    if (existing.trackerTicketId === trackerTicketId) return // idempotent re-link
    throw new ValidationError(
      'ALREADY_TRACKED',
      'This ticket is already tracked by another tracker'
    )
  }

  await db.transaction(async (tx) => {
    await tx.insert(ticketLinks).values({
      trackerTicketId,
      linkedTicketId,
      relation: 'tracks',
      linkedByPrincipalId: actor.principalId ?? null,
    })
    // Team-only audit note on the linked ticket's thread (never customer-visible).
    await emitTicketSystemMessage(
      linkedTicketId,
      'ticket_linked',
      `Linked to tracker ${formatTicketNumber(tracker.number)}`,
      { metadata: { trackerReference: formatTicketNumber(tracker.number) }, exec: tx }
    )
  })
  log.info(
    { tracker_ticket_id: trackerTicketId, linked_ticket_id: linkedTicketId },
    'ticket linked'
  )
}

/** Remove a tracker link (team-only, TICKET_ASSIGN). No-op if the link is
 *  absent. Either ticket hidden from the actor is NotFound. */
export async function unlinkTicketFromTracker(
  trackerTicketId: TicketId,
  linkedTicketId: TicketId,
  actor: Actor
): Promise<void> {
  assertCan(actor, PERMISSIONS.TICKET_ASSIGN, 'unlink this ticket')
  await Promise.all([
    assertTicketVisible(trackerTicketId, actor),
    assertTicketVisible(linkedTicketId, actor),
  ])
  await db
    .delete(ticketLinks)
    .where(
      and(
        eq(ticketLinks.trackerTicketId, trackerTicketId),
        eq(ticketLinks.linkedTicketId, linkedTicketId)
      )
    )
}

/**
 * The ids of the customer tickets a tracker tracks (the caller builds DTOs).
 * With an actor, only the tickets that actor can see.
 */
export async function listLinkedTicketIds(
  trackerTicketId: TicketId,
  actor?: Actor
): Promise<TicketId[]> {
  const tracked = and(
    eq(ticketLinks.trackerTicketId, trackerTicketId),
    eq(ticketLinks.relation, 'tracks')
  )
  if (!actor) {
    const rows = await db
      .select({ id: ticketLinks.linkedTicketId })
      .from(ticketLinks)
      .where(tracked)
    return rows.map((r) => r.id)
  }
  const rows = await db
    .select({ id: ticketLinks.linkedTicketId })
    .from(ticketLinks)
    .innerJoin(tickets, eq(tickets.id, ticketLinks.linkedTicketId))
    .where(and(tracked, ticketFilter(actor)))
  return rows.map((r) => r.id)
}

/**
 * The customer tickets a tracker tracks that the actor can see, as full DTOs,
 * plus how many more it tracks that the actor cannot see. Nothing about a
 * hidden ticket but that count leaves here.
 */
export async function listLinkedTickets(
  trackerTicketId: TicketId,
  actor: Actor
): Promise<{ items: TicketDTO[]; hiddenCount: number }> {
  const [allIds, visibleIds] = await Promise.all([
    listLinkedTicketIds(trackerTicketId, SYSTEM_LINK_READER),
    listLinkedTicketIds(trackerTicketId, actor),
  ])
  const rows =
    visibleIds.length === 0
      ? []
      : await db
          .select()
          .from(tickets)
          .where(and(isNull(tickets.deletedAt), inArray(tickets.id, visibleIds)))
  const ctx = await buildTicketContext(rows)
  return {
    items: rows.map((r) => ticketToDTO(r, ctx)),
    hiddenCount: allIds.length - visibleIds.length,
  }
}

/**
 * The tracker a customer ticket belongs to (reverse lookup). `tracker` is null
 * when there is none or the actor cannot see it; `hidden` says which.
 */
export async function getTrackerForTicket(
  linkedTicketId: TicketId,
  actor: Actor
): Promise<{ tracker: TicketDTO | null; hidden: boolean }> {
  const [link] = await db
    .select({ trackerId: ticketLinks.trackerTicketId })
    .from(ticketLinks)
    .where(and(eq(ticketLinks.linkedTicketId, linkedTicketId), eq(ticketLinks.relation, 'tracks')))
    .limit(1)
  if (!link) return { tracker: null, hidden: false }
  const [row] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, link.trackerId), isNull(tickets.deletedAt)))
    .limit(1)
  if (!row) return { tracker: null, hidden: false }
  const [visible] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.id, row.id), ticketFilter(actor)))
    .limit(1)
  if (!visible) return { tracker: null, hidden: true }
  const ctx = await buildTicketContext([row])
  return { tracker: ticketToDTO(row, ctx), hidden: false }
}
