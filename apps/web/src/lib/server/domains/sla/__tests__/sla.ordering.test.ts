/**
 * Randomized ordering: the SLA reactions run from queued jobs that can run
 * late, out of order, retried or twice, and the outcome must not depend on it.
 *
 * Each case generates a plausible timeline from a seed (customer messages,
 * agent replies, snoozes and their extensions, wakes, closes, reopens and an
 * SLA applied again; for a ticket, pending spans, moves between pending
 * statuses, closes, reopens and an SLA applied again). The writes happen in
 * timeline order, as they do in production. The expected result runs each
 * write's reaction right after it. Then many schedules delay, reorder, retry
 * and duplicate the same reactions, and the final stamp (deadlines, pause,
 * settled times) and the logged clock events must equal the expected ones.
 *
 * Accepted and excluded from the comparison: an outcome of an SLA application
 * that a later application already replaced. A reaction that runs after the
 * SLA was applied again is ignored (the application check in sla.service.ts),
 * so what it would have recorded on the replaced stamp is lost.
 *
 * Real DB (rolled back) and the real reaction (`recordSlaFromEvent`), with the
 * message rows, statuses and events-log rows written as in production. A
 * failure names its scenario seed, its schedule seed and the timeline;
 * `-t "scenario <seed>"` reruns it.
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
import { applySlaToConversation } from '../sla.service'
import { applySlaToTicket } from '../ticket-sla.service'
import { recordSlaFromEvent } from '../sla.event-hooks'
import { recordStatusChange } from './status-history'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db.select({ id: slaEvents.id }).from(slaEvents).limit(0)
  },
})
afterAll(() => fixture.close())

// 10 scenarios of each kind, 12 schedules each. SLA_ORDERING_SCENARIOS runs
// more, for a longer local search.
const SCENARIOS = Number(process.env.SLA_ORDERING_SCENARIOS ?? 10)
const SCHEDULES = 12
const scenarios = (first: number, regressions: number[]) => [
  ...Array.from({ length: SCENARIOS }, (_, i) => first + i),
  ...regressions.filter((seed) => seed >= first + SCENARIOS),
]
// Seeds a longer search found a divergence with, kept in every run: 1015
// settles a next-response cycle after a later snooze was already excluded.
const CONVERSATION_SCENARIOS = scenarios(1000, [1015])
const TICKET_SCENARIOS = scenarios(2000, [])
const MINUTE = 60_000
const START = Date.parse('2026-01-05T09:00:00.000Z')

/** A small seeded generator (mulberry32), so a failing seed reproduces. */
function random(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    weighted<T extends string>(weights: Partial<Record<T, number>>): T {
      const entries = Object.entries(weights) as [T, number][]
      let roll = next() * entries.reduce((sum, [, weight]) => sum + weight, 0)
      for (const [item, weight] of entries) {
        roll -= weight
        if (roll < 0) return item
      }
      return entries[entries.length - 1][0]
    },
  }
}

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

/**
 * One timeline step. `write` makes the change as production does and returns
 * the event its reaction reads, or null for a change no reaction follows (an
 * SLA applied again).
 */
type Step = { label: string; write: () => Promise<EventData | null> }

/**
 * Run a timeline under a schedule. With no generator, each reaction runs
 * right after its write. Otherwise reactions are delayed, reordered, retried
 * and duplicated, and every one runs at least once.
 */
async function runTimeline(steps: Step[], schedule: ReturnType<typeof random> | null) {
  const queue: EventData[] = []
  for (const step of steps) {
    const event = await step.write()
    if (event) queue.push(event)
    if (!schedule) {
      for (const inOrder of queue.splice(0)) await recordSlaFromEvent(inOrder)
      continue
    }
    while (queue.length && schedule.next() < 0.45) await runOne(queue, schedule)
  }
  while (schedule && queue.length) await runOne(queue, schedule)
}

async function runOne(queue: EventData[], schedule: ReturnType<typeof random>) {
  const index = schedule.int(0, queue.length - 1)
  const [event] = queue.splice(index, 1)
  await recordSlaFromEvent(event)
  // A retry after a failure, or a duplicate delivery: the same reaction again, later.
  if (schedule.next() < 0.2) queue.push(event)
}

/** Schedule `schedule` of `scenario` runs on this seed. */
const scheduleSeed = (scenario: number, schedule: number) => scenario * 100 + schedule

/** A failure message that reproduces the case: its seeds and the timeline. */
function failure(scenario: number, schedule: number, steps: Step[]): string {
  const timeline = steps.map((step) => step.label).join('\n')
  return `scenario seed ${scenario}, schedule seed ${scheduleSeed(scenario, schedule)}\n${timeline}`
}

/** The stamp's clock fields, and its pause ledger as a sorted set of spans. */
function comparable(stamp: Record<string, unknown>, fields: string[]) {
  const spans = (stamp.pausedSpans ?? []) as { from: string; until: string }[]
  return {
    ...Object.fromEntries(fields.map((field) => [field, stamp[field] ?? null])),
    pausedSpans: spans.map((span) => `${span.from}..${span.until}`).sort(),
  }
}

/** The logged clock events for an owner, from `since` on, as a sorted multiset. */
function clockEvents(
  rows: { kind: string; meta: Record<string, unknown> }[],
  since: number
): string[] {
  return rows
    .filter((row) => typeof row.meta.at !== 'string' || Date.parse(row.meta.at) >= since)
    .map((row) => `${row.kind} due=${row.meta.dueAt ?? '-'} at=${row.meta.at ?? '-'}`)
    .sort()
}

// --- conversations -----------------------------------------------------------

type ConversationStatus = 'open' | 'snoozed' | 'closed'

/** A conversation timeline from `seed`, written against `conversationId`. */
function conversationTimeline(
  seed: number,
  target: { conversationId: ConversationId; customer: PrincipalId; agent: PrincipalId },
  policyId: Awaited<ReturnType<typeof createSlaPolicy>>['id']
): Step[] {
  const rng = random(seed)
  const steps: Step[] = []
  let status: ConversationStatus = 'open'
  let at = START
  let reapplied = 0
  const conversationRef = () => ({
    id: target.conversationId,
    status,
    channel: 'messenger',
    priority: 'medium',
    assignedTeamId: null,
  })
  const setStatus = (next: ConversationStatus) =>
    testDb
      .update(conversations)
      .set({ status: next })
      .where(eq(conversations.id, target.conversationId))

  const count = rng.int(8, 14)
  for (let i = 0; i < count; i++) {
    at += rng.int(3, 50) * MINUTE
    const when = new Date(at)
    const weights: Partial<Record<string, number>> = { customer: 3, reply: 3 }
    if (status === 'open') Object.assign(weights, { snooze: 2, close: 1 })
    if (status === 'snoozed') Object.assign(weights, { extend: 1, wake: 2, close: 1 })
    if (status === 'closed') Object.assign(weights, { reopen: 1 })
    if (reapplied < 1) weights.reapply = 0.5
    const action = rng.weighted(weights)

    if (action === 'customer' || action === 'reply') {
      const senderType = action === 'customer' ? 'visitor' : 'agent'
      const principalId = senderType === 'visitor' ? target.customer : target.agent
      const wakes = senderType === 'visitor' ? status !== 'open' : status === 'closed'
      if (wakes) status = 'open'
      const nextStatus = status
      steps.push({
        label: `${when.toISOString()} ${action}`,
        write: async () => {
          const [row] = await testDb
            .insert(conversationMessages)
            .values({
              conversationId: target.conversationId,
              principalId,
              senderType,
              content: `${action} at ${when.toISOString()}`,
              createdAt: when,
            })
            .returning()
          if (wakes) await setStatus(nextStatus)
          return {
            type: 'message.created',
            id: createId('event'),
            timestamp: when.toISOString(),
            actor: { type: 'user', principalId },
            data: {
              message: {
                id: row.id,
                conversationId: target.conversationId,
                senderType,
                authorPrincipalId: principalId,
                authorName: senderType,
                authorEmail: null,
                content: row.content,
                createdAt: when.toISOString(),
              },
              conversation: conversationRef(),
              isFirstMessage: false,
            },
          } as unknown as EventData
        },
      })
      continue
    }
    if (action === 'reapply') {
      reapplied++
      steps.push({
        label: `${when.toISOString()} reapply`,
        write: async () => {
          await applySlaToConversation(target.conversationId, policyId, when)
          return null
        },
      })
      continue
    }
    const previous = status
    const next: ConversationStatus = (
      {
        snooze: 'snoozed',
        extend: 'snoozed',
        wake: 'open',
        close: 'closed',
        reopen: 'open',
      } as const
    )[action as 'snooze' | 'extend' | 'wake' | 'close' | 'reopen']
    status = next
    const ref = conversationRef()
    steps.push({
      label: `${when.toISOString()} ${action} (${previous} -> ${next})`,
      write: async () => {
        await setStatus(next)
        await recordStatusChange('conversation', target.conversationId, previous, next, when)
        return {
          type: 'conversation.status_changed',
          id: createId('event'),
          timestamp: when.toISOString(),
          actor: { type: 'user' },
          data: { conversation: ref, previousStatus: previous, newStatus: next },
        } as unknown as EventData
      },
    })
  }
  return steps
}

/** A fresh conversation under the policy, applied at the start. */
async function seedConversation(policyId: Awaited<ReturnType<typeof createSlaPolicy>>['id']) {
  const customer = await seedPrincipal()
  const agent = await seedPrincipal()
  const [row] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: customer, channel: 'messenger' })
    .returning()
  const conversationId = row.id as ConversationId
  await applySlaToConversation(conversationId, policyId, new Date(START))
  return { conversationId, customer, agent }
}

/** What the SLA left on a conversation: its stamp's clock fields and the clock events logged. */
async function conversationOutcome(conversationId: ConversationId) {
  const [row] = await testDb
    .select({ slaApplied: conversations.slaApplied })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  const stamp = row.slaApplied as Record<string, unknown>
  const fields = [
    'appliedAt',
    'firstResponseDueAt',
    'firstResponseAt',
    'firstResponseBreachedAt',
    'nextResponseCycleAt',
    'nextResponseDueAt',
    'nextResponseAt',
    'nextResponseBreachedAt',
    'timeToCloseDueAt',
    'resolvedAt',
    'resolutionBreachedAt',
    'pausedAt',
  ]
  const events = await testDb
    .select({ kind: slaEvents.kind, meta: slaEvents.meta })
    .from(slaEvents)
    .where(eq(slaEvents.conversationId, conversationId))
  return {
    stamp: comparable(stamp, fields),
    events: clockEvents(
      events as { kind: string; meta: Record<string, unknown> }[],
      Date.parse(stamp.appliedAt as string)
    ),
  }
}

// --- tickets -----------------------------------------------------------------

type TicketCategory = 'open' | 'pending' | 'closed'

/** A ticket timeline from `seed`, written against the ticket. */
function ticketTimeline(
  seed: number,
  target: { ticketId: TicketId; statuses: Record<string, TicketStatusId> },
  policyId: Awaited<ReturnType<typeof createSlaPolicy>>['id']
): Step[] {
  const rng = random(seed)
  const steps: Step[] = []
  let category: TicketCategory = 'open'
  let pendingStatus = 'pendingA'
  let at = START
  let reapplied = 0
  const count = rng.int(8, 14)
  for (let i = 0; i < count; i++) {
    at += rng.int(3, 50) * MINUTE
    const when = new Date(at)
    const weights: Partial<Record<string, number>> = {}
    if (category === 'open') Object.assign(weights, { pending: 3, close: 1 })
    if (category === 'pending') Object.assign(weights, { lateral: 1, leave: 2, close: 1 })
    if (category === 'closed') Object.assign(weights, { reopen: 2 })
    if (reapplied < 1 && category !== 'closed') weights.reapply = 0.5
    const action = rng.weighted(weights)

    if (action === 'reapply') {
      reapplied++
      steps.push({
        label: `${when.toISOString()} reapply`,
        write: async () => {
          await applySlaToTicket(target.ticketId, policyId, when)
          return null
        },
      })
      continue
    }
    const previous = category
    let statusKey: string
    if (action === 'pending' || action === 'lateral') {
      pendingStatus =
        action === 'lateral' ? (pendingStatus === 'pendingA' ? 'pendingB' : 'pendingA') : 'pendingA'
      statusKey = pendingStatus
      category = 'pending'
    } else if (action === 'close') {
      statusKey = 'closed'
      category = 'closed'
    } else {
      statusKey = 'open'
      category = 'open'
    }
    const next = category
    steps.push({
      label: `${when.toISOString()} ${action} (${previous} -> ${next})`,
      write: async () => {
        await testDb
          .update(tickets)
          .set({ statusId: target.statuses[statusKey] })
          .where(eq(tickets.id, target.ticketId))
        await recordStatusChange('ticket', target.ticketId, previous, next, when)
        return {
          type: 'ticket.status_changed',
          id: createId('event'),
          timestamp: when.toISOString(),
          actor: { type: 'user' },
          data: { ticket: { id: target.ticketId }, previousStatus: previous, newStatus: next },
        } as unknown as EventData
      },
    })
  }
  return steps
}

async function seedTicketStatuses() {
  const rows = await testDb
    .insert(ticketStatuses)
    .values(
      [
        ['open', 'open'],
        ['pendingA', 'pending'],
        ['pendingB', 'pending'],
        ['closed', 'closed'],
      ].map(([key, category]) => ({
        name: `${key} ${suffix()}`,
        slug: `${key}_${suffix()}`,
        category: category as TicketCategory,
      }))
    )
    .returning()
  return {
    open: rows[0].id as TicketStatusId,
    pendingA: rows[1].id as TicketStatusId,
    pendingB: rows[2].id as TicketStatusId,
    closed: rows[3].id as TicketStatusId,
  }
}

async function seedTicket(
  statuses: Record<string, TicketStatusId>,
  policyId: Awaited<ReturnType<typeof createSlaPolicy>>['id']
) {
  const [row] = await testDb
    .insert(tickets)
    .values({ type: 'customer', title: `Ticket ${suffix()}`, statusId: statuses.open })
    .returning()
  const ticketId = row.id as TicketId
  await applySlaToTicket(ticketId, policyId, new Date(START))
  return { ticketId, statuses }
}

async function ticketOutcome(ticketId: TicketId) {
  const [row] = await testDb
    .select({ slaApplied: tickets.slaApplied })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
  const stamp = row.slaApplied as Record<string, unknown>
  const fields = [
    'appliedAt',
    'timeToResolveDueAt',
    'resolvedAt',
    'resolutionBreachedAt',
    'pausedAt',
  ]
  const events = await testDb
    .select({ kind: slaEvents.kind, meta: slaEvents.meta })
    .from(slaEvents)
    .where(eq(slaEvents.ticketId, ticketId))
  return {
    stamp: comparable(stamp, fields),
    events: clockEvents(
      events as { kind: string; meta: Record<string, unknown> }[],
      Date.parse(stamp.appliedAt as string)
    ),
  }
}

describe.skipIf(!fixture.available)('SLA reactions in any order reach the in-order outcome', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  it.each(CONVERSATION_SCENARIOS)('a conversation timeline (scenario %i)', async (scenario) => {
    const policy = await createSlaPolicy({
      name: `All clocks ${suffix()}`,
      firstResponseTargetSecs: 3600,
      nextResponseTargetSecs: 2 * 3600,
      timeToCloseTargetSecs: 6 * 3600,
      pauseOnSnooze: true,
    })
    const inOrder = await seedConversation(policy.id)
    const steps = conversationTimeline(scenario, inOrder, policy.id)
    await runTimeline(steps, null)
    const expected = await conversationOutcome(inOrder.conversationId)

    for (let schedule = 0; schedule < SCHEDULES; schedule++) {
      const target = await seedConversation(policy.id)
      await runTimeline(
        conversationTimeline(scenario, target, policy.id),
        random(scheduleSeed(scenario, schedule))
      )
      expect(
        await conversationOutcome(target.conversationId),
        failure(scenario, schedule, steps)
      ).toEqual(expected)
    }
  })

  it.each(TICKET_SCENARIOS)('a ticket timeline (scenario %i)', async (scenario) => {
    const policy = await createSlaPolicy({
      name: `TTR ${suffix()}`,
      timeToResolveTargetSecs: 6 * 3600,
      pauseOnPending: true,
    })
    const statuses = await seedTicketStatuses()
    const inOrder = await seedTicket(statuses, policy.id)
    const steps = ticketTimeline(scenario, inOrder, policy.id)
    await runTimeline(steps, null)
    const expected = await ticketOutcome(inOrder.ticketId)

    for (let schedule = 0; schedule < SCHEDULES; schedule++) {
      const target = await seedTicket(statuses, policy.id)
      await runTimeline(
        ticketTimeline(scenario, target, policy.id),
        random(scheduleSeed(scenario, schedule))
      )
      expect(await ticketOutcome(target.ticketId), failure(scenario, schedule, steps)).toEqual(
        expected
      )
    }
  })
})
