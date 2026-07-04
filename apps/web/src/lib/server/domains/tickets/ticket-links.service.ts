/**
 * Tracker links (support platform §4.9): a `tracker` ticket groups the many
 * `customer` tickets it tracks (relation 'tracks'). Linking is a team action; a
 * customer ticket is tracked by at most one tracker (partial-unique in the
 * schema). This module owns the link CRUD + reads. The cascade that copies a
 * tracker's status onto its linked tickets rides setTicketStatus in
 * ticket.service and consumes listLinkedTicketIds here.
 */
import { db, eq, and, conversationMessages, ticketLinks } from '@/lib/server/db'
import type { TicketId } from '@quackback/ids'
import { can } from '@/lib/server/policy/authorize'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { PermissionKey } from '@/lib/shared/permissions'
import { ValidationError, ForbiddenError } from '@/lib/shared/errors'
import { formatTicketNumber } from '@/lib/shared/tickets'
import { logger } from '@/lib/server/logger'
import { loadTicketOr404 } from './ticket.service'

const log = logger.child({ component: 'ticket-links' })

function assertCan(actor: Actor, permission: PermissionKey, action: string): void {
  if (!can(actor, permission)) throw new ForbiddenError('FORBIDDEN', `You cannot ${action}`)
}

/**
 * Link a customer ticket to a tracker (team-only, TICKET_ASSIGN). The tracker
 * must be type 'tracker' and the linked ticket type 'customer'. Re-linking to
 * the same tracker is a no-op; linking to a different tracker while one already
 * tracks it is rejected (the partial-unique). Records a team-only 'ticket_linked'
 * note on the linked ticket's thread.
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
    loadTicketOr404(trackerTicketId),
    loadTicketOr404(linkedTicketId),
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
    await tx.insert(conversationMessages).values({
      ticketId: linkedTicketId,
      principalId: null,
      senderType: 'system',
      isInternal: true,
      content: `Linked to tracker ${formatTicketNumber(tracker.number)}`,
      metadata: {
        systemEvent: {
          kind: 'ticket_linked',
          trackerReference: formatTicketNumber(tracker.number),
        },
      },
    })
  })
  log.info(
    { tracker_ticket_id: trackerTicketId, linked_ticket_id: linkedTicketId },
    'ticket linked'
  )
}

/** Remove a tracker link (team-only, TICKET_ASSIGN). No-op if the link is absent. */
export async function unlinkTicketFromTracker(
  trackerTicketId: TicketId,
  linkedTicketId: TicketId,
  actor: Actor
): Promise<void> {
  assertCan(actor, PERMISSIONS.TICKET_ASSIGN, 'unlink this ticket')
  await db
    .delete(ticketLinks)
    .where(
      and(
        eq(ticketLinks.trackerTicketId, trackerTicketId),
        eq(ticketLinks.linkedTicketId, linkedTicketId)
      )
    )
}

/** The ids of the customer tickets a tracker tracks (the caller builds DTOs). */
export async function listLinkedTicketIds(trackerTicketId: TicketId): Promise<TicketId[]> {
  const rows = await db
    .select({ id: ticketLinks.linkedTicketId })
    .from(ticketLinks)
    .where(
      and(eq(ticketLinks.trackerTicketId, trackerTicketId), eq(ticketLinks.relation, 'tracks'))
    )
  return rows.map((r) => r.id)
}
