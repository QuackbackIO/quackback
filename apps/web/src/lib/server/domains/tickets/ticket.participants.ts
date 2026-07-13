/**
 * Ticket participants — watchers, collaborators, and CC'd contacts.
 *
 * The DB CHECK constraint guarantees exactly one of `principalId` /
 * `contactId` is set; we mirror that invariant in the service so callers
 * get a friendly domain error instead of a Postgres exception.
 */
import {
  db,
  eq,
  and,
  ticketParticipants,
  tickets,
  TICKET_PARTICIPANT_ROLES,
  type TicketParticipant,
  type TicketParticipantRole,
} from '@/lib/server/db'
import type { TicketId, TicketParticipantId, PrincipalId, ContactId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { recordEvent } from '../audit'
import { writeActivity, bumpLastActivity } from './ticket.service'

export interface AddParticipantInput {
  ticketId: TicketId
  role: TicketParticipantRole
  principalId?: PrincipalId | null
  contactId?: ContactId | null
  addedByPrincipalId: PrincipalId | null
}

export async function addParticipant(input: AddParticipantInput): Promise<TicketParticipant> {
  if (!TICKET_PARTICIPANT_ROLES.includes(input.role)) {
    throw new ValidationError('TICKET_PARTICIPANT_ROLE_INVALID', 'invalid role')
  }
  const hasPrincipal = !!input.principalId
  const hasContact = !!input.contactId
  if (hasPrincipal === hasContact) {
    throw new ValidationError(
      'TICKET_PARTICIPANT_SUBJECT_INVALID',
      'exactly one of principalId / contactId must be set'
    )
  }

  // Idempotency: re-adding the same subject returns the existing row.
  const existing = await db.query.ticketParticipants.findFirst({
    where: and(
      eq(ticketParticipants.ticketId, input.ticketId),
      hasPrincipal
        ? eq(ticketParticipants.principalId, input.principalId!)
        : eq(ticketParticipants.contactId, input.contactId!)
    ),
  })
  if (existing) return existing

  const [created] = await db
    .insert(ticketParticipants)
    .values({
      ticketId: input.ticketId,
      role: input.role,
      principalId: input.principalId ?? null,
      contactId: input.contactId ?? null,
      addedByPrincipalId: input.addedByPrincipalId,
    })
    .returning()

  await bumpLastActivity(input.ticketId)
  await writeActivity(input.ticketId, input.addedByPrincipalId, 'participant.added', {
    participantId: created.id,
    role: input.role,
    principalId: input.principalId ?? null,
    contactId: input.contactId ?? null,
  })
  void recordEvent({
    principalId: input.addedByPrincipalId,
    action: 'ticket.participant_added',
    targetType: 'ticket',
    targetId: input.ticketId,
    diff: {
      context: {
        participantId: created.id,
        role: input.role,
        principalId: input.principalId ?? null,
        contactId: input.contactId ?? null,
      },
    },
  })

  // Phase 7: auto-subscribe added principal + dispatch participant.added notification.
  try {
    if (input.principalId) {
      const { safeSubscribe } = await import('./ticket.subscriptions')
      await safeSubscribe({
        ticketId: input.ticketId,
        principalId: input.principalId,
        source: 'auto_participant',
      })
    }
    const ticketRow = await db.query.tickets.findFirst({ where: eq(tickets.id, input.ticketId) })
    if (ticketRow) {
      const { notifyParticipantAdded } = await import('./ticket.notifications')
      await notifyParticipantAdded(
        ticketRow,
        {
          principalId: input.principalId ?? null,
          contactId: input.contactId ?? null,
        },
        {
          actorPrincipalId: input.addedByPrincipalId,
        }
      )
      // Phase 7.5: outbound webhook event.
      try {
        const { dispatchTicketParticipantAdded, buildEventActor } =
          await import('@/lib/server/events/dispatch')
        const actor = input.addedByPrincipalId
          ? buildEventActor({
              principalId: input.addedByPrincipalId,
              displayName: 'ticket-system',
            })
          : { type: 'service' as const, displayName: 'ticket-system' }
        await dispatchTicketParticipantAdded(
          actor,
          ticketRow as unknown as Record<string, unknown>,
          (input.principalId as string | null) ?? null,
          (input.role as string | null) ?? null
        )
      } catch (err) {
        console.warn('[tickets] dispatchTicketParticipantAdded failed', err)
      }
    }
  } catch (err) {
    console.warn('[tickets] notifyParticipantAdded failed', err)
  }

  return created
}

export async function removeParticipant(
  participantId: TicketParticipantId,
  actorPrincipalId: PrincipalId | null
): Promise<void> {
  const existing = await db.query.ticketParticipants.findFirst({
    where: eq(ticketParticipants.id, participantId),
  })
  if (!existing) {
    throw new NotFoundError(
      'TICKET_PARTICIPANT_NOT_FOUND',
      `participant ${participantId} not found`
    )
  }
  await db.delete(ticketParticipants).where(eq(ticketParticipants.id, participantId))
  await bumpLastActivity(existing.ticketId as TicketId)
  await writeActivity(existing.ticketId as TicketId, actorPrincipalId, 'participant.removed', {
    participantId,
  })
  void recordEvent({
    principalId: actorPrincipalId,
    action: 'ticket.participant_removed',
    targetType: 'ticket',
    targetId: existing.ticketId,
    diff: { context: { participantId } },
  })

  // Phase 7: dispatch participant.removed notification.
  try {
    const ticketRow = await db.query.tickets.findFirst({
      where: eq(tickets.id, existing.ticketId as TicketId),
    })
    if (ticketRow) {
      const { notifyParticipantRemoved } = await import('./ticket.notifications')
      await notifyParticipantRemoved(
        ticketRow,
        {
          principalId: existing.principalId as PrincipalId | null,
          contactId: existing.contactId as ContactId | null,
        },
        {
          actorPrincipalId,
        }
      )
      // Phase 7.5: outbound webhook event.
      try {
        const { dispatchTicketParticipantRemoved, buildEventActor } =
          await import('@/lib/server/events/dispatch')
        const actor = actorPrincipalId
          ? buildEventActor({ principalId: actorPrincipalId, displayName: 'ticket-system' })
          : { type: 'service' as const, displayName: 'ticket-system' }
        await dispatchTicketParticipantRemoved(
          actor,
          ticketRow as unknown as Record<string, unknown>,
          (existing.principalId as string | null) ?? null
        )
      } catch (err) {
        console.warn('[tickets] dispatchTicketParticipantRemoved failed', err)
      }
    }
  } catch (err) {
    console.warn('[tickets] notifyParticipantRemoved failed', err)
  }
}

export async function listParticipants(ticketId: TicketId): Promise<TicketParticipant[]> {
  return db.select().from(ticketParticipants).where(eq(ticketParticipants.ticketId, ticketId))
}
