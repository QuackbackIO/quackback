/**
 * Real-DB concurrency coverage for the ticket TTR stamp write contract
 * (support platform §4.6): the ticket twin of
 * sla.service.settle-guard.test.ts — every writer of `tickets.sla_applied`
 * merges ONLY the fields it owns (commitTicketStamp's guarded jsonb `||`),
 * so two writers racing the same stamp keep each other's disjoint fields and
 * never double-log an sla_events row. See the conversation twin's module doc
 * for why these races need the real fixture (the guards are SQL predicates
 * Postgres re-evaluates at UPDATE time) and how `Promise.all` reproduces the
 * interleaving deterministically inside it.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { TicketId, TicketStatusId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { tickets, ticketStatuses, slaEvents, slaPolicies, eq } from '@/lib/server/db'

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
  applySlaToTicket,
  recordTicketResolution,
  pauseTicketSlaOnPending,
  type TicketSlaApplied,
} from '../ticket-sla.service'
import { sweepOverdueTicketSlaBreaches } from '../ticket-sla.sweep'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ slaApplied: tickets.slaApplied }).from(tickets).limit(0)
    await db.select({ ticketId: slaEvents.ticketId }).from(slaEvents).limit(0)
    await db.select({ ttr: slaPolicies.timeToResolveTargetSecs }).from(slaPolicies).limit(0)
  },
})
afterAll(() => fixture.close())

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedTicket(): Promise<TicketId> {
  const [status] = await testDb
    .insert(ticketStatuses)
    .values({ name: `T-open-${suffix()}`, slug: `t_open_${suffix()}`, category: 'open' })
    .returning()
  const [row] = await testDb
    .insert(tickets)
    .values({
      type: 'customer',
      title: `Ticket-${suffix()}`,
      statusId: status.id as TicketStatusId,
    })
    .returning()
  return row.id
}

async function loadStamp(ticketId: TicketId): Promise<TicketSlaApplied | null> {
  const [row] = await testDb
    .select({ slaApplied: tickets.slaApplied })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
  return (row?.slaApplied as TicketSlaApplied | undefined) ?? null
}

const eventsFor = async (ticketId: TicketId) =>
  testDb.select().from(slaEvents).where(eq(slaEvents.ticketId, ticketId))

describe.skipIf(!fixture.available)('ticket TTR stamp concurrency (real DB, rolled back)', () => {
  beforeEach(() => {
    workspaceHours.schedule = { enabled: false, timezone: 'UTC', intervals: [] }
    return fixture.begin()
  })
  afterEach(fixture.rollback)

  it('two concurrent settles log exactly one event and leave exactly one winner', async () => {
    const ticketId = await seedTicket()
    const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 3600 })
    await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // Two closes race the same unsettled clock (e.g. a tracker cascade plus a
    // manual close). Both read the unsettled stamp; the loser's content CAS
    // on `resolvedAt IS NULL` then matches zero rows — it must NOT log a
    // second event.
    await Promise.all([
      recordTicketResolution(ticketId, new Date('2026-01-05T10:30:00Z')),
      recordTicketResolution(ticketId, new Date('2026-01-05T10:31:00Z')),
    ])

    const settles = (await eventsFor(ticketId)).filter((e) => e.kind.startsWith('time_to_resolve'))
    expect(settles).toHaveLength(1)
    expect(settles[0].kind).toBe('time_to_resolve_met')

    const stamp = await loadStamp(ticketId)
    expect(['2026-01-05T10:30:00.000Z', '2026-01-05T10:31:00.000Z']).toContain(stamp?.resolvedAt)
  })

  it('a settle racing a pause keeps BOTH fields (no whole-stamp clobber)', async () => {
    const ticketId = await seedTicket()
    const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 3600 })
    await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // The ticket twin of the conversation race: the settle owns resolvedAt,
    // the pause owns pausedAt, and with owned-field merge writes both land.
    await Promise.all([
      recordTicketResolution(ticketId, new Date('2026-01-05T10:30:00Z')),
      pauseTicketSlaOnPending(ticketId, new Date('2026-01-05T10:10:00Z')),
    ])

    const stamp = await loadStamp(ticketId)
    expect(stamp?.resolvedAt).toBe('2026-01-05T10:30:00.000Z')
    expect(stamp?.pausedAt).toBe('2026-01-05T10:10:00.000Z')

    const kinds = (await eventsFor(ticketId)).map((e) => e.kind)
    expect(kinds).toContain('time_to_resolve_met')
    expect(kinds).toContain('paused')
    expect(kinds.filter((k) => k.startsWith('time_to_resolve'))).toHaveLength(1)
  })

  it('a sweep claim racing a settle records exactly one breach', async () => {
    const ticketId = await seedTicket()
    const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 3600 })
    await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // Due 11:00; at 11:05 the sweep and a late close race. Both orderings are
    // safe: settle first -> the sweep's claim re-checks `resolvedAt` and
    // misses; sweep first -> the settle's content CAS re-checks
    // `resolutionBreachedAt`, misses, and reloads into the
    // settle-after-breach path. Either way the breach is logged exactly once.
    await Promise.all([
      sweepOverdueTicketSlaBreaches(new Date('2026-01-05T11:05:00Z')),
      recordTicketResolution(ticketId, new Date('2026-01-05T11:05:00Z')),
    ])

    const events = (await eventsFor(ticketId)).filter((e) => e.kind !== 'applied')
    expect(events.filter((e) => e.kind === 'time_to_resolve_breached')).toHaveLength(1)
    const stamp = await loadStamp(ticketId)
    expect(stamp?.resolvedAt).toBe('2026-01-05T11:05:00.000Z')
    expect(stamp?.resolutionBreachedAt).toBeTruthy()
  })

  it('a failed event insert rolls the stamp merge back (atomic stamp + event)', async () => {
    const ticketId = await seedTicket()
    const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 3600 })
    await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // Corrupt the stamp's policyId so the clock-event insert violates
    // sla_events_policy_id_fkey (see the conversation twin for the full
    // rationale).
    const stamp = await loadStamp(ticketId)
    await testDb
      .update(tickets)
      .set({ slaApplied: { ...stamp, policyId: 'sla_policy_missing' } as never })
      .where(eq(tickets.id, ticketId))

    await expect(
      recordTicketResolution(ticketId, new Date('2026-01-05T10:30:00Z'))
    ).rejects.toThrow()

    const after = await loadStamp(ticketId)
    expect(after?.resolvedAt).toBeFalsy()
    expect((await eventsFor(ticketId)).map((e) => e.kind)).toEqual(['applied'])
  })
})
