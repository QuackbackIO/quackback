/**
 * The SLA reaction runs from a queued job per event, and those jobs can run
 * out of order: a retry is requeued behind later jobs, two worker processes
 * can each run one, a crashed job re-runs once its lease lapses, and a queue
 * drained after a rollback replays old jobs late. The conversation's messages
 * never reorder, so the next-response clock is derived from them:
 *
 * - a customer message whose reply already exists arms its cycle and settles
 *   it at the earliest such reply, in one write;
 * - a customer message never arms a cycle over one the clock has already
 *   moved past (the first reply, a settled reply, or a later message's cycle);
 * - a customer message never ends a snooze that began after it.
 *
 * Real DB (rolled back) and the real reaction (`recordSlaFromEvent`), fed the
 * same `message.created` shape the event carries. The event's own timestamp is
 * set to the time the job runs, as a late job would see it; the clock goes by
 * the message's time.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type ConversationId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversationMessages,
  conversations,
  principal,
  slaEvents,
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
import {
  applySlaToConversation,
  pauseSlaOnSnooze,
  recordFirstResponse,
  type SlaApplied,
} from '../sla.service'
import { sweepOverdueSlaBreaches } from '../sla.sweep'
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

interface Thread {
  conversationId: ConversationId
  customer: PrincipalId
  agent: PrincipalId
}

/** A conversation under a 1h first-response / 2h next-response policy, applied at 10:00. */
async function seedThread(): Promise<Thread> {
  const customer = await seedPrincipal()
  const agent = await seedPrincipal()
  const [row] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: customer, channel: 'messenger' })
    .returning()
  const conversationId = row.id as ConversationId
  const policy = await createSlaPolicy({
    name: `FR+NR ${suffix()}`,
    firstResponseTargetSecs: 3600,
    nextResponseTargetSecs: 2 * 3600,
  })
  await applySlaToConversation(conversationId, policy.id, at('10:00'))
  return { conversationId, customer, agent }
}

/** The same thread with its first response already settled at 10:30. */
async function seedAnsweredThread(): Promise<Thread> {
  const thread = await seedThread()
  await write(thread, 'agent', '10:30')
  await recordFirstResponse(thread.conversationId, at('10:30'))
  return thread
}

/** A message row, written at `hhmm`. Returns the `message.created` its reaction reads. */
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
    // A late job runs long after the message; the clock must not use this.
    timestamp: new Date().toISOString(),
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
        createdAt: at(hhmm).toISOString(),
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

async function stampOf(conversationId: ConversationId): Promise<SlaApplied> {
  const [row] = await testDb
    .select({ slaApplied: conversations.slaApplied })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  return row.slaApplied as SlaApplied
}

/** The next-response events logged for the thread once the sweep has run, late in the day. */
async function nextResponseEvents(conversationId: ConversationId) {
  await sweepOverdueSlaBreaches(at('23:00'))
  return (await testDb.select().from(slaEvents).where(eq(slaEvents.conversationId, conversationId)))
    .filter((event) => event.kind.startsWith('next_response'))
    .map((event) => ({ kind: event.kind, dueAt: event.meta.dueAt, at: event.meta.at }))
}

describe.skipIf(!fixture.available)('next-response clock from reactions run out of order', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  it('in order, a customer message arms the cycle and the reply settles it', async () => {
    const thread = await seedAnsweredThread()
    await recordSlaFromEvent(await write(thread, 'visitor', '10:40'))
    expect(await stampOf(thread.conversationId)).toMatchObject({
      nextResponseDueAt: iso('12:40'),
      nextResponseAt: null,
    })

    await recordSlaFromEvent(await write(thread, 'agent', '11:40'))

    expect(await nextResponseEvents(thread.conversationId)).toEqual([
      { kind: 'next_response_met', dueAt: iso('12:40'), at: iso('11:40') },
    ])
  })

  it('a customer message reacted to after its reply arms and settles the cycle at that reply', async () => {
    const thread = await seedAnsweredThread()
    const customer = await write(thread, 'visitor', '10:40')
    const reply = await write(thread, 'agent', '11:40')

    await recordSlaFromEvent(reply)
    await recordSlaFromEvent(customer)

    expect(await stampOf(thread.conversationId)).toMatchObject({
      nextResponseDueAt: iso('12:40'),
      nextResponseAt: iso('11:40'),
    })
    expect(await nextResponseEvents(thread.conversationId)).toEqual([
      { kind: 'next_response_met', dueAt: iso('12:40'), at: iso('11:40') },
    ])
  })

  it('a customer message the first reply answered never arms a cycle', async () => {
    const thread = await seedThread()
    const customer = await write(thread, 'visitor', '10:10')
    await recordSlaFromEvent(await write(thread, 'agent', '10:30'))

    // The customer's reaction runs after the first reply settled.
    await recordSlaFromEvent(customer)

    expect((await stampOf(thread.conversationId)).nextResponseDueAt ?? null).toBeNull()
    expect(await nextResponseEvents(thread.conversationId)).toEqual([])
  })

  it("a stale customer message never moves a later message's deadline back", async () => {
    const thread = await seedAnsweredThread()
    const first = await write(thread, 'visitor', '10:40')
    const second = await write(thread, 'visitor', '11:00')

    await recordSlaFromEvent(second)
    await recordSlaFromEvent(first)

    expect(await stampOf(thread.conversationId)).toMatchObject({
      nextResponseDueAt: iso('13:00'),
      nextResponseAt: null,
    })
  })

  it('a customer message followed by another before the reply measures the cycle from the later one', async () => {
    const thread = await seedAnsweredThread()
    const first = await write(thread, 'visitor', '10:40')
    const second = await write(thread, 'visitor', '11:00')
    const reply = await write(thread, 'agent', '12:50')

    await recordSlaFromEvent(reply)
    await recordSlaFromEvent(first)
    await recordSlaFromEvent(second)

    // Due 13:00 from the later message, so the 12:50 reply met it.
    expect(await nextResponseEvents(thread.conversationId)).toEqual([
      { kind: 'next_response_met', dueAt: iso('13:00'), at: iso('12:50') },
    ])
  })

  it('a customer message never ends a snooze that began after it', async () => {
    const thread = await seedAnsweredThread()
    const customer = await write(thread, 'visitor', '10:40')
    // The agent snoozes the conversation at 11:00, and only then does the
    // customer's reaction run.
    await pauseSlaOnSnooze(thread.conversationId, at('11:00'))

    await recordSlaFromEvent(customer)

    expect((await stampOf(thread.conversationId)).pausedAt).toBe(iso('11:00'))
  })
})

describe.skipIf(!fixture.available)('response clocks from replies reacted to out of order', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  const firstResponseEvents = async (conversationId: ConversationId) =>
    (await testDb.select().from(slaEvents).where(eq(slaEvents.conversationId, conversationId)))
      .filter((event) => event.kind.startsWith('first_response'))
      .map((event) => ({ kind: event.kind, at: event.meta.at }))

  it('two replies reacted to in reverse settle the cycle at the first of them', async () => {
    const thread = await seedAnsweredThread()
    await recordSlaFromEvent(await write(thread, 'visitor', '10:40')) // due 12:40
    const first = await write(thread, 'agent', '11:00')
    const second = await write(thread, 'agent', '13:00')

    await recordSlaFromEvent(second)
    await recordSlaFromEvent(first)

    expect(await nextResponseEvents(thread.conversationId)).toEqual([
      { kind: 'next_response_met', dueAt: iso('12:40'), at: iso('11:00') },
    ])
  })

  it("a reply reacted to before the customer message it answers settles that message's cycle", async () => {
    const thread = await seedAnsweredThread()
    await recordSlaFromEvent(await write(thread, 'visitor', '10:40')) // due 12:40
    const followUp = await write(thread, 'visitor', '12:00') // due 14:00
    const reply = await write(thread, 'agent', '13:00')

    await recordSlaFromEvent(reply)
    await recordSlaFromEvent(followUp)

    // In order, the 12:00 follow-up re-armed the clock to 14:00 before the
    // reply, so the reply met it. It is not judged against 12:40.
    expect(await nextResponseEvents(thread.conversationId)).toEqual([
      { kind: 'next_response_met', dueAt: iso('14:00'), at: iso('13:00') },
    ])
  })

  it('two first replies reacted to in reverse settle the first response at the first of them', async () => {
    const thread = await seedThread() // first response due 11:00
    const first = await write(thread, 'agent', '10:55')
    const second = await write(thread, 'agent', '11:05')

    await recordSlaFromEvent(second)
    await recordSlaFromEvent(first)

    expect(await firstResponseEvents(thread.conversationId)).toEqual([
      { kind: 'first_response_met', at: iso('10:55') },
    ])
  })

  it("a reply retried after the next customer message never settles that message's cycle", async () => {
    const thread = await seedAnsweredThread()
    await recordSlaFromEvent(await write(thread, 'visitor', '10:40')) // due 12:40
    const reply = await write(thread, 'agent', '11:00') // its reaction fails, and is retried
    await recordSlaFromEvent(await write(thread, 'visitor', '11:30')) // re-armed, due 13:30

    await recordSlaFromEvent(reply)
    await recordSlaFromEvent(reply) // a second retry, or a replay

    // The 11:00 reply answered the 10:40 message, not the 11:30 one: the
    // 11:30 cycle stays open (and breaches), and the 10:40 cycle's outcome is
    // logged once.
    expect(await stampOf(thread.conversationId)).toMatchObject({
      nextResponseDueAt: iso('13:30'),
      nextResponseAt: null,
    })
    expect(await nextResponseEvents(thread.conversationId)).toEqual([
      { kind: 'next_response_met', dueAt: iso('12:40'), at: iso('11:00') },
      { kind: 'next_response_breached', dueAt: iso('13:30'), at: iso('23:00') },
    ])
  })

  it('a late reply for a cycle the sweep already breached logs no second outcome', async () => {
    const thread = await seedAnsweredThread()
    await recordSlaFromEvent(await write(thread, 'visitor', '10:40')) // due 12:40
    const reply = await write(thread, 'agent', '11:00') // its reaction runs late
    await sweepOverdueSlaBreaches(at('12:45')) // records the 10:40 cycle's breach
    // The customer wrote again at 12:30; that reaction runs after the sweep.
    await recordSlaFromEvent(await write(thread, 'visitor', '12:30')) // due 14:30

    await recordSlaFromEvent(reply)

    expect(await nextResponseEvents(thread.conversationId)).toEqual([
      { kind: 'next_response_breached', dueAt: iso('12:40'), at: iso('12:45') },
      { kind: 'next_response_breached', dueAt: iso('14:30'), at: iso('23:00') },
    ])
  })

  it('a cycle armed before its opener was recorded still settles at the reply', async () => {
    const thread = await seedAnsweredThread()
    await recordSlaFromEvent(await write(thread, 'visitor', '10:40')) // due 12:40
    // A stamp armed by a build that did not record the cycle's opener.
    await testDb
      .update(conversations)
      .set({ slaApplied: sql`${conversations.slaApplied} - 'nextResponseCycleAt'` })
      .where(eq(conversations.id, thread.conversationId))

    await recordSlaFromEvent(await write(thread, 'agent', '11:00'))

    expect((await stampOf(thread.conversationId)).nextResponseAt).toBe(iso('11:00'))
  })
})

/**
 * Leave the stamp as an earlier build writes it: the cycle's deadline (and its
 * reply, once answered), with no record of the message that opened the cycle
 * and no pause ledger.
 */
async function armedByEarlierBuild(
  conversationId: ConversationId,
  cycle: { nextResponseDueAt: string; nextResponseAt?: string } & Record<string, unknown>
) {
  await testDb
    .update(conversations)
    .set({
      slaApplied: sql`(${conversations.slaApplied} - 'nextResponseCycleAt' - 'pausedSpans' - 'pauseRevision') || ${JSON.stringify(
        { nextResponseAt: null, ...cycle }
      )}::jsonb`,
    })
    .where(eq(conversations.id, conversationId))
}

describe.skipIf(!fixture.available)('a cycle an earlier build armed', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  it('a reply after a sweep breach settles it after the breach, as the earlier build did', async () => {
    const thread = await seedAnsweredThread()
    await write(thread, 'visitor', '11:00')
    await armedByEarlierBuild(thread.conversationId, { nextResponseDueAt: iso('13:00') })
    // After the upgrade the sweep notes the breach, then the reply is written.
    await sweepOverdueSlaBreaches(at('13:05'))

    await recordSlaFromEvent(await write(thread, 'agent', '13:10'))

    expect(await stampOf(thread.conversationId)).toMatchObject({
      nextResponseCycleAt: iso('11:00'),
      nextResponseAt: iso('13:10'),
      nextResponseBreachedAt: iso('13:05'),
    })
    expect(await nextResponseEvents(thread.conversationId)).toEqual([
      { kind: 'next_response_breached', dueAt: iso('13:00'), at: iso('13:05') },
      { kind: 'next_response_settled_after_breach', dueAt: iso('13:00'), at: iso('13:10') },
    ])
  })

  it('a customer message after the upgrade restarts the wait from itself', async () => {
    const thread = await seedAnsweredThread()
    await write(thread, 'visitor', '11:00')
    await armedByEarlierBuild(thread.conversationId, { nextResponseDueAt: iso('13:00') })

    await recordSlaFromEvent(await write(thread, 'visitor', '11:30'))

    // The earlier build armed 11:00; this message is the latest, so the wait
    // runs from it, as it would have on the earlier build.
    expect(await stampOf(thread.conversationId)).toMatchObject({
      nextResponseCycleAt: iso('11:30'),
      nextResponseDueAt: iso('13:30'),
      nextResponseAt: null,
    })
  })

  it('under office hours, a message after the upgrade that gives the same deadline still restarts the wait', async () => {
    const thread = await seedAnsweredThread()
    await write(thread, 'visitor', '18:00')
    // The earlier build armed 18:00 on weekday hours (due Tuesday 11:00) and
    // paused at a snooze at 18:30.
    await recordStatusChange('conversation', thread.conversationId, 'open', 'snoozed', at('18:30'))
    await armedByEarlierBuild(thread.conversationId, {
      nextResponseDueAt: '2026-01-06T11:00:00.000Z',
      pausedAt: iso('18:30'),
      scheduleSnapshot: {
        timezone: 'UTC',
        intervals: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' })),
        holidays: [],
      },
    })

    // The customer writes at 19:00, which wakes the snooze. This message gives
    // the same deadline as the 18:00 one, and the earlier build would have
    // restarted the wait from it: due Tuesday 11:00, not the 18:00 cycle's
    // deadline pushed out by the half-hour snooze.
    await recordSlaFromEvent(await write(thread, 'visitor', '19:00'))

    expect(await stampOf(thread.conversationId)).toMatchObject({
      nextResponseCycleAt: iso('19:00'),
      nextResponseDueAt: '2026-01-06T11:00:00.000Z',
      pausedAt: null,
    })
  })

  it('the outcome the earlier build logged for an answered cycle is not logged again', async () => {
    const thread = await seedAnsweredThread()
    await write(thread, 'visitor', '11:00')
    await write(thread, 'agent', '11:30')
    await armedByEarlierBuild(thread.conversationId, {
      nextResponseDueAt: iso('13:00'),
      nextResponseAt: iso('11:30'),
    })
    // The outcome the earlier build logged, without naming its cycle.
    await testDb.insert(slaEvents).values({
      conversationId: thread.conversationId,
      policyId: (await stampOf(thread.conversationId)).policyId,
      kind: 'next_response_met',
      meta: { dueAt: iso('13:00'), at: iso('11:30'), overdueSecs: 0 },
    })

    await recordSlaFromEvent(await write(thread, 'visitor', '12:00'))

    expect((await stampOf(thread.conversationId)).nextResponseCycleAt).toBe(iso('12:00'))
    expect(await nextResponseEvents(thread.conversationId)).toEqual([
      { kind: 'next_response_met', dueAt: iso('13:00'), at: iso('11:30') },
      // The 12:00 cycle, unanswered, breaches at the 23:00 sweep.
      { kind: 'next_response_breached', dueAt: iso('14:00'), at: iso('23:00') },
    ])
  })
})
