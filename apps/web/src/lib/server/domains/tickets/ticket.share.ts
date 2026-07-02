/**
 * Cross-team share grants for tickets.
 *
 * Sharing is additive: a grant lets the target team's members view (and,
 * depending on `accessLevel`, comment on or fully edit) a ticket they would
 * otherwise not see. Grants are soft-revoked (`revokedAt`) so the audit trail
 * remains intact.
 *
 * The unique partial index on (ticket_id, team_id) WHERE revoked_at IS NULL
 * prevents duplicate active grants — re-sharing simply returns the existing
 * row. Re-sharing after a revoke creates a brand-new grant.
 */
import {
  db,
  eq,
  and,
  isNull,
  desc,
  ticketShares,
  tickets,
  TICKET_SHARE_LEVELS,
  type TicketShare,
  type TicketShareLevel,
} from '@/lib/server/db'
import type { TicketId, TicketShareId, PrincipalId, TeamId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { recordEvent } from '../audit'
import { writeActivity, bumpLastActivity } from './ticket.service'

export interface ShareTicketInput {
  ticketId: TicketId
  teamId: TeamId
  accessLevel?: TicketShareLevel
  grantedByPrincipalId: PrincipalId | null
}

export async function shareTicketWithTeam(input: ShareTicketInput): Promise<TicketShare> {
  if (input.accessLevel && !TICKET_SHARE_LEVELS.includes(input.accessLevel)) {
    throw new ValidationError('TICKET_SHARE_LEVEL_INVALID', 'invalid accessLevel')
  }
  const ticket = await db.query.tickets.findFirst({
    where: and(eq(tickets.id, input.ticketId), isNull(tickets.deletedAt)),
  })
  if (!ticket) throw new NotFoundError('TICKET_NOT_FOUND', `ticket ${input.ticketId} not found`)

  // Sharing with the primary or assignee team is a no-op rather than an error.
  const existing = await db.query.ticketShares.findFirst({
    where: and(
      eq(ticketShares.ticketId, input.ticketId),
      eq(ticketShares.teamId, input.teamId),
      isNull(ticketShares.revokedAt)
    ),
  })
  if (existing) return existing

  const [created] = await db
    .insert(ticketShares)
    .values({
      ticketId: input.ticketId,
      teamId: input.teamId,
      accessLevel: input.accessLevel ?? 'read',
      grantedByPrincipalId: input.grantedByPrincipalId,
    })
    .returning()

  await bumpLastActivity(input.ticketId)
  await writeActivity(input.ticketId, input.grantedByPrincipalId, 'ticket.shared', {
    shareId: created.id,
    teamId: input.teamId,
    accessLevel: created.accessLevel,
  })
  void recordEvent({
    principalId: input.grantedByPrincipalId,
    action: 'ticket.shared',
    targetType: 'ticket',
    targetId: input.ticketId,
    diff: { context: { teamId: input.teamId, accessLevel: created.accessLevel } },
  })

  // Phase 7: dispatch ticket.shared notification (lazy team expansion).
  try {
    const { notifyTicketShared } = await import('./ticket.notifications')
    await notifyTicketShared(ticket, input.teamId, {
      actorPrincipalId: input.grantedByPrincipalId,
    })
  } catch (err) {
    console.warn('[tickets] notifyTicketShared failed', err)
  }

  // Phase 7.5: outbound webhook event.
  try {
    const { dispatchTicketShared, buildEventActor } = await import('@/lib/server/events/dispatch')
    const actor = input.grantedByPrincipalId
      ? buildEventActor({
          principalId: input.grantedByPrincipalId,
          displayName: 'ticket-system',
        })
      : { type: 'service' as const, displayName: 'ticket-system' }
    await dispatchTicketShared(
      actor,
      ticket as unknown as Record<string, unknown>,
      input.teamId as string,
      (created.accessLevel as string | null) ?? null
    )
  } catch (err) {
    console.warn('[tickets] dispatchTicketShared failed', err)
  }

  return created
}

export async function revokeShare(
  shareId: TicketShareId,
  actorPrincipalId: PrincipalId | null
): Promise<TicketShare> {
  const existing = await db.query.ticketShares.findFirst({
    where: eq(ticketShares.id, shareId),
  })
  if (!existing) throw new NotFoundError('TICKET_SHARE_NOT_FOUND', `share ${shareId} not found`)
  if (existing.revokedAt) {
    // Idempotent revoke
    return existing
  }
  const now = new Date()
  const [updated] = await db
    .update(ticketShares)
    .set({ revokedAt: now, revokedByPrincipalId: actorPrincipalId })
    .where(eq(ticketShares.id, shareId))
    .returning()
  await bumpLastActivity(existing.ticketId as TicketId)
  await writeActivity(existing.ticketId as TicketId, actorPrincipalId, 'ticket.unshared', {
    shareId,
    teamId: existing.teamId,
  })
  void recordEvent({
    principalId: actorPrincipalId,
    action: 'ticket.unshared',
    targetType: 'ticket',
    targetId: existing.ticketId,
    diff: { context: { shareId, teamId: existing.teamId } },
  })

  // Phase 7: dispatch ticket.unshared notification.
  try {
    const ticket = await db.query.tickets.findFirst({
      where: eq(tickets.id, existing.ticketId as TicketId),
    })
    if (ticket) {
      const { notifyTicketUnshared } = await import('./ticket.notifications')
      await notifyTicketUnshared(ticket, existing.teamId as TeamId, { actorPrincipalId })
      // Phase 7.5: outbound webhook event.
      try {
        const { dispatchTicketUnshared, buildEventActor } =
          await import('@/lib/server/events/dispatch')
        const actor = actorPrincipalId
          ? buildEventActor({ principalId: actorPrincipalId, displayName: 'ticket-system' })
          : { type: 'service' as const, displayName: 'ticket-system' }
        await dispatchTicketUnshared(
          actor,
          ticket as unknown as Record<string, unknown>,
          existing.teamId as string
        )
      } catch (err) {
        console.warn('[tickets] dispatchTicketUnshared failed', err)
      }
    }
  } catch (err) {
    console.warn('[tickets] notifyTicketUnshared failed', err)
  }

  return updated
}

export async function listSharesForTicket(ticketId: TicketId): Promise<TicketShare[]> {
  return db
    .select()
    .from(ticketShares)
    .where(and(eq(ticketShares.ticketId, ticketId), isNull(ticketShares.revokedAt)))
    .orderBy(desc(ticketShares.createdAt))
}

export async function listTicketsSharedWithTeam(teamId: TeamId): Promise<TicketShare[]> {
  return db
    .select()
    .from(ticketShares)
    .where(and(eq(ticketShares.teamId, teamId), isNull(ticketShares.revokedAt)))
    .orderBy(desc(ticketShares.createdAt))
}
