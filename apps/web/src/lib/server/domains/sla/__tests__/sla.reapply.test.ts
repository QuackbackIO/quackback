/**
 * Re-applying an SLA (a policy change, or a reopen that applies one again)
 * replaces the stamp with a fresh one. The SLA reactions run from queued jobs
 * that can run late or be retried, so a reaction for an event from before the
 * re-apply can reach the new stamp. It belongs to the previous application and
 * must not move the new one: no settle, arm, pause or close from an event,
 * or from a message, written before the stamp's `appliedAt`.
 *
 * Real DB (rolled back) and the real reaction (`recordSlaFromEvent`), with
 * message rows and statuses written as in production.
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
const iso = (hhmm: string) => at(hhmm).toISOString()

async function seedPrincipal(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

// --- conversations -----------------------------------------------------------

type ConversationStatus = 'open' | 'snoozed' | 'closed'

interface Thread {
  conversationId: ConversationId
  customer: PrincipalId
  agent: PrincipalId
  policyId: Awaited<ReturnType<typeof createSlaPolicy>>['id']
}

/** A conversation under a 1h first-response / 2h next-response / 4h close policy, applied at 10:00. */
async function seedThread(): Promise<Thread> {
  const customer = await seedPrincipal()
  const agent = await seedPrincipal()
  const [row] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: customer, channel: 'messenger' })
    .returning()
  const conversationId = row.id as ConversationId
  const policy = await createSlaPolicy({
    name: `All clocks ${suffix()}`,
    firstResponseTargetSecs: 3600,
    nextResponseTargetSecs: 2 * 3600,
    timeToCloseTargetSecs: 4 * 3600,
    pauseOnSnooze: true,
  })
  await applySlaToConversation(conversationId, policy.id, at('10:00'))
  return { conversationId, customer, agent, policyId: policy.id }
}

/** The SLA is applied again at 11:00, replacing the stamp. */
const reapply = (thread: Thread) =>
  applySlaToConversation(thread.conversationId, thread.policyId, at('11:00'))

/** A message row written at `hhmm`, and the `message.created` its reaction reads. */
async function write(thread: Thread, senderType: 'visitor' | 'agent', hhmm: string) {
  const principalId = senderType === 'visitor' ? thread.customer : thread.agent
  const [row] = await testDb
    .insert(conversationMessages)
    .values({
      conversationId: thread.conversationId,
      principalId,
      senderType,
      content: `${senderType} at ${hhmm}`,
      createdAt: at(hhmm),
    })
    .returning()
  return {
    type: 'message.created',
    id: createId('event'),
    timestamp: iso(hhmm),
    actor: { type: 'user', principalId },
    data: {
      message: {
        id: row.id,
        conversationId: thread.conversationId,
        senderType,
        authorPrincipalId: principalId,
        authorName: senderType,
        authorEmail: null,
        content: row.content,
        createdAt: iso(hhmm),
      },
      conversation: {
        id: thread.conversationId,
        status: 'open',
        channel: 'messenger',
        priority: 'medium',
        assignedTeamId: null,
      },
      isFirstMessage: false,
    },
  } as unknown as EventData
}

/** Move the conversation to `newStatus` at `hhmm`; returns the event its reaction reads. */
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
  await recordStatusChange('conversation', conversationId, previousStatus, newStatus, at(hhmm))
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

async function stampOf(conversationId: ConversationId): Promise<SlaApplied> {
  const [row] = await testDb
    .select({ slaApplied: conversations.slaApplied })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  return row.slaApplied as SlaApplied
}

// --- tickets -----------------------------------------------------------------

type TicketCategory = 'open' | 'pending' | 'closed'

/** A customer ticket under a 4h time-to-resolve policy that pauses on pending, applied at 10:00. */
async function seedTicket() {
  const rows = await testDb
    .insert(ticketStatuses)
    .values(
      (['open', 'pending', 'closed'] as const).map((category) => ({
        name: `${category} ${suffix()}`,
        slug: `${category}_${suffix()}`,
        category,
      }))
    )
    .returning()
  const statusFor = Object.fromEntries(rows.map((row) => [row.category, row.id])) as Record<
    TicketCategory,
    TicketStatusId
  >
  const [row] = await testDb
    .insert(tickets)
    .values({ type: 'customer', title: `Ticket ${suffix()}`, statusId: statusFor.open })
    .returning()
  const ticketId = row.id as TicketId
  const policy = await createSlaPolicy({
    name: `TTR ${suffix()}`,
    timeToResolveTargetSecs: 4 * 3600,
    pauseOnPending: true,
  })
  await applySlaToTicket(ticketId, policy.id, at('10:00'))
  return { ticketId, statusFor, policyId: policy.id }
}

/** Move the ticket to `newStatus`'s category at `hhmm`; returns the event its reaction reads. */
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
    timestamp: iso(hhmm),
    actor: { type: 'user' },
    data: { ticket: { id: ticket.ticketId }, previousStatus, newStatus },
  } as unknown as EventData
}

async function ticketStampOf(ticketId: TicketId): Promise<TicketSlaApplied> {
  const [row] = await testDb
    .select({ slaApplied: tickets.slaApplied })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
  return row.slaApplied as TicketSlaApplied
}

describe.skipIf(!fixture.available)('SLA reactions for events before a re-apply', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  it('a reply reacted to after a re-apply does not settle the new first-response clock', async () => {
    const thread = await seedThread()
    const earlyReply = await write(thread, 'agent', '10:30') // its reaction runs late
    await reapply(thread)

    await recordSlaFromEvent(earlyReply)
    expect((await stampOf(thread.conversationId)).firstResponseAt ?? null).toBeNull()

    // A reply to the new application settles it at its own time.
    await recordSlaFromEvent(await write(thread, 'agent', '11:30'))
    expect((await stampOf(thread.conversationId)).firstResponseAt).toBe(iso('11:30'))
  })

  it('messages from before a re-apply do not settle or arm the new clocks', async () => {
    const thread = await seedThread()
    const earlyReply = await write(thread, 'agent', '10:30')
    const earlyCustomer = await write(thread, 'visitor', '10:40')
    await reapply(thread)

    // Both reactions run late, after the re-apply.
    await recordSlaFromEvent(earlyReply)
    await recordSlaFromEvent(earlyCustomer)
    const stamp = await stampOf(thread.conversationId)
    expect(stamp.firstResponseAt ?? null).toBeNull()
    expect(stamp.nextResponseDueAt ?? null).toBeNull()

    // In order after the re-apply: the reply settles the first response, and
    // the customer's next message arms the next-response clock from its time.
    await recordSlaFromEvent(await write(thread, 'agent', '11:30'))
    await recordSlaFromEvent(await write(thread, 'visitor', '11:40'))
    expect(await stampOf(thread.conversationId)).toMatchObject({
      firstResponseAt: iso('11:30'),
      nextResponseDueAt: iso('13:40'),
    })
  })

  it('a reply reacted to after a re-apply does not settle the new next-response cycle', async () => {
    const thread = await seedThread()
    const earlyReply = await write(thread, 'agent', '10:30') // its reaction runs late
    await reapply(thread)
    await recordSlaFromEvent(await write(thread, 'agent', '11:10')) // first response
    await recordSlaFromEvent(await write(thread, 'visitor', '11:20')) // due 13:20

    await recordSlaFromEvent(earlyReply)

    expect(await stampOf(thread.conversationId)).toMatchObject({
      nextResponseDueAt: iso('13:20'),
      nextResponseAt: null,
    })
  })

  it('the reply side never settles at a message written before the SLA was applied', async () => {
    const thread = await seedThread()
    await write(thread, 'agent', '10:30')
    await write(thread, 'visitor', '10:40')
    await write(thread, 'agent', '10:50')
    await reapply(thread)
    // A stamp an earlier build could leave behind: its first response and its
    // armed cycle both come from messages written before it was applied.
    await testDb
      .update(conversations)
      .set({
        slaApplied: sql`${conversations.slaApplied} || ${JSON.stringify({
          firstResponseAt: iso('10:30'),
          nextResponseCycleAt: iso('10:40'),
          nextResponseDueAt: iso('12:40'),
        })}::jsonb`,
      })
      .where(eq(conversations.id, thread.conversationId))

    await recordSlaFromEvent(await write(thread, 'agent', '11:30'))

    // Settled at the reply after the re-apply, not at the 10:50 one before it.
    expect((await stampOf(thread.conversationId)).nextResponseAt).toBe(iso('11:30'))
  })

  it('a customer message from before the SLA was applied never re-arms it', async () => {
    const thread = await seedThread()
    const earlyCustomer = await write(thread, 'visitor', '10:40') // its reaction runs late
    await reapply(thread)
    // A stamp an earlier build could leave behind: settled at a reply written
    // before it was applied.
    await testDb
      .update(conversations)
      .set({
        slaApplied: sql`${conversations.slaApplied} || ${JSON.stringify({
          firstResponseAt: iso('10:30'),
        })}::jsonb`,
      })
      .where(eq(conversations.id, thread.conversationId))

    await recordSlaFromEvent(earlyCustomer)

    expect((await stampOf(thread.conversationId)).nextResponseDueAt ?? null).toBeNull()
  })

  it('a close reacted to after a re-apply does not settle the new time-to-close clock', async () => {
    const thread = await seedThread()
    const close = await conversationMoves(thread.conversationId, 'open', 'closed', '10:30')
    await recordSlaFromEvent(
      await conversationMoves(thread.conversationId, 'closed', 'open', '10:45')
    )
    await reapply(thread)

    await recordSlaFromEvent(close)

    expect((await stampOf(thread.conversationId)).resolvedAt ?? null).toBeNull()
  })

  it('a snooze reacted to after a re-apply does not pause the new clock from before it existed', async () => {
    const thread = await seedThread()
    const earlySnooze = await conversationMoves(thread.conversationId, 'open', 'snoozed', '10:30')
    await conversationMoves(thread.conversationId, 'snoozed', 'open', '10:45')
    await reapply(thread)
    const laterSnooze = await conversationMoves(thread.conversationId, 'open', 'snoozed', '11:20')

    // The 10:30 snooze's reaction runs late, while the 11:20 snooze is current.
    await recordSlaFromEvent(earlySnooze)
    await recordSlaFromEvent(laterSnooze)

    expect((await stampOf(thread.conversationId)).pausedAt).toBe(iso('11:20'))
  })

  it('a ticket close reacted to after a re-apply does not settle the new time-to-resolve clock', async () => {
    const ticket = await seedTicket()
    const close = await ticketMoves(ticket, 'open', 'closed', '10:30')
    await recordSlaFromEvent(await ticketMoves(ticket, 'closed', 'open', '10:45'))
    await applySlaToTicket(ticket.ticketId, ticket.policyId, at('11:00'))

    await recordSlaFromEvent(close)

    expect((await ticketStampOf(ticket.ticketId)).resolvedAt ?? null).toBeNull()
  })

  it('a pending reacted to after a re-apply does not pause the new ticket clock from before it existed', async () => {
    const ticket = await seedTicket()
    const earlyPending = await ticketMoves(ticket, 'open', 'pending', '10:30')
    await ticketMoves(ticket, 'pending', 'open', '10:45')
    await applySlaToTicket(ticket.ticketId, ticket.policyId, at('11:00'))
    const laterPending = await ticketMoves(ticket, 'open', 'pending', '11:20')

    await recordSlaFromEvent(earlyPending)
    await recordSlaFromEvent(laterPending)

    expect((await ticketStampOf(ticket.ticketId)).pausedAt).toBe(iso('11:20'))
  })
})
