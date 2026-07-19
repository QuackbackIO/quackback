/**
 * Real-DB coverage for the two timer-driven SLA triggers (support platform
 * §4.6): sweepApproachingSlaBreaches / sweepSlaBreachTriggers, plus the
 * post-enqueue claim the caller (workflow-sweep.ts) performs per dispatched
 * candidate (claimSlaTimerTriggerMarker).
 *
 * Since the claim moved after the enqueue (claim-after-enqueue — see
 * sla.sweep.ts's docs), the scans themselves are now UNCLAIMED: they return
 * eligible candidates without touching the fire-once markers, and the claim
 * is a separate CAS that re-verifies the stamp (identity, exact due, marker
 * unset, clock unsettled) before stamping. Fire-once is still guaranteed
 * end-to-end: the first landed claim excludes every later scan and every
 * sibling claim.
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
} from '../sla.service'
import {
  claimSlaTimerTriggerMarker,
  sweepApproachingSlaBreaches,
  sweepSlaBreachTriggers,
  sweepOverdueSlaBreaches,
} from '../sla.sweep'

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
 *  unassigned) — every scanned SlaTimerTriggerCandidate below carries this,
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

const loadStamp = async (conversationId: ConversationId) => {
  const [conv] = await testDb
    .select({ slaApplied: conversations.slaApplied })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  return conv.slaApplied as {
    appliedAt: string
    firstResponseWarningFiredAt?: string | null
    firstResponseBreachTriggerFiredAt?: string | null
    nextResponseWarningFiredAt?: string | null
    nextResponseBreachTriggerFiredAt?: string | null
  }
}

describe.skipIf(!fixture.available)('SLA timer-trigger scans (real DB, rolled back)', () => {
  beforeEach(() => {
    workspaceHours.schedule = { enabled: false, timezone: 'UTC', intervals: [] }
    return fixture.begin()
  })
  afterEach(fixture.rollback)

  describe('sweepApproachingSlaBreaches + claimSlaTimerTriggerMarker(warning)', () => {
    it('scans a conversation whose clock enters the lead window WITHOUT claiming; the claim then stamps the marker exactly once', async () => {
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
          appliedAt: '2026-01-05T10:00:00.000Z',
        },
      ])
      // The scan alone must NOT claim the marker (claim-after-enqueue): an
      // enqueue failure leaves it free for the next tick's retry.
      expect((await loadStamp(conversationId)).firstResponseWarningFiredAt).toBeFalsy()

      // The post-enqueue claim stamps it; a sibling claim loses the CAS; and
      // a re-scan (same tick or a later one) never returns the clock again.
      expect(
        await claimSlaTimerTriggerMarker(first[0], 'warning', new Date('2026-01-05T10:50:00Z'))
      ).toBe(true)
      expect((await loadStamp(conversationId)).firstResponseWarningFiredAt).toBe(
        '2026-01-05T10:50:00.000Z'
      )
      expect(
        await claimSlaTimerTriggerMarker(first[0], 'warning', new Date('2026-01-05T10:51:00Z'))
      ).toBe(false)
      expect(await sweepApproachingSlaBreaches(15, new Date('2026-01-05T10:55:00Z'))).toEqual([])
    })

    it('does not scan a clock still outside the lead window', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

      // Due 11:00; at 10:30 there are 30 minutes left, outside a 15-minute lead.
      expect(await sweepApproachingSlaBreaches(15, new Date('2026-01-05T10:30:00Z'))).toEqual([])
    })

    it('does not scan a clock that has already passed its due date (that is sla.breached, not a warning)', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

      expect(await sweepApproachingSlaBreaches(15, new Date('2026-01-05T11:05:00Z'))).toEqual([])
    })

    it('never scans a settled clock', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
      await recordFirstResponse(conversationId, new Date('2026-01-05T10:45:00Z'))

      expect(await sweepApproachingSlaBreaches(15, new Date('2026-01-05T10:50:00Z'))).toEqual([])
    })

    it('a settle landing between scan and claim suppresses the claim (A2)', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

      const [candidate] = await sweepApproachingSlaBreaches(15, new Date('2026-01-05T10:50:00Z'))
      expect(candidate).toBeTruthy()
      // The reply lands after the scan but before the claim: the claim's CAS
      // re-checks the settled field, so it misses and the marker stays
      // truthful (the trigger never fired for the settled clock).
      await recordFirstResponse(conversationId, new Date('2026-01-05T10:52:00Z'))

      expect(
        await claimSlaTimerTriggerMarker(candidate, 'warning', new Date('2026-01-05T10:53:00Z'))
      ).toBe(false)
      expect((await loadStamp(conversationId)).firstResponseWarningFiredAt).toBeFalsy()
      // And the settled clock is gone from every later scan.
      expect(await sweepApproachingSlaBreaches(15, new Date('2026-01-05T10:54:00Z'))).toEqual([])
    })

    it('never scans a clock that is currently paused', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
      await pauseSlaOnSnooze(conversationId, new Date('2026-01-05T10:40:00Z'))

      // The stamped due date (11:00) is inside the lead window at 10:50, but paused.
      expect(await sweepApproachingSlaBreaches(15, new Date('2026-01-05T10:50:00Z'))).toEqual([])
    })

    it('scans against the pause-shifted deadline after a resume, and a claim pinned to the pre-shift deadline misses', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

      // A scan at the ORIGINAL deadline's window, then a pause+resume cycle
      // shifts due from 11:00 to 11:30 before the claim lands: the claim's
      // due pin invalidates the stale computation.
      const [stale] = await sweepApproachingSlaBreaches(15, new Date('2026-01-05T10:50:00Z'))
      expect(stale.dueAt).toBe('2026-01-05T11:00:00.000Z')
      await pauseSlaOnSnooze(conversationId, new Date('2026-01-05T10:51:00Z'))
      await resumeSlaFromSnooze(conversationId, new Date('2026-01-05T11:21:00Z')) // +30m shift

      expect(
        await claimSlaTimerTriggerMarker(stale, 'warning', new Date('2026-01-05T11:22:00Z'))
      ).toBe(false)

      // The shifted deadline (11:30) scans inside its own window and claims.
      const fresh = await sweepApproachingSlaBreaches(15, new Date('2026-01-05T11:22:00Z'))
      expect(fresh).toEqual([
        {
          conversationId,
          conversation: conversationRef(conversationId),
          policyId: policy.id,
          clock: 'first_response',
          dueAt: '2026-01-05T11:30:00.000Z',
          appliedAt: '2026-01-05T10:00:00.000Z',
        },
      ])
      expect(
        await claimSlaTimerTriggerMarker(fresh[0], 'warning', new Date('2026-01-05T11:22:00Z'))
      ).toBe(true)
    })

    it('does not block, or get blocked by, the per-minute breach-reporting sweep (distinct marker fields)', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

      // Warning fires first (10:50), then the clock actually breaches (11:05) —
      // the reporting sweep's own claim must still succeed independently.
      const [candidate] = await sweepApproachingSlaBreaches(15, new Date('2026-01-05T10:50:00Z'))
      expect(
        await claimSlaTimerTriggerMarker(candidate, 'warning', new Date('2026-01-05T10:50:00Z'))
      ).toBe(true)
      const breachResult = await sweepOverdueSlaBreaches(new Date('2026-01-05T11:05:00Z'))
      expect(breachResult.recorded).toBe(1)
    })

    it('scans an armed next-response cycle inside the lead window, and a fresh cycle warns again', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({
        name: 'FR+NR',
        firstResponseTargetSecs: 3600,
        nextResponseTargetSecs: 2 * 3600,
      })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
      await recordFirstResponse(conversationId, new Date('2026-01-05T10:30:00Z'))
      await rearmNextResponse(conversationId, new Date('2026-01-05T10:40:00Z')) // NRT due 12:40

      const [candidate] = await sweepApproachingSlaBreaches(15, new Date('2026-01-05T12:30:00Z'))
      expect(candidate).toMatchObject({
        conversationId,
        clock: 'next_response',
        dueAt: '2026-01-05T12:40:00.000Z',
      })
      expect(
        await claimSlaTimerTriggerMarker(candidate, 'warning', new Date('2026-01-05T12:30:00Z'))
      ).toBe(true)
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
          appliedAt: '2026-01-05T10:00:00.000Z',
        },
      ])
    })
  })

  describe('sweepSlaBreachTriggers + claimSlaTimerTriggerMarker(breach)', () => {
    it('scans an overdue, unsettled clock; the claim stamps the trigger marker exactly once', async () => {
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
          appliedAt: '2026-01-05T10:00:00.000Z',
        },
      ])
      expect((await loadStamp(conversationId)).firstResponseBreachTriggerFiredAt).toBeFalsy()

      expect(
        await claimSlaTimerTriggerMarker(first[0], 'breach', new Date('2026-01-05T11:05:00Z'))
      ).toBe(true)
      expect((await loadStamp(conversationId)).firstResponseBreachTriggerFiredAt).toBe(
        '2026-01-05T11:05:00.000Z'
      )
      expect(await sweepSlaBreachTriggers(new Date('2026-01-05T11:10:00Z'))).toEqual([])
    })

    it('does not scan a clock not yet due', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

      expect(await sweepSlaBreachTriggers(new Date('2026-01-05T10:45:00Z'))).toEqual([])
    })

    it('never scans a settled clock', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
      await recordFirstResponse(conversationId, new Date('2026-01-05T10:45:00Z'))

      expect(await sweepSlaBreachTriggers(new Date('2026-01-05T11:05:00Z'))).toEqual([])
    })

    it('a settle landing between scan and claim suppresses the claim (A2)', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

      const [candidate] = await sweepSlaBreachTriggers(new Date('2026-01-05T11:05:00Z'))
      expect(candidate).toBeTruthy()
      await recordFirstResponse(conversationId, new Date('2026-01-05T11:06:00Z'))

      expect(
        await claimSlaTimerTriggerMarker(candidate, 'breach', new Date('2026-01-05T11:07:00Z'))
      ).toBe(false)
      expect((await loadStamp(conversationId)).firstResponseBreachTriggerFiredAt).toBeFalsy()
    })

    it('never scans a currently-paused clock', async () => {
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
      // ...but the trigger sweep still scans + claims once off its own,
      // distinct marker.
      const [candidate] = await sweepSlaBreachTriggers(new Date('2026-01-05T11:06:00Z'))
      expect(candidate).toBeTruthy()
      expect(
        await claimSlaTimerTriggerMarker(candidate, 'breach', new Date('2026-01-05T11:06:00Z'))
      ).toBe(true)
      expect(await sweepSlaBreachTriggers(new Date('2026-01-05T11:07:00Z'))).toEqual([])
    })

    it('scans an overdue, armed next-response cycle exactly once', async () => {
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
          appliedAt: '2026-01-05T10:00:00.000Z',
        },
      ])
      expect(
        await claimSlaTimerTriggerMarker(first[0], 'breach', new Date('2026-01-05T12:45:00Z'))
      ).toBe(true)
      expect(await sweepSlaBreachTriggers(new Date('2026-01-05T12:50:00Z'))).toEqual([])
    })

    // Deliberate design (see sla.sweep.ts's module doc and
    // scanSlaClockCandidates): unlike the customer/teammate_unresponsive scan
    // (workflow-sweep.ts's scanUnresponsiveForWorkflow), which excludes
    // closed/snoozed conversations by SQL filter, none of the three SLA sweeps
    // filter on conversation status at all — a snoozed conversation under a
    // no-pause policy legitimately keeps breaching, and a closed conversation
    // whose first-response clock was never settled (no reply before close) is
    // a real, reportable breach; whether that's actionable is left to a
    // workflow's OWN condition/branch on conversation.status, not baked into
    // the scan.
    it('still scans sla.breached for a closed conversation whose first-response clock was never settled', async () => {
      const conversationId = await seedConversation()
      const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
      await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
      await testDb
        .update(conversations)
        .set({ status: 'closed' })
        .where(eq(conversations.id, conversationId))

      const scanned = await sweepSlaBreachTriggers(new Date('2026-01-05T11:05:00Z'))
      expect(scanned).toEqual([
        {
          conversationId,
          conversation: { ...conversationRef(conversationId), status: 'closed' },
          policyId: policy.id,
          clock: 'first_response',
          dueAt: '2026-01-05T11:00:00.000Z',
          appliedAt: '2026-01-05T10:00:00.000Z',
        },
      ])
    })
  })
})
