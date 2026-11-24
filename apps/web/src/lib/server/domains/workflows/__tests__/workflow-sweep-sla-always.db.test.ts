/**
 * SLA warning and breach events fire whether or not any workflow listens
 * (SLA-23). The events feed the SLA emails and the `sla.approaching_breach` /
 * `sla.breached` webhooks as well as workflows, so the 5-minute timer sweep
 * must scan and dispatch on every tick, using DEFAULT_BREACH_LEAD_MINUTES as
 * the warning lead unless a live workflow asks for a wider one.
 *
 * Runs the REAL scan (sla.sweep.ts), the REAL dispatch pipeline (dispatch.ts ->
 * process.ts -> outbox-dispatch.ts -> emit.ts) and the REAL fire-once claim on
 * a rolled-back database, and asserts on the durable `events` rows the
 * pipeline writes: the same rows the webhook relay, the email reaction and the
 * workflow reaction all read.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type PrincipalId, type UserId, type ConversationId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, events, user, principal, workflows, eq, and, sql } from '@/lib/server/db'
import type { WorkflowGraph } from '../graph'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/domains/settings/settings.office-hours', () => ({
  getOfficeHoursSchedule: vi.fn(async () => ({ enabled: false, timezone: 'UTC', intervals: [] })),
}))

import { createSlaPolicy } from '@/lib/server/domains/sla/sla-policy.service'
import { applySlaToConversation } from '@/lib/server/domains/sla/sla.service'
import { createWorkflow, setWorkflowStatus } from '../workflow.service'
import { kvDel, kvSet } from '@/lib/server/kv/pg-kv'
import { SLA_BREACH_EVENTS_SINCE_KEY, sweepSlaTimerTriggers } from '../workflow-sweep'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db.select({ id: events.id }).from(events).limit(0)
    await db.select({ id: workflows.id }).from(workflows).limit(0)
  },
})
afterAll(() => fixture.close())

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const emptyGraph: WorkflowGraph = { nodes: [], edges: [] }

async function seedConversation(): Promise<ConversationId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Visitor-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  const [row] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: principalId, channel: 'messenger' })
    .returning()
  return row.id
}

/** A conversation under a one-hour first-response SLA applied at 10:00, so
 *  its first-response clock is due at 11:00. */
async function seedDueAtEleven(): Promise<ConversationId> {
  const conversationId = await seedConversation()
  const policy = await createSlaPolicy({ name: `FR ${suffix()}`, firstResponseTargetSecs: 3600 })
  await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
  return conversationId
}

async function seedLiveWorkflow(triggerType: string, triggerSettings: Record<string, unknown>) {
  const wf = await createWorkflow({
    name: `sla always test ${suffix()}`,
    class: 'background',
    triggerType,
    triggerSettings,
    graph: emptyGraph,
  })
  return setWorkflowStatus(wf.id, 'live')
}

/** The durable events the dispatch pipeline wrote for one conversation. */
async function slaEventsFor(conversationId: ConversationId, type: string) {
  return testDb
    .select({ type: events.type, payload: events.payload })
    .from(events)
    .where(
      and(eq(events.type, type), sql`${events.payload} ->> 'conversationId' = ${conversationId}`)
    )
}

describe.skipIf(!fixture.available)('SLA timer events fire without a workflow (real DB)', () => {
  // A workspace long past its first tick on this build: breaches fire as they
  // happen. The first tick itself is covered below.
  beforeEach(async () => {
    await fixture.begin()
    await kvSet(SLA_BREACH_EVENTS_SINCE_KEY, '2025-01-01T00:00:00.000Z', 3600)
  })
  afterEach(fixture.rollback)

  it('fires the warning once at the default 15-minute lead when no workflow listens', async () => {
    const conversationId = await seedDueAtEleven()

    // 10:40 is 20 minutes out: outside the default lead.
    await sweepSlaTimerTriggers(new Date('2026-01-05T10:40:00Z'))
    expect(await slaEventsFor(conversationId, 'sla.approaching_breach')).toHaveLength(0)

    // 10:50 is 10 minutes out: inside it.
    await sweepSlaTimerTriggers(new Date('2026-01-05T10:50:00Z'))
    const warned = await slaEventsFor(conversationId, 'sla.approaching_breach')
    expect(warned).toHaveLength(1)
    expect(warned[0].payload).toMatchObject({
      conversationId,
      clock: 'first_response',
      dueAt: '2026-01-05T11:00:00.000Z',
    })

    // Later ticks inside the window never fire it again.
    await sweepSlaTimerTriggers(new Date('2026-01-05T10:55:00Z'))
    expect(await slaEventsFor(conversationId, 'sla.approaching_breach')).toHaveLength(1)
  })

  it('fires the breach once when no workflow listens', async () => {
    const conversationId = await seedDueAtEleven()

    await sweepSlaTimerTriggers(new Date('2026-01-05T11:05:00Z'))
    const breached = await slaEventsFor(conversationId, 'sla.breached')
    expect(breached).toHaveLength(1)
    expect(breached[0].payload).toMatchObject({ conversationId, clock: 'first_response' })

    await sweepSlaTimerTriggers(new Date('2026-01-05T11:10:00Z'))
    expect(await slaEventsFor(conversationId, 'sla.breached')).toHaveLength(1)
  })

  it('a workflow can widen the warning lead, and the event still fires only once', async () => {
    const conversationId = await seedDueAtEleven()
    await seedLiveWorkflow('sla.approaching_breach', { breachLeadMinutes: 30 })

    // 10:35 is 25 minutes out: inside the workflow's 30-minute lead.
    await sweepSlaTimerTriggers(new Date('2026-01-05T10:35:00Z'))
    expect(await slaEventsFor(conversationId, 'sla.approaching_breach')).toHaveLength(1)

    await sweepSlaTimerTriggers(new Date('2026-01-05T10:50:00Z'))
    expect(await slaEventsFor(conversationId, 'sla.approaching_breach')).toHaveLength(1)
  })

  it('a workflow cannot narrow the warning below the default lead', async () => {
    const conversationId = await seedDueAtEleven()
    await seedLiveWorkflow('sla.approaching_breach', { breachLeadMinutes: 5 })

    // 10 minutes out: inside the default 15 even though the workflow asked for 5.
    await sweepSlaTimerTriggers(new Date('2026-01-05T10:50:00Z'))
    expect(await slaEventsFor(conversationId, 'sla.approaching_breach')).toHaveLength(1)
  })

  it('a workflow on the breach trigger shares the one breach event', async () => {
    const conversationId = await seedDueAtEleven()
    await seedLiveWorkflow('sla.breached', {})

    await sweepSlaTimerTriggers(new Date('2026-01-05T11:05:00Z'))
    await sweepSlaTimerTriggers(new Date('2026-01-05T11:10:00Z'))
    expect(await slaEventsFor(conversationId, 'sla.breached')).toHaveLength(1)
  })

  it('does not fire for a breach older than a day (no backlog of old alerts)', async () => {
    const conversationId = await seedDueAtEleven()
    // A listening workflow, so the scan certainly runs: the bound under test
    // is the due-date lookback, not whether anyone listens.
    await seedLiveWorkflow('sla.breached', {})

    // Due 11:00 on the 5th; the first sweep to look runs two days later.
    await sweepSlaTimerTriggers(new Date('2026-01-07T11:05:00Z'))
    expect(await slaEventsFor(conversationId, 'sla.breached')).toHaveLength(0)
  })

  it('on its first tick after the upgrade, fires no backlog of breaches, then fires new ones', async () => {
    // The upgrade: this build has never ticked here, and no clock carries a
    // fire-once marker because the old build only fired for a listening workflow.
    await kvDel(SLA_BREACH_EVENTS_SINCE_KEY)
    const backlog = await seedDueAtEleven()

    // The first tick, five minutes after the 11:00 breach: nothing fires.
    await sweepSlaTimerTriggers(new Date('2026-01-05T11:05:00Z'))
    await sweepSlaTimerTriggers(new Date('2026-01-05T11:10:00Z'))
    expect(await slaEventsFor(backlog, 'sla.breached')).toHaveLength(0)

    // A clock that breaches after that first tick fires as usual.
    const fresh = await seedConversation()
    const policy = await createSlaPolicy({ name: `FR ${suffix()}`, firstResponseTargetSecs: 3600 })
    await applySlaToConversation(fresh, policy.id, new Date('2026-01-05T11:00:00Z'))
    await sweepSlaTimerTriggers(new Date('2026-01-05T12:05:00Z'))
    expect(await slaEventsFor(fresh, 'sla.breached')).toHaveLength(1)
    expect(await slaEventsFor(backlog, 'sla.breached')).toHaveLength(0)
  })
})
