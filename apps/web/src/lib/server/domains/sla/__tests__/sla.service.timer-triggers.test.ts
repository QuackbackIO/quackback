/**
 * Real-DB coverage for the two timer-driven SLA triggers' scan half
 * (support platform §4.6): sweepApproachingSlaBreaches / sweepSlaBreachTriggers.
 * Both are CAS-guarded fire-once claims on `conversations.sla_applied`,
 * mirroring sweepOverdueSlaBreaches's own pattern (see sla.service.test.ts) but
 * on DISTINCT marker fields, so the two trigger sweeps and the pre-existing
 * per-minute reporting sweep never block each other. The dispatch half
 * (turning a claimed candidate into an actual synthetic event) is
 * workflow-sweep.ts's job and is covered there instead.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type PrincipalId, type UserId, type ConversationId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, slaEvents, user, principal, eq } from '@/lib/server/db'

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
import {
  applySlaToConversation,
  recordFirstResponse,
  rearmNextResponse,
  pauseSlaOnSnooze,
  resumeSlaFromSnooze,
  sweepApproachingSlaBreaches,
  sweepSlaBreachTriggers,
  sweepOverdueSlaBreaches,
} from '../sla.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db.select({ id: slaEvents.id }).from(slaEvents).limit(0)
  },
})
afterAll(() => fixture.close())

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

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

/** The EventConversationRef a plain seedConversation() row resolves to
 *  (status 'open' by default, channel 'messenger', priority 'none',
 *  unassigned) — every claimed SlaTimerTriggerCandidate below carries this,
 *  since none of these tests change those columns. */
function conversationRef(conversationId: ConversationId) {
  return {
    id: conversationId,
    status: 'open',
    channel: 'messenger',
    priority: 'none',
    assignedTeamId: null,
  }
}

describe.skipIf(!fixture.available)('SLA timer-trigger scans (real DB, rolled back)', () => {
  beforeEach(() => {
    workspaceHours.schedule = { enabled: false, timezone: 'UTC', intervals: [] }
    return fixture.begin()
  })
  afterEach(fixture.rollback)

  describe('sweepApproachingSlaBreaches', () => {
    it('claims a conversation whose clock enters the lead window, once', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      // Due 11:00. At 10:50, 10 minutes out — inside a 15-minute lead window.
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

      const first = await sweepApproachingSlaBreaches(15, new Date('2026-01-05T10:50:00Z'))
      expect(first).toEqual([
        {
          conversationId,
          conversation: conversationRef(conversationId),
          policyId: policy.id,
          clock: 'first_response',
          dueAt: '2026-01-05T11:00:00.000Z',
        },
      ])

      // A re-scan (same tick or a later one, still before due) must not re-claim.
      const second = await sweepApproachingSlaBreaches(15, new Date('2026-01-05T10:55:00Z'))
      expect(second).toEqual([])

      const [conv] = await testDb
        .select({ slaApplied: conversations.slaApplied })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
      expect(
        (conv.slaApplied as { firstResponseWarningFiredAt?: string }).firstResponseWarningFiredAt
      ).toBe('2026-01-05T10:50:00.000Z')
    })

    it('does not claim a clock still outside the lead window', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

      // Due 11:00; at 10:30 there are 30 minutes left, outside a 15-minute lead.
      expect(await sweepApproachingSlaBreaches(15, new Date('2026-01-05T10:30:00Z'))).toEqual([])
    })

    it('does not claim a clock that has already passed its due date (that is sla.breached, not a warning)', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

      expect(await sweepApproachingSlaBreaches(15, new Date('2026-01-05T11:05:00Z'))).toEqual([])
    })

    it('never claims a settled clock', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
      await recordFirstResponse(conversationId, new Date('2026-01-05T10:45:00Z'))

      expect(await sweepApproachingSlaBreaches(15, new Date('2026-01-05T10:50:00Z'))).toEqual([])
    })

    it('never claims a clock that is currently paused', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
      await pauseSlaOnSnooze(conversationId, new Date('2026-01-05T10:40:00Z'))

      // The stamped due date (11:00) is inside the lead window at 10:50, but paused.
      expect(await sweepApproachingSlaBreaches(15, new Date('2026-01-05T10:50:00Z'))).toEqual([])
    })

    it('claims against the pause-shifted deadline after a resume', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
      // Paused 10:20 -> 10:50 (30 min): due shifts from 11:00 to 11:30.
      await pauseSlaOnSnooze(conversationId, new Date('2026-01-05T10:20:00Z'))
      await resumeSlaFromSnooze(conversationId, new Date('2026-01-05T10:50:00Z'))

      // Inside the original 11:00 lead window but the real (shifted) due is 11:30 — not yet due.
      expect(await sweepApproachingSlaBreaches(15, new Date('2026-01-05T10:50:01Z'))).toEqual([])
      // Inside the shifted window (15 min before 11:30).
      const claimed = await sweepApproachingSlaBreaches(15, new Date('2026-01-05T11:16:00Z'))
      expect(claimed).toEqual([
        {
          conversationId,
          conversation: conversationRef(conversationId),
          policyId: policy.id,
          clock: 'first_response',
          dueAt: '2026-01-05T11:30:00.000Z',
        },
      ])
    })

    it('does not block, or get blocked by, the per-minute breach-reporting sweep (distinct marker fields)', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

      // Warning fires first (10:50), then the clock actually breaches (11:05) —
      // the reporting sweep's own claim must still succeed independently.
      await sweepApproachingSlaBreaches(15, new Date('2026-01-05T10:50:00Z'))
      const breachResult = await sweepOverdueSlaBreaches(new Date('2026-01-05T11:05:00Z'))
      expect(breachResult.recorded).toBe(1)
    })

    it('claims an armed next-response cycle inside the lead window, and re-arms for a fresh cycle', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({
        name: 'FR+NR',
        firstResponseTargetSecs: 3600,
        nextResponseTargetSecs: 2 * 3600,
      })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
      await recordFirstResponse(conversationId, new Date('2026-01-05T10:30:00Z'))
      await rearmNextResponse(conversationId, new Date('2026-01-05T10:40:00Z')) // NRT due 12:40

      const claimed = await sweepApproachingSlaBreaches(15, new Date('2026-01-05T12:30:00Z'))
      expect(claimed).toEqual([
        {
          conversationId,
          conversation: conversationRef(conversationId),
          policyId: policy.id,
          clock: 'next_response',
          dueAt: '2026-01-05T12:40:00.000Z',
        },
      ])
      // Fire-once within the cycle.
      expect(await sweepApproachingSlaBreaches(15, new Date('2026-01-05T12:32:00Z'))).toEqual([])

      // A fresh customer message re-arms the clock: the new cycle warns again.
      await rearmNextResponse(conversationId, new Date('2026-01-05T12:33:00Z')) // due 14:33
      const rearmed = await sweepApproachingSlaBreaches(15, new Date('2026-01-05T14:20:00Z'))
      expect(rearmed).toEqual([
        {
          conversationId,
          conversation: conversationRef(conversationId),
          policyId: policy.id,
          clock: 'next_response',
          dueAt: '2026-01-05T14:33:00.000Z',
        },
      ])
    })
  })

  describe('sweepSlaBreachTriggers', () => {
    it('claims an overdue, unsettled clock exactly once', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

      const first = await sweepSlaBreachTriggers(new Date('2026-01-05T11:05:00Z'))
      expect(first).toEqual([
        {
          conversationId,
          conversation: conversationRef(conversationId),
          policyId: policy.id,
          clock: 'first_response',
          dueAt: '2026-01-05T11:00:00.000Z',
        },
      ])
      expect(await sweepSlaBreachTriggers(new Date('2026-01-05T11:10:00Z'))).toEqual([])
    })

    it('does not claim a clock not yet due', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

      expect(await sweepSlaBreachTriggers(new Date('2026-01-05T10:45:00Z'))).toEqual([])
    })

    it('never claims a settled clock', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
      await recordFirstResponse(conversationId, new Date('2026-01-05T10:45:00Z'))

      expect(await sweepSlaBreachTriggers(new Date('2026-01-05T11:05:00Z'))).toEqual([])
    })

    it('never claims a currently-paused clock', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
      await pauseSlaOnSnooze(conversationId, new Date('2026-01-05T10:30:00Z'))

      expect(await sweepSlaBreachTriggers(new Date('2026-01-05T11:05:00Z'))).toEqual([])
    })

    it('is independent of the per-minute breach-reporting sweep having already claimed its own marker', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

      // The per-minute reporting sweep claims its own marker first...
      const reported = await sweepOverdueSlaBreaches(new Date('2026-01-05T11:05:00Z'))
      expect(reported.recorded).toBe(1)
      // ...but the trigger sweep still fires once off its own, distinct marker.
      const triggered = await sweepSlaBreachTriggers(new Date('2026-01-05T11:06:00Z'))
      expect(triggered).toHaveLength(1)
      expect(await sweepSlaBreachTriggers(new Date('2026-01-05T11:07:00Z'))).toEqual([])
    })

    it('claims an overdue, armed next-response cycle exactly once', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({
        name: 'FR+NR',
        firstResponseTargetSecs: 3600,
        nextResponseTargetSecs: 2 * 3600,
      })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
      await recordFirstResponse(conversationId, new Date('2026-01-05T10:30:00Z'))
      await rearmNextResponse(conversationId, new Date('2026-01-05T10:40:00Z')) // NRT due 12:40

      const first = await sweepSlaBreachTriggers(new Date('2026-01-05T12:45:00Z'))
      expect(first).toEqual([
        {
          conversationId,
          conversation: conversationRef(conversationId),
          policyId: policy.id,
          clock: 'next_response',
          dueAt: '2026-01-05T12:40:00.000Z',
        },
      ])
      expect(await sweepSlaBreachTriggers(new Date('2026-01-05T12:50:00Z'))).toEqual([])
    })

    // Deliberate design (see this module's doc comment right above SLA_CLOCKS/
    // scanAndClaimSlaClocks): unlike the customer/teammate_unresponsive scan
    // (workflow-sweep.ts's scanUnresponsiveForWorkflow), which excludes
    // closed/snoozed conversations by SQL filter, none of the three SLA sweeps
    // filter on conversation status at all — a snoozed conversation under a
    // no-pause policy legitimately keeps breaching, and a closed conversation
    // whose first-response clock was never settled (no reply before close) is
    // a real, reportable breach; whether that's actionable is left to a
    // workflow's OWN condition/branch on conversation.status, not baked into
    // the scan.
    it('still fires sla.breached for a closed conversation whose first-response clock was never settled', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
      await testDb
        .update(conversations)
        .set({ status: 'closed' })
        .where(eq(conversations.id, conversationId))

      const triggered = await sweepSlaBreachTriggers(new Date('2026-01-05T11:05:00Z'))
      expect(triggered).toEqual([
        {
          conversationId,
          conversation: { ...conversationRef(conversationId), status: 'closed' },
          policyId: policy.id,
          clock: 'first_response',
          dueAt: '2026-01-05T11:00:00.000Z',
        },
      ])
    })
  })
})
