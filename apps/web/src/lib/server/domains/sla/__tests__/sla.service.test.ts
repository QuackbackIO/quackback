/**
 * Real-DB coverage for Apply-SLA (support platform §4.6): applying a policy
 * computes office-hours-aware deadlines, stamps `conversations.sla_applied`, and
 * logs an 'applied' event. A pinned office-hours schedule is honored; re-applying
 * replaces the active SLA. Runs inside the db-test-fixture rollback transaction.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type PrincipalId, type UserId, type ConversationId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  slaEvents,
  officeHoursSchedules,
  user,
  principal,
  eq,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// The workspace office-hours schedule (settings blob) resolveScheduleFor falls
// back to when a policy pins no table schedule. Mutable per test; the default
// (disabled) is 24/7.
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

import { createSlaPolicy, softDeleteSlaPolicy } from '../sla-policy.service'
import {
  applySlaToConversation,
  recordFirstResponse,
  recordNextResponse,
  rearmNextResponse,
  recordResolution,
  pauseSlaOnSnooze,
  resumeSlaFromSnooze,
} from '../sla.service'
import { sweepOverdueSlaBreaches } from '../sla.sweep'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db.select({ id: slaEvents.id }).from(slaEvents).limit(0)
  },
})

// One close for the whole file — the fixture (and testDb) is a single
// module-level connection shared by every describe block below
// (createDbTestFixture enforces one fixture per test file), and closing it
// from inside a describe would tear the connection down before a later
// sibling's beforeEach(fixture.begin) runs.
afterAll(() => fixture.close())

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/** Seed a visitor principal + a conversation it owns; return the conversation id. */
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

describe.skipIf(!fixture.available)('applySlaToConversation (real DB, rolled back)', () => {
  beforeEach(() => {
    workspaceHours.schedule = { enabled: false, timezone: 'UTC', intervals: [] }
    return fixture.begin()
  })
  afterEach(fixture.rollback)

  it('stamps 24/7 wall-clock deadlines + logs an applied event', async () => {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({
      name: 'Priority',
      firstResponseTargetSecs: 3600, // 1h
      timeToCloseTargetSecs: 4 * 3600, // 4h
    })
    const at = new Date('2026-01-05T10:00:00Z')

    const applied = await applySlaToConversation(conversationId, policy.id, at)

    // No workspace schedule -> 24/7 -> plain wall-clock from `at`.
    expect(applied.firstResponseDueAt).toBe('2026-01-05T11:00:00.000Z')
    expect(applied.timeToCloseDueAt).toBe('2026-01-05T14:00:00.000Z')
    expect(applied.policyName).toBe('Priority')

    // Stamped on the row.
    const [conv] = await testDb
      .select({ slaApplied: conversations.slaApplied })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
    expect((conv.slaApplied as { policyId: string }).policyId).toBe(policy.id)

    // Timeline opened.
    const events = await testDb
      .select()
      .from(slaEvents)
      .where(eq(slaEvents.conversationId, conversationId))
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('applied')
    expect(events[0].policyId).toBe(policy.id)
  })

  it('honors a policy-pinned office-hours schedule (deadline skips closed time)', async () => {
    const conversationId = await seedConversation()
    // Mon-Fri 09:00-17:00 UTC (8h/day). 2026-01-05 is a Monday.
    const [schedule] = await testDb
      .insert(officeHoursSchedules)
      .values({
        name: 'Biz',
        timezone: 'UTC',
        intervals: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' })),
      })
      .returning()
    const policy = await createSlaPolicy({
      name: 'Biz-hours',
      firstResponseTargetSecs: 8 * 3600, // a full working day
      officeHoursScheduleId: schedule.id,
    })

    // Mon 10:00 + 8 open hours: 7h left today (10->17) + 1h Tue from 09:00 -> Tue 10:00.
    const applied = await applySlaToConversation(
      conversationId,
      policy.id,
      new Date('2026-01-05T10:00:00Z')
    )
    expect(applied.firstResponseDueAt).toBe('2026-01-06T10:00:00.000Z')
    expect(applied.timeToCloseDueAt).toBeNull() // untracked by this policy
  })

  it('honors the workspace settings-blob schedule when the policy pins none', async () => {
    const conversationId = await seedConversation()
    // Mon-Fri 09:00-17:00 UTC in the settings blob (the canonical hours source).
    workspaceHours.schedule = {
      enabled: true,
      timezone: 'UTC',
      intervals: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' })),
    }
    const policy = await createSlaPolicy({
      name: 'Workspace-hours',
      firstResponseTargetSecs: 2 * 3600,
    })

    // Fri 2026-01-09 16:00 + 2 open hours: 1h Fri (16->17), weekend closed,
    // 1h Mon from 09:00 -> Mon 10:00 (NOT Fri 18:00).
    const applied = await applySlaToConversation(
      conversationId,
      policy.id,
      new Date('2026-01-09T16:00:00Z')
    )
    expect(applied.firstResponseDueAt).toBe('2026-01-12T10:00:00.000Z')
  })

  it('re-applying replaces the active SLA (one per conversation)', async () => {
    const conversationId = await seedConversation()
    const a = await createSlaPolicy({ name: 'A', firstResponseTargetSecs: 3600 })
    const b = await createSlaPolicy({ name: 'B', firstResponseTargetSecs: 7200 })

    await applySlaToConversation(conversationId, a.id, new Date('2026-01-05T10:00:00Z'))
    const applied = await applySlaToConversation(
      conversationId,
      b.id,
      new Date('2026-01-05T10:00:00Z')
    )

    // The stamp reflects B, not A.
    expect(applied.policyId).toBe(b.id)
    expect(applied.firstResponseDueAt).toBe('2026-01-05T12:00:00.000Z')
    const [conv] = await testDb
      .select({ slaApplied: conversations.slaApplied })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
    expect((conv.slaApplied as { policyId: string }).policyId).toBe(b.id)

    // Both applications are on the timeline.
    const events = await testDb
      .select()
      .from(slaEvents)
      .where(eq(slaEvents.conversationId, conversationId))
    expect(events).toHaveLength(2)
  })

  it('records a met first response inside the deadline (idempotent)', async () => {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // Reply at 10:30, due 11:00 -> met.
    await recordFirstResponse(conversationId, new Date('2026-01-05T10:30:00Z'))
    // A second reply must not double-count.
    await recordFirstResponse(conversationId, new Date('2026-01-05T10:45:00Z'))

    const events = await testDb
      .select()
      .from(slaEvents)
      .where(eq(slaEvents.conversationId, conversationId))
    const fr = events.filter((e) => e.kind.startsWith('first_response'))
    expect(fr).toHaveLength(1)
    expect(fr[0].kind).toBe('first_response_met')
    expect(fr[0].meta.overdueSecs).toBe(0)

    const [conv] = await testDb
      .select({ slaApplied: conversations.slaApplied })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
    expect((conv.slaApplied as { firstResponseAt: string }).firstResponseAt).toBe(
      '2026-01-05T10:30:00.000Z'
    )
  })

  it('records a breached first response with the overdue seconds', async () => {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // Reply at 11:10, due 11:00 -> breached by 600s.
    await recordFirstResponse(conversationId, new Date('2026-01-05T11:10:00Z'))
    const events = await testDb
      .select()
      .from(slaEvents)
      .where(eq(slaEvents.conversationId, conversationId))
    const fr = events.find((e) => e.kind.startsWith('first_response'))
    expect(fr?.kind).toBe('first_response_breached')
    expect(fr?.meta.overdueSecs).toBe(600)
  })

  it('records resolution against time-to-close, and is a no-op without an SLA', async () => {
    const withSla = await seedConversation()
    const policy = await createSlaPolicy({ name: 'Close', timeToCloseTargetSecs: 4 * 3600 })
    await applySlaToConversation(withSla, policy.id, new Date('2026-01-05T10:00:00Z'))
    // Resolved at 15:00, due 14:00 -> breached by 3600s.
    await recordResolution(withSla, new Date('2026-01-05T15:00:00Z'))
    const resEvents = await testDb
      .select()
      .from(slaEvents)
      .where(eq(slaEvents.conversationId, withSla))
    expect(resEvents.find((e) => e.kind.startsWith('resolution'))?.kind).toBe('resolution_breached')

    // A conversation with no SLA applied -> both recorders are silent no-ops.
    const noSla = await seedConversation()
    await recordFirstResponse(noSla, new Date('2026-01-05T10:00:00Z'))
    await recordResolution(noSla, new Date('2026-01-05T10:00:00Z'))
    const none = await testDb.select().from(slaEvents).where(eq(slaEvents.conversationId, noSla))
    expect(none).toHaveLength(0)
  })
})

describe.skipIf(!fixture.available)('pause-on-snooze (real DB, rolled back)', () => {
  beforeEach(() => {
    workspaceHours.schedule = { enabled: false, timezone: 'UTC', intervals: [] }
    return fixture.begin()
  })
  afterEach(fixture.rollback)

  async function loadApplied(conversationId: ConversationId): Promise<{
    firstResponseDueAt: string | null
    timeToCloseDueAt: string | null
    pausedAt: string | null | undefined
    firstResponseAt?: string | null
    resolvedAt?: string | null
  }> {
    const [conv] = await testDb
      .select({ slaApplied: conversations.slaApplied })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
    return conv.slaApplied as unknown as {
      firstResponseDueAt: string | null
      timeToCloseDueAt: string | null
      pausedAt: string | null | undefined
      firstResponseAt?: string | null
      resolvedAt?: string | null
    }
  }

  it('snooze then unsnooze shifts firstResponseDueAt/timeToCloseDueAt by the paused duration', async () => {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({
      name: 'Pauseable',
      firstResponseTargetSecs: 3600, // due 11:00
      timeToCloseTargetSecs: 4 * 3600, // due 14:00
    })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

    await pauseSlaOnSnooze(conversationId, new Date('2026-01-05T10:10:00Z'))
    let applied = await loadApplied(conversationId)
    expect(applied.pausedAt).toBe('2026-01-05T10:10:00.000Z')
    // Deadlines untouched while paused.
    expect(applied.firstResponseDueAt).toBe('2026-01-05T11:00:00.000Z')
    expect(applied.timeToCloseDueAt).toBe('2026-01-05T14:00:00.000Z')

    // Paused for 30 minutes.
    await resumeSlaFromSnooze(conversationId, new Date('2026-01-05T10:40:00Z'))
    applied = await loadApplied(conversationId)
    expect(applied.pausedAt).toBeNull()
    expect(applied.firstResponseDueAt).toBe('2026-01-05T11:30:00.000Z')
    expect(applied.timeToCloseDueAt).toBe('2026-01-05T14:30:00.000Z')

    const events = await testDb
      .select()
      .from(slaEvents)
      .where(eq(slaEvents.conversationId, conversationId))
    expect(events.find((e) => e.kind === 'paused')).toBeTruthy()
    const resumed = events.find((e) => e.kind === 'resumed')
    expect(resumed?.meta.pausedForSecs).toBe(1800)
  })

  it('pauseOnSnooze=false leaves deadlines and pausedAt untouched', async () => {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({
      name: 'NoPause',
      firstResponseTargetSecs: 3600,
      timeToCloseTargetSecs: 4 * 3600,
      pauseOnSnooze: false,
    })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

    await pauseSlaOnSnooze(conversationId, new Date('2026-01-05T10:10:00Z'))
    let applied = await loadApplied(conversationId)
    expect(applied.pausedAt).toBeFalsy()
    expect(applied.firstResponseDueAt).toBe('2026-01-05T11:00:00.000Z')
    expect(applied.timeToCloseDueAt).toBe('2026-01-05T14:00:00.000Z')

    // Resume is also a no-op since nothing was paused.
    await resumeSlaFromSnooze(conversationId, new Date('2026-01-05T10:40:00Z'))
    applied = await loadApplied(conversationId)
    expect(applied.firstResponseDueAt).toBe('2026-01-05T11:00:00.000Z')
    expect(applied.timeToCloseDueAt).toBe('2026-01-05T14:00:00.000Z')

    const events = await testDb
      .select()
      .from(slaEvents)
      .where(eq(slaEvents.conversationId, conversationId))
    expect(events.some((e) => e.kind === 'paused' || e.kind === 'resumed')).toBe(false)
  })

  it('settle-while-snoozed excludes the elapsed pause up to the settle moment', async () => {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({ name: 'MidPause', firstResponseTargetSecs: 3600 }) // due 11:00
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // Snoozed at 10:10, still snoozed when the teammate replies at 11:20.
    await pauseSlaOnSnooze(conversationId, new Date('2026-01-05T10:10:00Z'))
    // Elapsed pause so far: 11:20 - 10:10 = 70 min. Effective due = 11:00 + 70min = 12:10.
    // A reply at 11:20 is inside that shifted deadline -> met, not breached.
    await recordFirstResponse(conversationId, new Date('2026-01-05T11:20:00Z'))

    const events = await testDb
      .select()
      .from(slaEvents)
      .where(eq(slaEvents.conversationId, conversationId))
    const fr = events.find((e) => e.kind.startsWith('first_response'))
    expect(fr?.kind).toBe('first_response_met')
    expect(fr?.meta.overdueSecs).toBe(0)
    expect(fr?.meta.dueAt).toBe('2026-01-05T12:10:00.000Z')

    // Still snoozed: pausedAt survives the settle, and the outcome is stamped.
    const applied = await loadApplied(conversationId)
    expect(applied.pausedAt).toBe('2026-01-05T10:10:00.000Z')
    expect(applied.firstResponseAt).toBe('2026-01-05T11:20:00.000Z')
  })

  it('double-snooze/unsnooze cycles accumulate the shift', async () => {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({
      name: 'DoubleCycle',
      firstResponseTargetSecs: 3600, // due 11:00
      timeToCloseTargetSecs: 4 * 3600, // due 14:00
    })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // Cycle 1: paused 10 minutes.
    await pauseSlaOnSnooze(conversationId, new Date('2026-01-05T10:10:00Z'))
    await resumeSlaFromSnooze(conversationId, new Date('2026-01-05T10:20:00Z'))
    // Cycle 2: paused 30 minutes.
    await pauseSlaOnSnooze(conversationId, new Date('2026-01-05T11:00:00Z'))
    await resumeSlaFromSnooze(conversationId, new Date('2026-01-05T11:30:00Z'))

    const applied = await loadApplied(conversationId)
    // Cumulative shift: 10 + 30 = 40 minutes.
    expect(applied.firstResponseDueAt).toBe('2026-01-05T11:40:00.000Z')
    expect(applied.timeToCloseDueAt).toBe('2026-01-05T14:40:00.000Z')
    expect(applied.pausedAt).toBeNull()

    const events = await testDb
      .select()
      .from(slaEvents)
      .where(eq(slaEvents.conversationId, conversationId))
    expect(events.filter((e) => e.kind === 'paused')).toHaveLength(2)
    expect(events.filter((e) => e.kind === 'resumed')).toHaveLength(2)
  })

  it('is a no-op when no SLA is applied', async () => {
    const conversationId = await seedConversation()
    await pauseSlaOnSnooze(conversationId, new Date('2026-01-05T10:10:00Z'))
    await resumeSlaFromSnooze(conversationId, new Date('2026-01-05T10:40:00Z'))
    const events = await testDb
      .select()
      .from(slaEvents)
      .where(eq(slaEvents.conversationId, conversationId))
    expect(events).toHaveLength(0)
    const [conv] = await testDb
      .select({ slaApplied: conversations.slaApplied })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
    expect(conv.slaApplied).toBeNull()
  })
})

describe.skipIf(!fixture.available)('sweepOverdueSlaBreaches (real DB, rolled back)', () => {
  beforeEach(() => {
    workspaceHours.schedule = { enabled: false, timezone: 'UTC', intervals: [] }
    return fixture.begin()
  })
  afterEach(fixture.rollback)

  const eventsFor = async (conversationId: ConversationId) =>
    testDb.select().from(slaEvents).where(eq(slaEvents.conversationId, conversationId))

  it('records an overdue, unanswered first response exactly once (a repeat sweep is a no-op)', async () => {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // Due 11:00, no reply. Sweep at 11:05 -> one breach event.
    const first = await sweepOverdueSlaBreaches(new Date('2026-01-05T11:05:00Z'))
    expect(first.recorded).toBe(1)
    let events = (await eventsFor(conversationId)).filter((e) => e.kind !== 'applied')
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('first_response_breached')
    expect(events[0].meta.overdueSecs).toBe(300)

    // Sweeping again (and again later) must not duplicate the event.
    expect((await sweepOverdueSlaBreaches(new Date('2026-01-05T11:06:00Z'))).recorded).toBe(0)
    expect((await sweepOverdueSlaBreaches(new Date('2026-01-05T12:00:00Z'))).recorded).toBe(0)
    events = (await eventsFor(conversationId)).filter((e) => e.kind !== 'applied')
    expect(events).toHaveLength(1)
  })

  it('leaves not-yet-due and settled clocks untouched', async () => {
    const notDue = await seedConversation()
    const met = await seedConversation()
    const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
    await applySlaToConversation(notDue, policy.id, new Date('2026-01-05T10:00:00Z'))
    await applySlaToConversation(met, policy.id, new Date('2026-01-05T10:00:00Z'))
    // The second conversation got its reply in time.
    await recordFirstResponse(met, new Date('2026-01-05T10:30:00Z'))

    // Sweep before the first deadline -> nothing.
    expect((await sweepOverdueSlaBreaches(new Date('2026-01-05T10:45:00Z'))).recorded).toBe(0)
    // Sweep after it -> only the unanswered one breaches.
    expect((await sweepOverdueSlaBreaches(new Date('2026-01-05T11:30:00Z'))).recorded).toBe(1)
    const metEvents = (await eventsFor(met)).map((e) => e.kind)
    expect(metEvents.sort()).toEqual(['applied', 'first_response_met'])
  })

  it('still breaches a snoozed conversation whose policy opted out of pausing', async () => {
    // 'snoozed' status alone does not stop a clock — only a stamped pause
    // (pausedAt) does, and a pauseOnSnooze: false policy never stamps one.
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({
      name: 'NoPause',
      firstResponseTargetSecs: 3600,
      pauseOnSnooze: false,
    })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
    await pauseSlaOnSnooze(conversationId, new Date('2026-01-05T10:10:00Z')) // no-op: opted out
    await testDb
      .update(conversations)
      .set({ status: 'snoozed' })
      .where(eq(conversations.id, conversationId))

    expect((await sweepOverdueSlaBreaches(new Date('2026-01-05T11:05:00Z'))).recorded).toBe(1)
    const kinds = (await eventsFor(conversationId)).map((e) => e.kind)
    expect(kinds).toContain('first_response_breached')
  })

  it('does not breach a clock that is currently paused', async () => {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({ name: 'Paused', firstResponseTargetSecs: 3600 })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
    // Snoozed at 10:30 under the default pauseOnSnooze policy: clock stopped.
    await pauseSlaOnSnooze(conversationId, new Date('2026-01-05T10:30:00Z'))

    // The stamped due date (11:00) has passed, but the clock is paused.
    expect((await sweepOverdueSlaBreaches(new Date('2026-01-05T11:05:00Z'))).recorded).toBe(0)
    expect((await sweepOverdueSlaBreaches(new Date('2026-01-06T10:00:00Z'))).recorded).toBe(0)
    const kinds = (await eventsFor(conversationId)).map((e) => e.kind)
    expect(kinds).toEqual(['applied', 'paused'])
    // And the stamp gained no breach-noted marker.
    const [conv] = await testDb
      .select({ slaApplied: conversations.slaApplied })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
    expect(
      (conv.slaApplied as { firstResponseBreachedAt?: string }).firstResponseBreachedAt
    ).toBeUndefined()
  })

  it('after a resume, breaches against the pause-shifted deadline, not the original one', async () => {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({ name: 'Shifted', firstResponseTargetSecs: 3600 })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
    // Paused 10:30 -> 11:30 (1h): due shifts from 11:00 to 12:00 on resume.
    await pauseSlaOnSnooze(conversationId, new Date('2026-01-05T10:30:00Z'))
    await resumeSlaFromSnooze(conversationId, new Date('2026-01-05T11:30:00Z'))

    // Past the original 11:00 but inside the shifted 12:00 -> not a breach.
    expect((await sweepOverdueSlaBreaches(new Date('2026-01-05T11:45:00Z'))).recorded).toBe(0)
    // Past the shifted deadline -> breaches, judged against 12:00.
    expect((await sweepOverdueSlaBreaches(new Date('2026-01-05T12:05:00Z'))).recorded).toBe(1)
    const breach = (await eventsFor(conversationId)).find(
      (e) => e.kind === 'first_response_breached'
    )
    expect(breach?.meta.dueAt).toBe('2026-01-05T12:00:00.000Z')
    expect(breach?.meta.overdueSecs).toBe(300)
  })

  it('records both clocks once each when both are overdue', async () => {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({
      name: 'Both',
      firstResponseTargetSecs: 3600,
      timeToCloseTargetSecs: 2 * 3600,
    })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

    expect((await sweepOverdueSlaBreaches(new Date('2026-01-05T13:00:00Z'))).recorded).toBe(2)
    expect((await sweepOverdueSlaBreaches(new Date('2026-01-05T13:01:00Z'))).recorded).toBe(0)
    const kinds = (await eventsFor(conversationId))
      .map((e) => e.kind)
      .filter((k) => k !== 'applied')
      .sort()
    expect(kinds).toEqual(['first_response_breached', 'resolution_breached'])
  })

  it('a late reply after the sweep noted the breach settles the clock with no second BREACH event, but a settle-after-breach event', async () => {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
    await sweepOverdueSlaBreaches(new Date('2026-01-05T11:05:00Z'))

    await recordFirstResponse(conversationId, new Date('2026-01-05T11:30:00Z'))
    const events = (await eventsFor(conversationId)).filter((e) => e.kind !== 'applied')
    // The breach stays exactly-once; the late settle logs its own event with
    // the lag from due (11:00) to settle (11:30) for time-after-miss reporting.
    expect(events.map((e) => e.kind)).toEqual([
      'first_response_breached',
      'first_response_settled_after_breach',
    ])
    expect(events[1].meta.overdueSecs).toBe(1800)
    expect(events[1].meta.dueAt).toBe('2026-01-05T11:00:00.000Z')
    // The clock is settled, so nextSlaDue-style consumers stop counting.
    const [conv] = await testDb
      .select({ slaApplied: conversations.slaApplied })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
    expect((conv.slaApplied as { firstResponseAt: string }).firstResponseAt).toBe(
      '2026-01-05T11:30:00.000Z'
    )
  })

  it('a late close after the sweep noted the resolution breach logs resolution_settled_after_breach', async () => {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({ name: 'Close', timeToCloseTargetSecs: 4 * 3600 })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // Due 14:00, nobody closes. Sweep at 14:10 notes the breach.
    expect((await sweepOverdueSlaBreaches(new Date('2026-01-05T14:10:00Z'))).recorded).toBe(1)
    // Closed an hour late: the breach stays exactly-once, the settle logs its lag.
    await recordResolution(conversationId, new Date('2026-01-05T15:00:00Z'))
    const events = (await eventsFor(conversationId)).filter((e) => e.kind !== 'applied')
    expect(events.map((e) => e.kind)).toEqual([
      'resolution_breached',
      'resolution_settled_after_breach',
    ])
    expect(events[1].meta.overdueSecs).toBe(3600)
  })

  it('overlapping sweeps of the same overdue clock record exactly one event (atomic claim)', async () => {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // Both runs can scan the row before either writes; the guarded claim must
    // let only one of them log the breach.
    const [a, b] = await Promise.all([
      sweepOverdueSlaBreaches(new Date('2026-01-05T11:05:00Z')),
      sweepOverdueSlaBreaches(new Date('2026-01-05T11:05:30Z')),
    ])
    expect(a.recorded + b.recorded).toBe(1)
    const kinds = (await eventsFor(conversationId))
      .map((e) => e.kind)
      .filter((k) => k !== 'applied')
    expect(kinds).toEqual(['first_response_breached'])
  })

  it('a lazily recorded breach (late reply before any sweep) makes the sweep a no-op', async () => {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
    await recordFirstResponse(conversationId, new Date('2026-01-05T11:10:00Z'))

    expect((await sweepOverdueSlaBreaches(new Date('2026-01-05T11:15:00Z'))).recorded).toBe(0)
    const kinds = (await eventsFor(conversationId))
      .map((e) => e.kind)
      .filter((k) => k !== 'applied')
    expect(kinds).toEqual(['first_response_breached'])
  })
})

/**
 * The next-response clock (support platform §4.6): a visitor message (re-)arms
 * a cycle once the first-response clock has settled, a teammate reply settles
 * it, and the sweep covers a cycle nobody answers. Each fresh customer message
 * re-arms — new deadline, cleared settle + per-cycle markers — so every cycle
 * can breach/warn once of its own.
 */
describe.skipIf(!fixture.available)('next-response clock (real DB, rolled back)', () => {
  beforeEach(() => {
    workspaceHours.schedule = { enabled: false, timezone: 'UTC', intervals: [] }
    return fixture.begin()
  })
  afterEach(fixture.rollback)

  const eventsFor = async (conversationId: ConversationId) =>
    testDb.select().from(slaEvents).where(eq(slaEvents.conversationId, conversationId))

  const loadStamp = async (conversationId: ConversationId) => {
    const [conv] = await testDb
      .select({ slaApplied: conversations.slaApplied })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
    return conv.slaApplied as {
      nextResponseDueAt?: string | null
      nextResponseAt?: string | null
      nextResponseBreachedAt?: string | null
      nextResponseWarningFiredAt?: string | null
      nextResponseBreachTriggerFiredAt?: string | null
    }
  }

  /** Apply a FRT+NRT policy and settle the first response, so a cycle can arm. */
  async function seedWithSettledFirstResponse(): Promise<ConversationId> {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({
      name: 'FR+NR',
      firstResponseTargetSecs: 3600,
      nextResponseTargetSecs: 2 * 3600,
    })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
    await recordFirstResponse(conversationId, new Date('2026-01-05T10:30:00Z'))
    return conversationId
  }

  it('arms on a customer message after the first response and settles met on the reply (idempotent)', async () => {
    const conversationId = await seedWithSettledFirstResponse()

    // The customer follows up at 10:40: armed for 12:40 (24/7).
    await rearmNextResponse(conversationId, new Date('2026-01-05T10:40:00Z'))
    expect((await loadStamp(conversationId)).nextResponseDueAt).toBe('2026-01-05T12:40:00.000Z')

    // The teammate replies at 11:40 -> met. A second reply must not double-count.
    await recordNextResponse(conversationId, new Date('2026-01-05T11:40:00Z'))
    await recordNextResponse(conversationId, new Date('2026-01-05T11:50:00Z'))

    const nrt = (await eventsFor(conversationId)).filter((e) => e.kind.startsWith('next_response'))
    expect(nrt).toHaveLength(1)
    expect(nrt[0].kind).toBe('next_response_met')
    expect(nrt[0].meta.overdueSecs).toBe(0)
    expect(nrt[0].meta.dueAt).toBe('2026-01-05T12:40:00.000Z')
    expect((await loadStamp(conversationId)).nextResponseAt).toBe('2026-01-05T11:40:00.000Z')
  })

  it('never arms while the first-response clock is still open (no doubling), nor without a tracked target', async () => {
    // No first reply yet: the customer message must NOT arm a second clock.
    const waiting = await seedConversation()
    const policy = await createSlaPolicy({
      name: 'FR+NR',
      firstResponseTargetSecs: 3600,
      nextResponseTargetSecs: 2 * 3600,
    })
    await applySlaToConversation(waiting, policy.id, new Date('2026-01-05T10:00:00Z'))
    await rearmNextResponse(waiting, new Date('2026-01-05T10:10:00Z'))
    expect((await loadStamp(waiting)).nextResponseDueAt).toBeFalsy()

    // A policy without a next-response target never arms, even post-first-reply.
    const noNrt = await seedConversation()
    const frOnly = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
    await applySlaToConversation(noNrt, frOnly.id, new Date('2026-01-05T10:00:00Z'))
    await recordFirstResponse(noNrt, new Date('2026-01-05T10:30:00Z'))
    await rearmNextResponse(noNrt, new Date('2026-01-05T10:40:00Z'))
    await recordNextResponse(noNrt, new Date('2026-01-05T10:50:00Z'))
    expect((await loadStamp(noNrt)).nextResponseDueAt).toBeFalsy()
    const kinds = (await eventsFor(noNrt)).map((e) => e.kind)
    expect(kinds).toEqual(['applied', 'first_response_met'])
  })

  it('records a breached settle with the overdue seconds when the reply lands past the deadline', async () => {
    const conversationId = await seedWithSettledFirstResponse()
    await rearmNextResponse(conversationId, new Date('2026-01-05T10:40:00Z')) // due 12:40

    await recordNextResponse(conversationId, new Date('2026-01-05T12:50:00Z'))
    const nrt = (await eventsFor(conversationId)).filter((e) => e.kind.startsWith('next_response'))
    expect(nrt).toHaveLength(1)
    expect(nrt[0].kind).toBe('next_response_breached')
    expect(nrt[0].meta.overdueSecs).toBe(600)
    // The breach-noted marker keeps the sweep exactly-once.
    expect((await loadStamp(conversationId)).nextResponseBreachedAt).toBe(
      '2026-01-05T12:50:00.000Z'
    )
    expect((await sweepOverdueSlaBreaches(new Date('2026-01-05T13:00:00Z'))).recorded).toBe(0)
  })

  it('the sweep records an unanswered cycle exactly once; a late reply settles with next_response_settled_after_breach', async () => {
    const conversationId = await seedWithSettledFirstResponse()
    await rearmNextResponse(conversationId, new Date('2026-01-05T10:40:00Z')) // due 12:40

    // Due passes with no reply: one breach event, repeat sweeps are no-ops.
    expect((await sweepOverdueSlaBreaches(new Date('2026-01-05T12:45:00Z'))).recorded).toBe(1)
    expect((await sweepOverdueSlaBreaches(new Date('2026-01-05T12:50:00Z'))).recorded).toBe(0)

    await recordNextResponse(conversationId, new Date('2026-01-05T13:00:00Z'))
    const nrt = (await eventsFor(conversationId)).filter((e) => e.kind.startsWith('next_response'))
    expect(nrt.map((e) => e.kind)).toEqual([
      'next_response_breached',
      'next_response_settled_after_breach',
    ])
    // Lag from the (pause-adjusted) due 12:40 to the 13:00 settle.
    expect(nrt[1].meta.overdueSecs).toBe(1200)
    expect(nrt[1].meta.dueAt).toBe('2026-01-05T12:40:00.000Z')
    expect((await loadStamp(conversationId)).nextResponseAt).toBe('2026-01-05T13:00:00.000Z')
  })

  it('a fresh customer message re-arms: new deadline, cleared settle + per-cycle markers, and the new cycle can breach again', async () => {
    const conversationId = await seedWithSettledFirstResponse()
    await rearmNextResponse(conversationId, new Date('2026-01-05T10:40:00Z')) // due 12:40

    // Cycle 1 goes stale and breaches; the warning marker is stamped too.
    expect((await sweepOverdueSlaBreaches(new Date('2026-01-05T12:45:00Z'))).recorded).toBe(1)

    // The customer pings again at 12:50: a brand-new cycle (due 14:50).
    await rearmNextResponse(conversationId, new Date('2026-01-05T12:50:00Z'))
    const rearmed = await loadStamp(conversationId)
    expect(rearmed.nextResponseDueAt).toBe('2026-01-05T14:50:00.000Z')
    expect(rearmed.nextResponseAt).toBeNull()
    expect(rearmed.nextResponseBreachedAt).toBeNull()
    expect(rearmed.nextResponseWarningFiredAt).toBeNull()
    expect(rearmed.nextResponseBreachTriggerFiredAt).toBeNull()

    // Still inside cycle 1's (now replaced) deadline: no breach. Past the new
    // deadline: the new cycle breaches exactly once of its own.
    expect((await sweepOverdueSlaBreaches(new Date('2026-01-05T12:55:00Z'))).recorded).toBe(0)
    expect((await sweepOverdueSlaBreaches(new Date('2026-01-05T14:55:00Z'))).recorded).toBe(1)
    const breaches = (await eventsFor(conversationId)).filter(
      (e) => e.kind === 'next_response_breached'
    )
    expect(breaches).toHaveLength(2)
    expect(breaches[1].meta.dueAt).toBe('2026-01-05T14:50:00.000Z')
  })

  it('settle-while-paused excludes the elapsed pause, and resume shifts the armed deadline', async () => {
    const conversationId = await seedWithSettledFirstResponse()
    await rearmNextResponse(conversationId, new Date('2026-01-05T10:40:00Z')) // due 12:40

    // Snoozed at 12:00, still snoozed when the teammate replies at 12:50.
    // Elapsed pause 50min -> effective due 13:30 -> met, not breached.
    await pauseSlaOnSnooze(conversationId, new Date('2026-01-05T12:00:00Z'))
    await recordNextResponse(conversationId, new Date('2026-01-05T12:50:00Z'))
    const nrt = (await eventsFor(conversationId)).filter((e) => e.kind.startsWith('next_response'))
    expect(nrt).toHaveLength(1)
    expect(nrt[0].kind).toBe('next_response_met')
    expect(nrt[0].meta.dueAt).toBe('2026-01-05T13:30:00.000Z')

    // A settled cycle is left untouched by resume; an ARMED one shifts.
    const other = await seedWithSettledFirstResponse()
    await rearmNextResponse(other, new Date('2026-01-05T10:40:00Z')) // due 12:40
    await pauseSlaOnSnooze(other, new Date('2026-01-05T12:00:00Z'))
    await resumeSlaFromSnooze(other, new Date('2026-01-05T12:30:00Z'))
    expect((await loadStamp(other)).nextResponseDueAt).toBe('2026-01-05T13:10:00.000Z')
  })

  it('the armed deadline is office-hours aware (skips closed time)', async () => {
    // Mon-Fri 09:00-17:00 UTC in the settings blob (the canonical hours source).
    workspaceHours.schedule = {
      enabled: true,
      timezone: 'UTC',
      intervals: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' })),
    }
    const conversationId = await seedWithSettledFirstResponse()

    // Fri 2026-01-09 16:00 + 2 open hours: 1h Fri (16->17), weekend closed,
    // 1h Mon from 09:00 -> Mon 10:00 (NOT Fri 18:00).
    await rearmNextResponse(conversationId, new Date('2026-01-09T16:00:00Z'))
    expect((await loadStamp(conversationId)).nextResponseDueAt).toBe('2026-01-12T10:00:00.000Z')
  })
})

/**
 * Apply-while-paused (A6): an SLA applied onto a conversation that is ALREADY
 * snoozed starts its clock already paused when the policy pauses on snooze —
 * the snooze predated the apply, so no pause event will ever arrive for it.
 */
describe.skipIf(!fixture.available)(
  'applySlaToConversation on a snoozed conversation (real DB, rolled back)',
  () => {
    beforeEach(() => {
      workspaceHours.schedule = { enabled: false, timezone: 'UTC', intervals: [] }
      return fixture.begin()
    })
    afterEach(fixture.rollback)

    it('seeds pausedAt = appliedAt on a snoozed conversation under a pauseOnSnooze policy', async () => {
      const conversationId = await seedConversation()
      await testDb
        .update(conversations)
        .set({ status: 'snoozed' })
        .where(eq(conversations.id, conversationId))
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })

      const applied = await applySlaToConversation(
        conversationId,
        policy.id,
        new Date('2026-01-05T10:00:00Z')
      )
      expect(applied.pausedAt).toBe('2026-01-05T10:00:00.000Z')

      // A clock that starts paused never breaches while snoozed — the sweep
      // skips paused stamps even past the stamped deadline.
      expect((await sweepOverdueSlaBreaches(new Date('2026-01-05T12:00:00Z'))).recorded).toBe(0)
      // ...and leaving snooze resumes it (shifted by the paused span).
      await resumeSlaFromSnooze(conversationId, new Date('2026-01-05T10:30:00Z'))
      const [conv] = await testDb
        .select({ slaApplied: conversations.slaApplied })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
      const stamp = conv.slaApplied as { firstResponseDueAt: string; pausedAt?: string | null }
      expect(stamp.pausedAt).toBeNull()
      expect(stamp.firstResponseDueAt).toBe('2026-01-05T11:30:00.000Z')
    })

    it('does NOT seed pausedAt when the policy opted out of pause-on-snooze', async () => {
      const conversationId = await seedConversation()
      await testDb
        .update(conversations)
        .set({ status: 'snoozed' })
        .where(eq(conversations.id, conversationId))
      const policy = await createSlaPolicy({
        name: 'NoPause',
        firstResponseTargetSecs: 3600,
        pauseOnSnooze: false,
      })

      const applied = await applySlaToConversation(
        conversationId,
        policy.id,
        new Date('2026-01-05T10:00:00Z')
      )
      expect(applied.pausedAt).toBeFalsy()
    })
  }
)

/**
 * The stamp's schedule snapshot (A8): applySlaToConversation stores the
 * RESOLVED schedule on the stamp, and rearmNextResponse computes fresh cycle
 * deadlines from it — never from the live policy. An archived policy keeps
 * its armed clocks re-arming, and a mid-cycle schedule edit never moves a
 * running clock.
 */
describe.skipIf(!fixture.available)('schedule snapshot (real DB, rolled back)', () => {
  beforeEach(() => {
    workspaceHours.schedule = { enabled: false, timezone: 'UTC', intervals: [] }
    return fixture.begin()
  })
  afterEach(fixture.rollback)

  const loadStamp = async (conversationId: ConversationId) => {
    const [conv] = await testDb
      .select({ slaApplied: conversations.slaApplied })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
    return conv.slaApplied as {
      scheduleSnapshot?: { timezone: string; intervals: unknown[]; holidays?: unknown[] } | null
      nextResponseDueAt?: string | null
    }
  }

  /** Apply an FRT+NRT policy and settle the first response, so a cycle can arm. */
  async function seedWithSettledFirstResponse(): Promise<{
    conversationId: ConversationId
    policyId: string
  }> {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({
      name: 'FR+NR',
      firstResponseTargetSecs: 3600,
      nextResponseTargetSecs: 2 * 3600,
    })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
    await recordFirstResponse(conversationId, new Date('2026-01-05T10:30:00Z'))
    return { conversationId, policyId: policy.id }
  }

  it('stores the resolved schedule on the stamp at apply time', async () => {
    workspaceHours.schedule = {
      enabled: true,
      timezone: 'UTC',
      intervals: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' })),
    }
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

    const stamp = await loadStamp(conversationId)
    expect(stamp.scheduleSnapshot).toEqual({
      timezone: 'UTC',
      intervals: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' })),
      holidays: [],
    })
  })

  it('re-arms the next-response clock even after the policy is archived', async () => {
    const { conversationId, policyId } = await seedWithSettledFirstResponse()
    // Archive (soft-delete) the policy: pre-snapshot this silently stopped
    // every future re-arm, because the re-arm re-fetched the LIVE policy.
    await softDeleteSlaPolicy(policyId as never)

    await rearmNextResponse(conversationId, new Date('2026-01-05T10:40:00Z'))
    expect((await loadStamp(conversationId)).nextResponseDueAt).toBe('2026-01-05T12:40:00.000Z')
  })

  it('a mid-cycle schedule edit does not move the armed deadline', async () => {
    const { conversationId } = await seedWithSettledFirstResponse()
    // The workspace schedule CHANGES after apply: the snapshot (24/7) must
    // still govern — the live Mon-Fri 09:00-17:00 schedule would move a
    // Friday-evening re-arm to Monday morning instead.
    workspaceHours.schedule = {
      enabled: true,
      timezone: 'UTC',
      intervals: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' })),
    }

    // Fri 2026-01-09 16:00 + 2h: the 24/7 snapshot gives Fri 18:00 (NOT Mon
    // 10:00, which the edited live schedule would produce).
    await rearmNextResponse(conversationId, new Date('2026-01-09T16:00:00Z'))
    expect((await loadStamp(conversationId)).nextResponseDueAt).toBe('2026-01-09T18:00:00.000Z')
  })

  it('a legacy stamp without a snapshot falls back to the live policy (and no-ops when it is archived)', async () => {
    const { conversationId, policyId } = await seedWithSettledFirstResponse()
    // Strip the snapshot to simulate a stamp written before the field existed.
    const stamp = await loadStamp(conversationId)
    const { scheduleSnapshot: _stripped, ...legacy } = stamp as Record<string, unknown>
    await testDb
      .update(conversations)
      .set({ slaApplied: legacy })
      .where(eq(conversations.id, conversationId))

    // Fallback resolves the live policy's schedule — here 24/7, so the re-arm
    // lands exactly as the snapshot path would have.
    await rearmNextResponse(conversationId, new Date('2026-01-05T10:40:00Z'))
    expect((await loadStamp(conversationId)).nextResponseDueAt).toBe('2026-01-05T12:40:00.000Z')

    // With the policy archived, the legacy stamp's re-arm is a no-op (the
    // documented backfill tolerance — only snapshot-carrying stamps keep
    // re-arming under an archived policy).
    await softDeleteSlaPolicy(policyId as never)
    await testDb
      .update(conversations)
      .set({ slaApplied: { ...legacy, nextResponseDueAt: null } })
      .where(eq(conversations.id, conversationId))
    await rearmNextResponse(conversationId, new Date('2026-01-05T10:50:00Z'))
    expect((await loadStamp(conversationId)).nextResponseDueAt).toBeFalsy()
  })
})
