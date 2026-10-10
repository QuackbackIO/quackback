/**
 * The next-response cycle is identified by the customer message that opened
 * it (`nextResponseCycleAt`), never by comparing deadlines. Deadlines are not
 * monotonic in message time: a resume shifts an unanswered cycle's deadline by
 * the wall-clock pause, while a fresh cycle's deadline is computed in office
 * hours, so an older cycle can end up due later than a newer one.
 *
 * Real DB (rolled back) and the real reaction (`recordSlaFromEvent`), with
 * message rows written as the conversation service writes them and the
 * conversation's status changed before each status event, as in production.
 * Each event's timestamp is its message's time: these run in order unless a
 * case says otherwise.
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
} from '@/lib/server/db'
import type { EventData } from '@/lib/server/events/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const workspaceHours = vi.hoisted(() => ({
  schedule: {
    enabled: false,
    timezone: 'UTC',
    intervals: [] as { day: number; start: string; end: string }[],
  },
}))
vi.mock('@/lib/server/domains/settings/settings.office-hours', () => ({
  getOfficeHoursSchedule: vi.fn(async () => workspaceHours.schedule),
}))

import { createSlaPolicy } from '../sla-policy.service'
import { applySlaToConversation, type SlaApplied } from '../sla.service'
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
/** 2026-01-05 is a Monday: `t('mon 10:00')`. */
const DAYS: Record<string, string> = { mon: '05', tue: '06', wed: '07' }
const t = (s: string) => {
  const [day, hm] = s.split(' ')
  return new Date(`2026-01-${DAYS[day]}T${hm}:00.000Z`)
}
/** Office hours 09:00-17:00 every day. */
const OFFICE_HOURS = {
  enabled: true,
  timezone: 'UTC',
  intervals: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: '09:00', end: '17:00' })),
}

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

/** A conversation under a 1h first-response / 2h next-response policy that pauses on snooze. */
async function seedThread(appliedAt: Date): Promise<Thread> {
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
    pauseOnSnooze: true,
  })
  await applySlaToConversation(conversationId, policy.id, appliedAt)
  return { conversationId, customer, agent }
}

/**
 * A message row written at `when`, and the `message.created` its reaction
 * reads. A customer message wakes a snoozed conversation, as the
 * conversation service does in the message's own transaction.
 */
async function write(thread: Thread, senderType: 'visitor' | 'agent', when: Date) {
  const principalId = senderType === 'visitor' ? thread.customer : thread.agent
  const [row] = await testDb
    .insert(conversationMessages)
    .values({
      conversationId: thread.conversationId,
      principalId,
      senderType,
      content: `${senderType} at ${when.toISOString()}`,
      createdAt: when,
    })
    .returning()
  if (senderType === 'visitor') await setStatus(thread.conversationId, 'open')
  return {
    type: 'message.created',
    id: createId('event'),
    timestamp: when.toISOString(),
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
        createdAt: when.toISOString(),
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

const setStatus = (conversationId: ConversationId, status: 'open' | 'snoozed') =>
  testDb.update(conversations).set({ status }).where(eq(conversations.id, conversationId))

/** Move the conversation to `newStatus` and return the event its reaction reads. */
async function changeStatus(
  conversationId: ConversationId,
  previousStatus: 'open' | 'snoozed',
  newStatus: 'open' | 'snoozed',
  when: Date
): Promise<EventData> {
  await setStatus(conversationId, newStatus)
  await recordStatusChange('conversation', conversationId, previousStatus, newStatus, when)
  return {
    type: 'conversation.status_changed',
    id: createId('event'),
    timestamp: when.toISOString(),
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

async function nextResponseEvents(conversationId: ConversationId) {
  await sweepOverdueSlaBreaches(t('wed 23:00'))
  return (await testDb.select().from(slaEvents).where(eq(slaEvents.conversationId, conversationId)))
    .filter((event) => event.kind.startsWith('next_response'))
    .map((event) => ({ kind: event.kind, dueAt: event.meta.dueAt, at: event.meta.at }))
}

describe.skipIf(!fixture.available)('next-response cycle identity', () => {
  beforeEach(() => {
    workspaceHours.schedule = { enabled: false, timezone: 'UTC', intervals: [] }
    return fixture.begin()
  })
  afterEach(fixture.rollback)

  // In order, no reorder. The customer's Mon 16:30 message is left unanswered
  // (due Tue 10:30) and the agent snoozes at 16:45. The customer writes again
  // at Tue 08:00, which wakes the snooze: the resume shifts the old deadline
  // by the 15h15m pause to Wed 01:45, and the fresh cycle is due 2 office
  // hours after 08:00, Tue 11:00. The 14:00 reply breaches it.
  it('a customer message after a snooze under office hours re-arms its own cycle', async () => {
    workspaceHours.schedule = OFFICE_HOURS
    const thread = await seedThread(t('mon 10:00'))
    await recordSlaFromEvent(await write(thread, 'agent', t('mon 10:30'))) // first response
    await recordSlaFromEvent(await write(thread, 'visitor', t('mon 16:30')))
    expect((await stampOf(thread.conversationId)).nextResponseDueAt).toBe(
      t('tue 10:30').toISOString()
    )
    await recordSlaFromEvent(
      await changeStatus(thread.conversationId, 'open', 'snoozed', t('mon 16:45'))
    )

    await recordSlaFromEvent(await write(thread, 'visitor', t('tue 08:00')))
    expect((await stampOf(thread.conversationId)).nextResponseDueAt).toBe(
      t('tue 11:00').toISOString()
    )

    await recordSlaFromEvent(await write(thread, 'agent', t('tue 14:00')))
    expect(await nextResponseEvents(thread.conversationId)).toEqual([
      {
        kind: 'next_response_breached',
        dueAt: t('tue 11:00').toISOString(),
        at: t('tue 14:00').toISOString(),
      },
    ])
  })

  // The same through a snooze that expires (the resume runs at Tue 09:00),
  // with the customer's 09:30 message reacted to after the 14:00 reply. In
  // order the 09:30 message re-arms to Tue 11:30 and the reply breaches it.
  it('a reply reacted to first still judges against the message after the snooze', async () => {
    workspaceHours.schedule = OFFICE_HOURS
    const thread = await seedThread(t('mon 10:00'))
    await recordSlaFromEvent(await write(thread, 'agent', t('mon 10:30')))
    await recordSlaFromEvent(await write(thread, 'visitor', t('mon 16:30'))) // due Tue 10:30
    await recordSlaFromEvent(
      await changeStatus(thread.conversationId, 'open', 'snoozed', t('mon 16:45'))
    )
    await recordSlaFromEvent(
      await changeStatus(thread.conversationId, 'snoozed', 'open', t('tue 09:00'))
    )
    const customer = await write(thread, 'visitor', t('tue 09:30'))
    await recordSlaFromEvent(await write(thread, 'agent', t('tue 14:00')))
    await recordSlaFromEvent(customer)

    expect(await nextResponseEvents(thread.conversationId)).toEqual([
      {
        kind: 'next_response_breached',
        dueAt: t('tue 11:30').toISOString(),
        at: t('tue 14:00').toISOString(),
      },
    ])
  })

  // A retried customer-message reaction, after a snooze and resume shifted
  // its own cycle, keeps that shift rather than re-arming unshifted.
  it('a repeat run of a message reaction keeps its own cycle and the pause shift', async () => {
    const thread = await seedThread(t('mon 10:00'))
    await recordSlaFromEvent(await write(thread, 'agent', t('mon 10:30')))
    const customer = await write(thread, 'visitor', t('mon 10:40'))
    await recordSlaFromEvent(customer) // due 12:40
    await recordSlaFromEvent(
      await changeStatus(thread.conversationId, 'open', 'snoozed', t('mon 11:00'))
    )
    await recordSlaFromEvent(
      await changeStatus(thread.conversationId, 'snoozed', 'open', t('mon 11:30'))
    )
    expect((await stampOf(thread.conversationId)).nextResponseDueAt).toBe(
      t('mon 13:10').toISOString()
    )

    await recordSlaFromEvent(customer) // the retry

    expect((await stampOf(thread.conversationId)).nextResponseDueAt).toBe(
      t('mon 13:10').toISOString()
    )
  })
})
