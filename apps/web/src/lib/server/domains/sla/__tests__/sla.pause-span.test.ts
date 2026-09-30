/**
 * A pause whose reaction runs only after the paused state already ended (a
 * backlog longer than the snooze, or the wake's reaction ran first) still
 * excludes the paused span, up to the recorded wake, as a pause and then a
 * resume would have in order. The span is recorded on the stamp, so a retry
 * or a replay of the pause, or a resume that already ran, never excludes it
 * twice. Conversation snoozes and ticket pending spans alike.
 *
 * Real DB (rolled back) and the real reaction (`recordSlaFromEvent`). Each
 * status event is preceded by the status change it reports, and a wake by a
 * status move is recorded in the events log as the legacy dispatch records it.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type ConversationId,
  type PrincipalId,
  type TicketId,
  type TicketStatusId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversationMessages,
  conversations,
  events,
  principal,
  slaEvents,
  tickets,
  ticketStatuses,
  user,
  eq,
  sql,
} from '@/lib/server/db'
import type { EventData } from '@/lib/server/events/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
// No workspace office hours: the clocks run 24/7.
vi.mock('@/lib/server/domains/settings/settings.office-hours', () => ({
  getOfficeHoursSchedule: vi.fn(async () => ({ enabled: false, timezone: 'UTC', intervals: [] })),
}))

import { createSlaPolicy } from '../sla-policy.service'
import { applySlaToConversation, type SlaApplied } from '../sla.service'
import { applySlaToTicket, type TicketSlaApplied } from '../ticket-sla.service'
import { sweepOverdueSlaBreaches } from '../sla.sweep'
import { sweepOverdueTicketSlaBreaches } from '../ticket-sla.sweep'
import { recordSlaFromEvent } from '../sla.event-hooks'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db.select({ id: slaEvents.id }).from(slaEvents).limit(0)
  },
})
afterAll(() => fixture.close())

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
/** 2026-01-05 (a Monday) at the given UTC time. */
const at = (hhmm: string) => new Date(`2026-01-05T${hhmm}:00.000Z`)
const iso = (hhmm: string) => at(hhmm).toISOString()

/** The events-log row a status move writes (the entity's own status is set separately). */
async function statusEventRow(
  entityType: 'conversation' | 'ticket',
  entityId: string,
  previousStatus: string,
  newStatus: string,
  hhmm: string
) {
  await testDb.insert(events).values({
    eventId: createId('event'),
    type: `${entityType}.status_changed`,
    entityType,
    entityId,
    actorType: 'user',
    payload: { previousStatus, newStatus },
    occurredAt: at(hhmm),
  })
}

// --- conversations -----------------------------------------------------------

type ConversationStatus = 'open' | 'snoozed'

/**
 * A conversation under a policy that pauses on snooze, applied at 10:00: by
 * default a 4h time-to-close (due 14:00).
 */
async function seedConversation(
  targets: {
    firstResponseTargetSecs?: number
    nextResponseTargetSecs?: number
    timeToCloseTargetSecs?: number
  } = { timeToCloseTargetSecs: 4 * 3600 }
) {
  const userId = createId('user') as UserId
  const customer = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: customer, userId, role: 'member', type: 'user', createdAt: new Date() })
  const [row] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: customer, channel: 'messenger' })
    .returning()
  const conversationId = row.id as ConversationId
  const policy = await createSlaPolicy({ name: `SLA ${suffix()}`, ...targets, pauseOnSnooze: true })
  await applySlaToConversation(conversationId, policy.id, at('10:00'))
  return { conversationId, customer }
}

/** Move the conversation to `newStatus` at `hhmm`, recorded in the events log; returns the event. */
async function conversationMoves(
  conversationId: ConversationId,
  previousStatus: ConversationStatus,
  newStatus: ConversationStatus,
  hhmm: string
): Promise<EventData> {
  await testDb
    .update(conversations)
    .set({ status: newStatus })
    .where(eq(conversations.id, conversationId))
  await statusEventRow('conversation', conversationId, previousStatus, newStatus, hhmm)
  return {
    type: 'conversation.status_changed',
    id: createId('event'),
    timestamp: iso(hhmm),
    actor: { type: 'user' },
    data: {
      conversation: {
        id: conversationId,
        status: newStatus,
        channel: 'messenger',
        priority: 'medium',
        assignedTeamId: null,
      },
      previousStatus,
      newStatus,
    },
  } as unknown as EventData
}

/** The customer writes at `hhmm`, which wakes a snoozed conversation; returns the event. */
async function customerWrites(
  conversationId: ConversationId,
  customer: PrincipalId,
  hhmm: string
): Promise<EventData> {
  const [row] = await testDb
    .insert(conversationMessages)
    .values({
      conversationId,
      principalId: customer,
      senderType: 'visitor',
      content: `customer at ${hhmm}`,
      createdAt: at(hhmm),
    })
    .returning()
  await testDb
    .update(conversations)
    .set({ status: 'open' })
    .where(eq(conversations.id, conversationId))
  return {
    type: 'message.created',
    id: createId('event'),
    timestamp: iso(hhmm),
    actor: { type: 'user', principalId: customer },
    data: {
      message: {
        id: row.id,
        conversationId,
        senderType: 'visitor',
        authorPrincipalId: customer,
        authorName: 'Customer',
        authorEmail: null,
        content: row.content,
        createdAt: iso(hhmm),
      },
      conversation: {
        id: conversationId,
        status: 'open',
        channel: 'messenger',
        priority: 'medium',
        assignedTeamId: null,
      },
      isFirstMessage: false,
    },
  } as unknown as EventData
}

async function stampOf(conversationId: ConversationId): Promise<SlaApplied> {
  const [row] = await testDb
    .select({ slaApplied: conversations.slaApplied })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  return row.slaApplied as SlaApplied
}

/** The time-to-close deadline, the pause, and the breaches a 15:00 sweep records. */
async function conversationClock(conversationId: ConversationId) {
  await sweepOverdueSlaBreaches(at('15:00'))
  const [row] = await testDb
    .select({ slaApplied: conversations.slaApplied })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  const stamp = row.slaApplied as SlaApplied
  const breaches = (
    await testDb.select().from(slaEvents).where(eq(slaEvents.conversationId, conversationId))
  )
    .filter((event) => event.kind.endsWith('_breached'))
    .map((event) => event.kind)
  return { dueAt: stamp.timeToCloseDueAt, pausedAt: stamp.pausedAt ?? null, breaches }
}

// --- tickets -----------------------------------------------------------------

type TicketCategory = 'open' | 'pending'

/** A customer ticket under a 4h time-to-resolve policy that pauses on pending, applied at 10:00 (due 14:00). */
async function seedTicket() {
  const [open, pending] = await testDb
    .insert(ticketStatuses)
    .values([
      { name: `Open ${suffix()}`, slug: `open_${suffix()}`, category: 'open' },
      { name: `Pending ${suffix()}`, slug: `pending_${suffix()}`, category: 'pending' },
    ])
    .returning()
  const [row] = await testDb
    .insert(tickets)
    .values({ type: 'customer', title: `Ticket ${suffix()}`, statusId: open.id as TicketStatusId })
    .returning()
  const ticketId = row.id as TicketId
  const policy = await createSlaPolicy({
    name: `TTR ${suffix()}`,
    timeToResolveTargetSecs: 4 * 3600,
    pauseOnPending: true,
  })
  await applySlaToTicket(ticketId, policy.id, at('10:00'))
  const statusFor = { open: open.id as TicketStatusId, pending: pending.id as TicketStatusId }
  return { ticketId, statusFor }
}

/** Move the ticket to `newStatus`'s category at `hhmm`, recorded in the events log; returns the event. */
async function ticketMoves(
  ticket: Awaited<ReturnType<typeof seedTicket>>,
  previousStatus: TicketCategory,
  newStatus: TicketCategory,
  hhmm: string
): Promise<EventData> {
  await testDb
    .update(tickets)
    .set({ statusId: ticket.statusFor[newStatus] })
    .where(eq(tickets.id, ticket.ticketId))
  await statusEventRow('ticket', ticket.ticketId, previousStatus, newStatus, hhmm)
  return {
    type: 'ticket.status_changed',
    id: createId('event'),
    timestamp: iso(hhmm),
    actor: { type: 'user' },
    data: { ticket: { id: ticket.ticketId }, previousStatus, newStatus },
  } as unknown as EventData
}

/** The time-to-resolve deadline, the pause, and the breaches a 15:00 sweep records. */
async function ticketClock(ticketId: TicketId) {
  await sweepOverdueTicketSlaBreaches(at('15:00'))
  const [row] = await testDb
    .select({ slaApplied: tickets.slaApplied })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
  const stamp = row.slaApplied as TicketSlaApplied
  const breaches = (await testDb.select().from(slaEvents).where(eq(slaEvents.ticketId, ticketId)))
    .filter((event) => event.kind.endsWith('_breached'))
    .map((event) => event.kind)
  return { dueAt: stamp.timeToResolveDueAt, pausedAt: stamp.pausedAt ?? null, breaches }
}

/** Snoozed or pending 10:30 to 12:30 excludes two hours: due 16:00, nothing breached at 15:00. */
const SPAN_EXCLUDED = { dueAt: iso('16:00'), pausedAt: null, breaches: [] }

describe.skipIf(!fixture.available)('SLA pauses reacted to after the paused state ended', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  it('a snooze and its wake reacted to in order, both after the wake, exclude the snooze', async () => {
    const { conversationId } = await seedConversation()
    const snooze = await conversationMoves(conversationId, 'open', 'snoozed', '10:30')
    const wake = await conversationMoves(conversationId, 'snoozed', 'open', '12:30')

    await recordSlaFromEvent(snooze)
    await recordSlaFromEvent(wake)

    expect(await conversationClock(conversationId)).toEqual(SPAN_EXCLUDED)
  })

  it('a snooze reacted to after a customer message woke it excludes the snooze', async () => {
    const { conversationId, customer } = await seedConversation()
    const snooze = await conversationMoves(conversationId, 'open', 'snoozed', '10:30')
    const message = await customerWrites(conversationId, customer, '12:30')

    await recordSlaFromEvent(snooze)
    await recordSlaFromEvent(message)

    expect(await conversationClock(conversationId)).toEqual(SPAN_EXCLUDED)
  })

  it('a wake reacted to before its snooze still leaves the snooze excluded and nothing paused', async () => {
    const { conversationId } = await seedConversation()
    const snooze = await conversationMoves(conversationId, 'open', 'snoozed', '10:30')
    const wake = await conversationMoves(conversationId, 'snoozed', 'open', '12:30')

    await recordSlaFromEvent(wake)
    await recordSlaFromEvent(snooze)

    expect(await conversationClock(conversationId)).toEqual(SPAN_EXCLUDED)
  })

  it('a late snooze run twice excludes the snooze once', async () => {
    const { conversationId } = await seedConversation()
    const snooze = await conversationMoves(conversationId, 'open', 'snoozed', '10:30')
    await conversationMoves(conversationId, 'snoozed', 'open', '12:30')

    await recordSlaFromEvent(snooze)
    await recordSlaFromEvent(snooze)

    expect(await conversationClock(conversationId)).toEqual(SPAN_EXCLUDED)
  })

  it('a snooze replayed after its own pause and resume ran excludes nothing more', async () => {
    const { conversationId } = await seedConversation()
    const snooze = await conversationMoves(conversationId, 'open', 'snoozed', '10:30')
    await recordSlaFromEvent(snooze) // in order: pauses at 10:30
    await recordSlaFromEvent(await conversationMoves(conversationId, 'snoozed', 'open', '12:30'))

    await recordSlaFromEvent(snooze) // a retry or a replay

    expect(await conversationClock(conversationId)).toEqual(SPAN_EXCLUDED)
  })

  it('a late snooze also shifts an unanswered first-response clock', async () => {
    const { conversationId } = await seedConversation({ firstResponseTargetSecs: 3600 })
    const snooze = await conversationMoves(conversationId, 'open', 'snoozed', '10:30')
    const wake = await conversationMoves(conversationId, 'snoozed', 'open', '12:30')

    await recordSlaFromEvent(wake)
    await recordSlaFromEvent(snooze)

    expect((await stampOf(conversationId)).firstResponseDueAt).toBe(iso('13:00'))
  })

  it('a late snooze also shifts an armed next-response cycle', async () => {
    const { conversationId, customer } = await seedConversation({
      firstResponseTargetSecs: 3600,
      nextResponseTargetSecs: 2 * 3600,
    })
    await testDb
      .update(conversations)
      .set({
        slaApplied: sql`${conversations.slaApplied} || '{"firstResponseAt":"2026-01-05T10:10:00.000Z"}'::jsonb`,
      })
      .where(eq(conversations.id, conversationId))
    await recordSlaFromEvent(await customerWrites(conversationId, customer, '10:20')) // due 12:20
    const snooze = await conversationMoves(conversationId, 'open', 'snoozed', '10:30')
    const wake = await conversationMoves(conversationId, 'snoozed', 'open', '12:30')

    await recordSlaFromEvent(wake)
    await recordSlaFromEvent(snooze)

    expect((await stampOf(conversationId)).nextResponseDueAt).toBe(iso('14:20'))
  })

  it('a late snooze after a wake and a new snooze excludes only its own span', async () => {
    const { conversationId } = await seedConversation()
    const first = await conversationMoves(conversationId, 'open', 'snoozed', '10:30')
    const wake = await conversationMoves(conversationId, 'snoozed', 'open', '11:00')
    const second = await conversationMoves(conversationId, 'open', 'snoozed', '11:30')

    await recordSlaFromEvent(first)
    await recordSlaFromEvent(wake)
    await recordSlaFromEvent(second)

    // 10:30 to 11:00 excluded (due 14:30), and paused again since 11:30.
    const clock = await conversationClock(conversationId)
    expect({ dueAt: clock.dueAt, pausedAt: clock.pausedAt }).toEqual({
      dueAt: iso('14:30'),
      pausedAt: iso('11:30'),
    })
  })

  it('a ticket pending and its end reacted to in order, both after it ended, exclude the span', async () => {
    const ticket = await seedTicket()
    const pending = await ticketMoves(ticket, 'open', 'pending', '10:30')
    const leave = await ticketMoves(ticket, 'pending', 'open', '12:30')

    await recordSlaFromEvent(pending)
    await recordSlaFromEvent(leave)

    expect(await ticketClock(ticket.ticketId)).toEqual(SPAN_EXCLUDED)
  })

  it('a late ticket pending run twice excludes the span once', async () => {
    const ticket = await seedTicket()
    const pending = await ticketMoves(ticket, 'open', 'pending', '10:30')
    await ticketMoves(ticket, 'pending', 'open', '12:30')

    await recordSlaFromEvent(pending)
    await recordSlaFromEvent(pending)

    expect(await ticketClock(ticket.ticketId)).toEqual(SPAN_EXCLUDED)
  })

  it('a ticket pending replayed after its own pause and resume ran excludes nothing more', async () => {
    const ticket = await seedTicket()
    const pending = await ticketMoves(ticket, 'open', 'pending', '10:30')
    await recordSlaFromEvent(pending)
    await recordSlaFromEvent(await ticketMoves(ticket, 'pending', 'open', '12:30'))

    await recordSlaFromEvent(pending)

    expect(await ticketClock(ticket.ticketId)).toEqual(SPAN_EXCLUDED)
  })

  it('a lateral move inside a snooze is not its wake', async () => {
    const { conversationId } = await seedConversation()
    const snooze = await conversationMoves(conversationId, 'open', 'snoozed', '10:30')
    const lateral = await conversationMoves(conversationId, 'snoozed', 'snoozed', '11:00') // snooze extended
    const wake = await conversationMoves(conversationId, 'snoozed', 'open', '12:30')

    // The snooze's reaction runs after the lateral move, while still snoozed.
    await recordSlaFromEvent(lateral)
    await recordSlaFromEvent(snooze)
    await recordSlaFromEvent(wake)

    expect(await conversationClock(conversationId)).toEqual(SPAN_EXCLUDED)
  })

  it('a lateral move between pending statuses is not the end of the pending span', async () => {
    const ticket = await seedTicket()
    const pending = await ticketMoves(ticket, 'open', 'pending', '10:30')
    const lateral = await ticketMoves(ticket, 'pending', 'pending', '11:00')
    const leave = await ticketMoves(ticket, 'pending', 'open', '12:30')

    await recordSlaFromEvent(lateral)
    await recordSlaFromEvent(pending)
    await recordSlaFromEvent(leave)

    expect(await ticketClock(ticket.ticketId)).toEqual(SPAN_EXCLUDED)
  })

  it('a wake reacted to after the next snooze began closes the first snooze at its own time', async () => {
    const { conversationId } = await seedConversation()
    await recordSlaFromEvent(await conversationMoves(conversationId, 'open', 'snoozed', '10:30'))
    const firstWake = await conversationMoves(conversationId, 'snoozed', 'open', '11:00') // runs late
    await recordSlaFromEvent(await conversationMoves(conversationId, 'open', 'snoozed', '11:30'))
    await recordSlaFromEvent(firstWake)
    await recordSlaFromEvent(await conversationMoves(conversationId, 'snoozed', 'open', '12:30'))

    // Snoozed 10:30-11:00 and 11:30-12:30: 90 minutes excluded, not the
    // active half hour between them.
    expect(await conversationClock(conversationId)).toEqual({
      dueAt: iso('15:30'),
      pausedAt: null,
      breaches: [],
    })
  })

  it('a leave-pending reacted to after the next pending began closes the first span at its own time', async () => {
    const ticket = await seedTicket()
    await recordSlaFromEvent(await ticketMoves(ticket, 'open', 'pending', '10:30'))
    const firstLeave = await ticketMoves(ticket, 'pending', 'open', '11:00') // runs late
    await recordSlaFromEvent(await ticketMoves(ticket, 'open', 'pending', '11:30'))
    await recordSlaFromEvent(firstLeave)
    await recordSlaFromEvent(await ticketMoves(ticket, 'pending', 'open', '12:30'))

    expect(await ticketClock(ticket.ticketId)).toEqual({
      dueAt: iso('15:30'),
      pausedAt: null,
      breaches: [],
    })
  })
})

describe.skipIf(!fixture.available)('A pause that began before any recorded move', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  it('a ticket pending before its SLA was applied resumes at its first recorded move out', async () => {
    const ticket = await seedTicket()
    // Pending with no recorded move into it (created pending, say), so the
    // SLA applied at 10:00 starts paused.
    await testDb
      .update(tickets)
      .set({
        statusId: ticket.statusFor.pending,
        slaApplied: sql`${tickets.slaApplied} || ${JSON.stringify({ pausedAt: iso('10:00') })}::jsonb`,
      })
      .where(eq(tickets.id, ticket.ticketId))

    await recordSlaFromEvent(await ticketMoves(ticket, 'pending', 'open', '12:30'))

    // Paused 10:00 to 12:30: due 16:30.
    expect(await ticketClock(ticket.ticketId)).toEqual({
      dueAt: iso('16:30'),
      pausedAt: null,
      breaches: [],
    })
  })
})

describe.skipIf(!fixture.available)('A stamp from before the pause ledger', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  // An earlier build paused and resumed 10:30 to 11:30, shifting the deadline
  // an hour to 15:00, and paused again at 12:00, keeping no ledger (as does a
  // stamp stripped after a rollback).
  const legacy = { dueAt: iso('15:00'), pausedAt: iso('12:00') }

  it("takes a conversation's ended snoozes as excluded and holds the current one", async () => {
    const { conversationId } = await seedConversation()
    await conversationMoves(conversationId, 'open', 'snoozed', '10:30')
    await conversationMoves(conversationId, 'snoozed', 'open', '11:30')
    const snooze = await conversationMoves(conversationId, 'open', 'snoozed', '12:00')
    await testDb
      .update(conversations)
      .set({
        slaApplied: sql`(${conversations.slaApplied} - 'pausedSpans' - 'pauseRevision') || ${JSON.stringify(
          { timeToCloseDueAt: legacy.dueAt, pausedAt: legacy.pausedAt }
        )}::jsonb`,
      })
      .where(eq(conversations.id, conversationId))

    await recordSlaFromEvent(snooze) // a replay
    await recordSlaFromEvent(await conversationMoves(conversationId, 'snoozed', 'open', '12:30'))

    // Only the half hour from 12:00 is excluded now: due 15:30.
    expect(await conversationClock(conversationId)).toEqual({
      dueAt: iso('15:30'),
      pausedAt: null,
      breaches: [],
    })
  })

  it("takes a ticket's ended pending spans as excluded and holds the current one", async () => {
    const ticket = await seedTicket()
    await ticketMoves(ticket, 'open', 'pending', '10:30')
    await ticketMoves(ticket, 'pending', 'open', '11:30')
    const pending = await ticketMoves(ticket, 'open', 'pending', '12:00')
    await testDb
      .update(tickets)
      .set({
        slaApplied: sql`(${tickets.slaApplied} - 'pausedSpans' - 'pauseRevision') || ${JSON.stringify(
          { timeToResolveDueAt: legacy.dueAt, pausedAt: legacy.pausedAt }
        )}::jsonb`,
      })
      .where(eq(tickets.id, ticket.ticketId))

    await recordSlaFromEvent(pending) // a replay
    await recordSlaFromEvent(await ticketMoves(ticket, 'pending', 'open', '12:30'))

    expect(await ticketClock(ticket.ticketId)).toEqual({
      dueAt: iso('15:30'),
      pausedAt: null,
      breaches: [],
    })
  })
})
