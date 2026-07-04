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

import { createSlaPolicy } from '../sla-policy.service'
import { applySlaToConversation } from '../sla.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db.select({ id: slaEvents.id }).from(slaEvents).limit(0)
  },
})

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
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

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
})
