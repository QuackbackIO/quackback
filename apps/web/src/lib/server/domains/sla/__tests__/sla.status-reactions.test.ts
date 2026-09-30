/**
 * The SLA pause and resume reactions run from queued jobs, which a failure
 * retries a second or more later, after status changes that came after the
 * event. So a pause or resume goes by the entity's status history, not by the
 * event alone (sla.pause-reconcile.ts): a retried wake closes its own pause at
 * its own time even after the next pause began, which stays held; a pause
 * reacted to after it ended leaves nothing held. The clock never runs through
 * a later snooze, and no active time between two pauses is excluded.
 *
 * Real DB (rolled back) and the real reaction (`recordSlaFromEvent`). Each
 * status event is preceded by the status change it reports and its row in the
 * events log, as in production.
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
  principal,
  slaEvents,
  tickets,
  ticketStatuses,
  user,
  eq,
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
import { recordStatusChange } from './status-history'

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

// --- conversations -----------------------------------------------------------

type ConversationStatus = 'open' | 'snoozed'

/** A conversation under a 4h time-to-close policy that pauses on snooze, applied at 10:00. */
async function seedConversation() {
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
  const policy = await createSlaPolicy({
    name: `TTC ${suffix()}`,
    timeToCloseTargetSecs: 4 * 3600,
    pauseOnSnooze: true,
  })
  await applySlaToConversation(conversationId, policy.id, at('10:00')) // due 14:00
  return { conversationId, customer }
}

const setConversationStatus = (conversationId: ConversationId, status: ConversationStatus) =>
  testDb.update(conversations).set({ status }).where(eq(conversations.id, conversationId))

/** Move the conversation to `newStatus`; returns the event its reaction reads. */
async function conversationMoves(
  conversationId: ConversationId,
  previousStatus: ConversationStatus,
  newStatus: ConversationStatus,
  hhmm: string
): Promise<EventData> {
  await setConversationStatus(conversationId, newStatus)
  await recordStatusChange('conversation', conversationId, previousStatus, newStatus, at(hhmm))
  return {
    type: 'conversation.status_changed',
    id: createId('event'),
    timestamp: at(hhmm).toISOString(),
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
  await setConversationStatus(conversationId, 'open')
  return {
    type: 'message.created',
    id: createId('event'),
    timestamp: at(hhmm).toISOString(),
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
        createdAt: at(hhmm).toISOString(),
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

async function conversationClock(conversationId: ConversationId) {
  const [row] = await testDb
    .select({ slaApplied: conversations.slaApplied })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  await sweepOverdueSlaBreaches(at('18:00'))
  const breaches = (
    await testDb.select().from(slaEvents).where(eq(slaEvents.conversationId, conversationId))
  )
    .filter((event) => event.kind.endsWith('_breached'))
    .map((event) => event.kind)
  const stamp = row.slaApplied as SlaApplied
  return { dueAt: stamp.timeToCloseDueAt, pausedAt: stamp.pausedAt ?? null, breaches }
}

// --- tickets -----------------------------------------------------------------

type TicketCategory = 'open' | 'pending'

/** A customer ticket under a 4h time-to-resolve policy that pauses on pending, applied at 10:00. */
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
  await applySlaToTicket(ticketId, policy.id, at('10:00')) // due 14:00
  const statusFor = { open: open.id as TicketStatusId, pending: pending.id as TicketStatusId }
  return { ticketId, statusFor }
}

/** Move the ticket to `newStatus`'s category; returns the event its reaction reads. */
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
  await recordStatusChange('ticket', ticket.ticketId, previousStatus, newStatus, at(hhmm))
  return {
    type: 'ticket.status_changed',
    id: createId('event'),
    timestamp: at(hhmm).toISOString(),
    actor: { type: 'user' },
    data: { ticket: { id: ticket.ticketId }, previousStatus, newStatus },
  } as unknown as EventData
}

async function ticketClock(ticketId: TicketId) {
  const [row] = await testDb
    .select({ slaApplied: tickets.slaApplied })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
  await sweepOverdueTicketSlaBreaches(at('18:00'))
  const breaches = (await testDb.select().from(slaEvents).where(eq(slaEvents.ticketId, ticketId)))
    .filter((event) => event.kind.endsWith('_breached'))
    .map((event) => event.kind)
  const stamp = row.slaApplied as TicketSlaApplied
  return { dueAt: stamp.timeToResolveDueAt, pausedAt: stamp.pausedAt ?? null, breaches }
}

describe.skipIf(!fixture.available)('SLA status reactions run late or retried', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  it('a retried un-snooze does not run the clock through a later snooze', async () => {
    const { conversationId } = await seedConversation()
    await recordSlaFromEvent(await conversationMoves(conversationId, 'open', 'snoozed', '10:30'))
    // The 11:00 un-snooze's reaction fails; the agent snoozes again at 11:05
    // (a no-op pause: the clock is still paused from 10:30); then the retry.
    const unsnooze = await conversationMoves(conversationId, 'snoozed', 'open', '11:00')
    await recordSlaFromEvent(await conversationMoves(conversationId, 'open', 'snoozed', '11:05'))
    await recordSlaFromEvent(unsnooze)

    // Snoozed 10:30-11:00 (excluded: due 14:30) and again from 11:05 (held).
    expect(await conversationClock(conversationId)).toEqual({
      dueAt: at('14:30').toISOString(),
      pausedAt: at('11:05').toISOString(),
      breaches: [],
    })
  })

  it('a snooze reacted to after the conversation woke does not pause the clock', async () => {
    const { conversationId } = await seedConversation()
    const snooze = await conversationMoves(conversationId, 'open', 'snoozed', '10:30')
    const wake = await conversationMoves(conversationId, 'snoozed', 'open', '10:45')
    await recordSlaFromEvent(wake)
    await recordSlaFromEvent(snooze)

    expect((await conversationClock(conversationId)).pausedAt).toBeNull()
  })

  it('a customer message retried after a later snooze does not resume the clock', async () => {
    const { conversationId, customer } = await seedConversation()
    await recordSlaFromEvent(await conversationMoves(conversationId, 'open', 'snoozed', '10:30'))
    // The 11:00 message wakes the conversation; its reaction fails. The agent
    // snoozes again at 11:05, then the message's reaction is retried.
    const message = await customerWrites(conversationId, customer, '11:00')
    await recordSlaFromEvent(await conversationMoves(conversationId, 'open', 'snoozed', '11:05'))
    await recordSlaFromEvent(message)

    // Snoozed 10:30-11:00 (excluded: due 14:30) and again from 11:05 (held).
    expect(await conversationClock(conversationId)).toEqual({
      dueAt: at('14:30').toISOString(),
      pausedAt: at('11:05').toISOString(),
      breaches: [],
    })
  })

  it('a retried leave-pending does not run the ticket clock through a later pending', async () => {
    const ticket = await seedTicket()
    await recordSlaFromEvent(await ticketMoves(ticket, 'open', 'pending', '10:30'))
    const leave = await ticketMoves(ticket, 'pending', 'open', '11:00')
    await recordSlaFromEvent(await ticketMoves(ticket, 'open', 'pending', '11:05'))
    await recordSlaFromEvent(leave)

    expect(await ticketClock(ticket.ticketId)).toEqual({
      dueAt: at('14:30').toISOString(),
      pausedAt: at('11:05').toISOString(),
      breaches: [],
    })
  })

  it('a pending reacted to after the ticket left pending does not pause the clock', async () => {
    const ticket = await seedTicket()
    const pending = await ticketMoves(ticket, 'open', 'pending', '10:30')
    const leave = await ticketMoves(ticket, 'pending', 'open', '10:45')
    await recordSlaFromEvent(leave)
    await recordSlaFromEvent(pending)

    expect((await ticketClock(ticket.ticketId)).pausedAt).toBeNull()
  })
})
