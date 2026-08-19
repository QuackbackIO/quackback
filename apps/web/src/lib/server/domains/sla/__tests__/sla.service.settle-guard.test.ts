/**
 * Real-DB concurrency coverage for the SLA stamp write contract (support
 * platform §4.6): every stamp writer merges ONLY the fields it owns
 * (commitStamp's guarded jsonb `||` — see sla.service.ts's SlaApplied
 * ownership map), so two writers racing the same stamp keep each other's
 * disjoint fields and never double-log an sla_events row.
 *
 * Why real DB: the guards are SQL predicates Postgres re-evaluates at UPDATE
 * time — a mocked db can only prove a function ISSUED an update, not that the
 * predicate holds under a genuine interleaving. Inside the fixture's single
 * transaction/connection, concurrent writers' statements serialize in issue
 * order and later statements see earlier effects (exactly the visibility two
 * connections' READ COMMITTED writes produce for the loser), so
 * `Promise.all` of two writers reproduces the race deterministically: the
 * second writer's content CAS matches zero rows and it reloads/withdraws.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type PrincipalId, type UserId, type ConversationId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, slaEvents, user, principal, eq } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// 24/7 everywhere — these tests pin exact instants, not office-hours math.
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
  loadSlaApplied,
  recordFirstResponse,
  recordNextResponse,
  rearmNextResponse,
  pauseSlaOnSnooze,
} from '../sla.service'
import { sweepOverdueSlaBreaches } from '../sla.sweep'

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

const eventsFor = async (conversationId: ConversationId) =>
  testDb.select().from(slaEvents).where(eq(slaEvents.conversationId, conversationId))

describe.skipIf(!fixture.available)('SLA stamp concurrency (real DB, rolled back)', () => {
  beforeEach(() => {
    workspaceHours.schedule = { enabled: false, timezone: 'UTC', intervals: [] }
    return fixture.begin()
  })
  afterEach(fixture.rollback)

  it('two concurrent settles log exactly one event and leave exactly one winner', async () => {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // Two teammate replies race the same unsettled clock (e.g. the same
    // message's event delivered twice, or two agents answering at once). Both
    // read the unsettled stamp; the loser's content CAS on
    // `firstResponseAt IS NULL` then matches zero rows — it must NOT log a
    // second event, and its reload sees the clock settled and withdraws.
    await Promise.all([
      recordFirstResponse(conversationId, new Date('2026-01-05T10:30:00Z')),
      recordFirstResponse(conversationId, new Date('2026-01-05T10:31:00Z')),
    ])

    const settles = (await eventsFor(conversationId)).filter((e) =>
      e.kind.startsWith('first_response')
    )
    expect(settles).toHaveLength(1)
    expect(settles[0].kind).toBe('first_response_met')

    // One winner's timestamp owns the outcome field; the loser did not
    // clobber it.
    const applied = await loadSlaApplied(conversationId)
    expect(['2026-01-05T10:30:00.000Z', '2026-01-05T10:31:00.000Z']).toContain(
      applied?.firstResponseAt
    )
  })

  it('a settle racing a pause keeps BOTH fields (no whole-stamp clobber)', async () => {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // The old whole-stamp write contract lost exactly this race: both writers
    // changed neither guard field (appliedAt/pausedAt-vs-null aside), so the
    // later whole-stamp write resurrected its stale read over the earlier
    // one's field. With owned-field merge writes, the settle owns
    // firstResponseAt, the pause owns pausedAt, and both land.
    await Promise.all([
      recordFirstResponse(conversationId, new Date('2026-01-05T10:30:00Z')),
      pauseSlaOnSnooze(conversationId, new Date('2026-01-05T10:10:00Z')),
    ])

    const applied = await loadSlaApplied(conversationId)
    expect(applied?.firstResponseAt).toBe('2026-01-05T10:30:00.000Z')
    expect(applied?.pausedAt).toBe('2026-01-05T10:10:00.000Z')

    const kinds = (await eventsFor(conversationId)).map((e) => e.kind)
    expect(kinds).toContain('first_response_met')
    expect(kinds).toContain('paused')
    expect(kinds.filter((k) => k.startsWith('first_response'))).toHaveLength(1)
  })

  it('a settle racing a re-arm lands one consistent cycle state and exactly one settle event', async () => {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({
      name: 'FR+NR',
      firstResponseTargetSecs: 3600,
      nextResponseTargetSecs: 2 * 3600,
    })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
    await recordFirstResponse(conversationId, new Date('2026-01-05T10:30:00Z'))
    await rearmNextResponse(conversationId, new Date('2026-01-05T10:40:00Z')) // NRT due 12:40

    // An agent reply (settles the armed cycle) races a fresh customer ping
    // (re-arms a new cycle). The re-arm pins the due it replaces, so it
    // always lands; the settle merges only its own outcome field. Whichever
    // order Postgres serializes them, the stamp ends in one of the two
    // consistent interleavings — never a torn mix — and exactly one
    // next_response event exists.
    await Promise.all([
      recordNextResponse(conversationId, new Date('2026-01-05T11:40:00Z')),
      rearmNextResponse(conversationId, new Date('2026-01-05T11:50:00Z')), // new cycle, due 13:50
    ])

    const applied = await loadSlaApplied(conversationId)
    expect(applied?.nextResponseDueAt).toBe('2026-01-05T13:50:00.000Z')
    // Consistent outcomes: re-arm landed last (cycle cleared) or the settle
    // landed last (the fresh cycle shows the reply). No other mix is legal.
    expect([null, '2026-01-05T11:40:00.000Z']).toContainEqual(applied?.nextResponseAt ?? null)

    const nrt = (await eventsFor(conversationId)).filter((e) => e.kind.startsWith('next_response'))
    expect(nrt).toHaveLength(1)
    expect(nrt[0].kind).toBe('next_response_met')
  })

  it('a sweep claim racing a settle records exactly one breach', async () => {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // Due 11:00; at 11:05 the sweep and a late reply race. Both orderings are
    // safe: settle first -> the sweep's claim re-checks the settled field and
    // misses; sweep first -> the settle's content CAS re-checks the
    // breach-noted marker, misses, and reloads into the settle-after-breach
    // path. Either way the breach is logged exactly once.
    await Promise.all([
      sweepOverdueSlaBreaches(new Date('2026-01-05T11:05:00Z')),
      recordFirstResponse(conversationId, new Date('2026-01-05T11:05:00Z')),
    ])

    const events = (await eventsFor(conversationId)).filter((e) => e.kind !== 'applied')
    expect(events.filter((e) => e.kind === 'first_response_breached')).toHaveLength(1)
    // The settle's own field survives regardless of order (merge, not
    // whole-stamp), and the breach marker is set exactly once.
    const applied = await loadSlaApplied(conversationId)
    expect(applied?.firstResponseAt).toBe('2026-01-05T11:05:00.000Z')
    expect(applied?.firstResponseBreachedAt).toBeTruthy()
  })

  it('a failed event insert rolls the stamp merge back (atomic stamp + event)', async () => {
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({ name: 'FR', firstResponseTargetSecs: 3600 })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // Corrupt the stamp's policyId so the clock-event insert violates
    // sla_events_policy_id_fkey. Without the transaction, the stamp merge
    // would commit and the event insert would throw — leaving a settled clock
    // with no settle event, and every later settle a no-op.
    const applied = await loadSlaApplied(conversationId)
    await testDb
      .update(conversations)
      .set({
        slaApplied: { ...applied, policyId: 'sla_policy_missing' } as never,
      })
      .where(eq(conversations.id, conversationId))

    await expect(
      recordFirstResponse(conversationId, new Date('2026-01-05T10:30:00Z'))
    ).rejects.toThrow()

    // The merge rolled back with the failed insert: still unsettled, and the
    // only event on the log is the original 'applied'.
    const after = await loadSlaApplied(conversationId)
    expect(after?.firstResponseAt).toBeFalsy()
    expect((await eventsFor(conversationId)).map((e) => e.kind)).toEqual(['applied'])
  })
})
