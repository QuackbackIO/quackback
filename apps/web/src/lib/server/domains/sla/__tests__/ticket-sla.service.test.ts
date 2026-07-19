/**
 * Real-DB coverage for the ticket-anchored TTR clock (support platform §4.6):
 * applying a policy stamps `tickets.sla_applied` + logs a ticket-anchored
 * 'applied' event (conversation_id NULL), entering a closed-category status
 * settles met/breached against the pause-adjusted deadline (permanently — a
 * reopen never re-arms), pending pauses and resume shifts the unsettled
 * deadline, and the per-minute sweep records a breach for a deadline that
 * passes in silence. Runs inside the db-test-fixture rollback transaction.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { TicketId, TicketStatusId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  tickets,
  ticketStatuses,
  slaEvents,
  slaPolicies,
  officeHoursSchedules,
  settings,
  eq,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// The workspace office-hours schedule (settings blob) resolveScheduleFor falls
// back to when a policy pins no table schedule. Mutable per test; the default
// (disabled) is 24/7. Same mock seam sla.service.test.ts uses.
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
  resumeTicketSlaFromPending,
  type TicketSlaApplied,
} from '../ticket-sla.service'
import { sweepOverdueTicketSlaBreaches } from '../ticket-sla.sweep'
import { ticketRowToDTO } from '../../tickets/ticket.dto'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ slaApplied: tickets.slaApplied }).from(tickets).limit(0)
    await db.select({ ticketId: slaEvents.ticketId }).from(slaEvents).limit(0)
    await db.select({ ttr: slaPolicies.timeToResolveTargetSecs }).from(slaPolicies).limit(0)
  },
})

// One close for the whole file — see sla.service.test.ts for why this lives
// at module level rather than inside a describe.
afterAll(() => fixture.close())

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/** Seed a ticket status of the given category; return its id. */
async function seedStatus(
  category: 'open' | 'pending' | 'closed' = 'open'
): Promise<TicketStatusId> {
  const [row] = await testDb
    .insert(ticketStatuses)
    .values({
      name: `T-${category}-${suffix()}`,
      slug: `t_${category}_${suffix()}`,
      category,
    })
    .returning()
  return row.id
}

/** Seed a ticket of the given type (direct insert — no DTO/webhook plumbing
 *  the createTicket path would pull in); return its id. */
async function seedTicket(
  type: 'customer' | 'back_office' | 'tracker' = 'customer'
): Promise<TicketId> {
  const statusId = await seedStatus()
  const [row] = await testDb
    .insert(tickets)
    .values({ type, title: `Ticket-${suffix()}`, statusId })
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

describe.skipIf(!fixture.available)('applySlaToTicket (real DB, rolled back)', () => {
  beforeEach(() => {
    workspaceHours.schedule = { enabled: false, timezone: 'UTC', intervals: [] }
    return fixture.begin()
  })
  afterEach(fixture.rollback)

  it('stamps the TTR deadline + logs a ticket-anchored applied event', async () => {
    const ticketId = await seedTicket()
    const policy = await createSlaPolicy({ name: 'Resolve fast', timeToResolveTargetSecs: 7200 })
    const at = new Date('2026-01-05T10:00:00Z')

    const applied = await applySlaToTicket(ticketId, policy.id, at)

    // 24/7 -> plain wall-clock from `at`.
    expect(applied).not.toBeNull()
    expect(applied!.timeToResolveDueAt).toBe('2026-01-05T12:00:00.000Z')
    expect(applied!.policyName).toBe('Resolve fast')
    expect(applied!.pauseOnPending).toBe(true)

    const stamp = await loadStamp(ticketId)
    expect(stamp?.policyId).toBe(policy.id)

    const events = await eventsFor(ticketId)
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('applied')
    expect(events[0].policyId).toBe(policy.id)
    // Ticket-anchored: ticket_id set, conversation_id explicitly NULL.
    expect(events[0].ticketId).toBe(ticketId)
    expect(events[0].conversationId).toBeNull()
    expect(events[0].meta.timeToResolveDueAt).toBe('2026-01-05T12:00:00.000Z')
  })

  it('rejects a tracker ticket (umbrellas carry no resolution clock)', async () => {
    const ticketId = await seedTicket('tracker')
    const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 3600 })

    await expect(applySlaToTicket(ticketId, policy.id)).rejects.toThrow(/tracker/i)
    expect(await loadStamp(ticketId)).toBeNull()
    expect(await eventsFor(ticketId)).toHaveLength(0)
  })

  it('is a silent no-op when the policy does not track time-to-resolve', async () => {
    const ticketId = await seedTicket()
    // A conversation-side policy (FRT only) — legitimate input via the link
    // handoff, which can't know the policy's targets.
    const policy = await createSlaPolicy({ name: 'FRT only', firstResponseTargetSecs: 3600 })

    const applied = await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))

    expect(applied).toBeNull()
    expect(await loadStamp(ticketId)).toBeNull()
    expect(await eventsFor(ticketId)).toHaveLength(0)
  })

  it('honors a policy-pinned office-hours schedule (deadline skips closed time)', async () => {
    const ticketId = await seedTicket()
    // Mon-Fri 09:00-17:00 UTC (8h/day). 2026-01-09 is a Friday.
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
      timeToResolveTargetSecs: 2 * 3600,
      officeHoursScheduleId: schedule.id,
    })

    // Fri 16:00 + 2 open hours: 1h Fri (16->17), weekend closed, 1h Mon from
    // 09:00 -> Mon 10:00 (NOT Fri 18:00).
    const applied = await applySlaToTicket(ticketId, policy.id, new Date('2026-01-09T16:00:00Z'))
    expect(applied!.timeToResolveDueAt).toBe('2026-01-12T10:00:00.000Z')
  })

  it('re-applying replaces the active SLA (one per ticket)', async () => {
    const ticketId = await seedTicket()
    const a = await createSlaPolicy({ name: 'A', timeToResolveTargetSecs: 3600 })
    const b = await createSlaPolicy({ name: 'B', timeToResolveTargetSecs: 7200 })

    await applySlaToTicket(ticketId, a.id, new Date('2026-01-05T10:00:00Z'))
    const applied = await applySlaToTicket(ticketId, b.id, new Date('2026-01-05T10:00:00Z'))

    expect(applied!.policyId).toBe(b.id)
    expect(applied!.timeToResolveDueAt).toBe('2026-01-05T12:00:00.000Z')
    // Both applications are on the timeline.
    expect(await eventsFor(ticketId)).toHaveLength(2)
  })

  it('projects the stamp into the ticket DTO (paused derives from the pending category)', async () => {
    // The DTO path enriches through settings-backed stage labels, so it needs
    // a settings row in the fixture.
    await testDb
      .insert(settings)
      .values({ name: 'Test WS', slug: `test_${suffix()}`, createdAt: new Date() })
    const pendingStatusId = await seedStatus('pending')
    const [row] = await testDb
      .insert(tickets)
      .values({ type: 'customer', title: `Ticket-${suffix()}`, statusId: pendingStatusId })
      .returning()
    const policy = await createSlaPolicy({
      name: 'Resolve fast',
      timeToResolveTargetSecs: 7200,
      pauseOnPending: true,
    })
    await applySlaToTicket(row.id, policy.id, new Date('2026-01-05T10:00:00Z'))

    const [fresh] = await testDb.select().from(tickets).where(eq(tickets.id, row.id))
    const dto = await ticketRowToDTO(fresh)

    expect(dto.sla).toEqual({
      policyName: 'Resolve fast',
      timeToResolveDueAt: '2026-01-05T12:00:00.000Z',
      resolvedAt: null,
      paused: true, // pending-category status under a pauseOnPending policy
    })
  })

  it('projects a null DTO sla when no SLA is applied', async () => {
    await testDb
      .insert(settings)
      .values({ name: 'Test WS', slug: `test_${suffix()}`, createdAt: new Date() })
    const statusId = await seedStatus()
    const [row] = await testDb
      .insert(tickets)
      .values({ type: 'customer', title: `Ticket-${suffix()}`, statusId })
      .returning()

    const dto = await ticketRowToDTO(row)
    expect(dto.sla).toBeNull()
  })
})

describe.skipIf(!fixture.available)('recordTicketResolution (real DB, rolled back)', () => {
  beforeEach(() => {
    workspaceHours.schedule = { enabled: false, timezone: 'UTC', intervals: [] }
    return fixture.begin()
  })
  afterEach(fixture.rollback)

  it('records a met resolution inside the deadline (idempotent)', async () => {
    const ticketId = await seedTicket()
    const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 7200 }) // due 12:00
    await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // Closed at 11:00, due 12:00 -> met. A second close must not double-count.
    await recordTicketResolution(ticketId, new Date('2026-01-05T11:00:00Z'))
    await recordTicketResolution(ticketId, new Date('2026-01-05T11:30:00Z'))

    const ttr = (await eventsFor(ticketId)).filter((e) => e.kind.startsWith('time_to_resolve'))
    expect(ttr).toHaveLength(1)
    expect(ttr[0].kind).toBe('time_to_resolve_met')
    expect(ttr[0].meta.overdueSecs).toBe(0)
    expect(ttr[0].conversationId).toBeNull()

    const stamp = await loadStamp(ticketId)
    expect(stamp?.resolvedAt).toBe('2026-01-05T11:00:00.000Z')
  })

  it('records a breached resolution with the overdue seconds', async () => {
    const ticketId = await seedTicket()
    const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 3600 }) // due 11:00
    await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // Closed at 11:10, due 11:00 -> breached by 600s.
    await recordTicketResolution(ticketId, new Date('2026-01-05T11:10:00Z'))
    const event = (await eventsFor(ticketId)).find((e) => e.kind.startsWith('time_to_resolve'))
    expect(event?.kind).toBe('time_to_resolve_breached')
    expect(event?.meta.overdueSecs).toBe(600)

    const stamp = await loadStamp(ticketId)
    expect(stamp?.resolutionBreachedAt).toBe('2026-01-05T11:10:00.000Z')
  })

  it('is a no-op without an applied SLA', async () => {
    const ticketId = await seedTicket()
    await recordTicketResolution(ticketId, new Date('2026-01-05T11:00:00Z'))
    expect(await eventsFor(ticketId)).toHaveLength(0)
  })

  it('first resolution settles permanently — a reopen + re-close never re-arms or re-reports', async () => {
    const ticketId = await seedTicket()
    const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 7200 })
    await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))
    await recordTicketResolution(ticketId, new Date('2026-01-05T11:00:00Z')) // met

    // The ticket reopens (the row's own resolvedAt clears, the stamp's does
    // NOT) and is later closed again: no new settle, no new events.
    await recordTicketResolution(ticketId, new Date('2026-01-06T10:00:00Z'))

    const kinds = (await eventsFor(ticketId)).map((e) => e.kind)
    expect(kinds).toEqual(['applied', 'time_to_resolve_met'])
    const stamp = await loadStamp(ticketId)
    expect(stamp?.resolvedAt).toBe('2026-01-05T11:00:00.000Z')
  })

  it('settle-after-breach logs time_to_resolve_settled_after_breach without a second breach event', async () => {
    const ticketId = await seedTicket()
    const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 3600 }) // due 11:00
    await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // The silent deadline passes; the sweep notes the breach first.
    expect((await sweepOverdueTicketSlaBreaches(new Date('2026-01-05T11:05:00Z'))).recorded).toBe(1)

    // The ticket closes at 11:30: settles the clock, logs the late settle for
    // time-after-miss reporting (overdue by 1800s), no SECOND breach event.
    await recordTicketResolution(ticketId, new Date('2026-01-05T11:30:00Z'))

    const kinds = (await eventsFor(ticketId)).map((e) => e.kind)
    expect(kinds).toEqual([
      'applied',
      'time_to_resolve_breached',
      'time_to_resolve_settled_after_breach',
    ])
    const lateSettle = (await eventsFor(ticketId)).find(
      (e) => e.kind === 'time_to_resolve_settled_after_breach'
    )
    expect(lateSettle?.meta.overdueSecs).toBe(1800)
  })
})

describe.skipIf(!fixture.available)('pause-on-pending (real DB, rolled back)', () => {
  beforeEach(() => {
    workspaceHours.schedule = { enabled: false, timezone: 'UTC', intervals: [] }
    return fixture.begin()
  })
  afterEach(fixture.rollback)

  it('pending then unpending shifts timeToResolveDueAt by the paused duration', async () => {
    const ticketId = await seedTicket()
    const policy = await createSlaPolicy({
      name: 'Pauseable',
      timeToResolveTargetSecs: 4 * 3600, // due 14:00
    })
    await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))

    await pauseTicketSlaOnPending(ticketId, new Date('2026-01-05T10:10:00Z'))
    let stamp = await loadStamp(ticketId)
    expect(stamp?.pausedAt).toBe('2026-01-05T10:10:00.000Z')
    // Deadline untouched while paused.
    expect(stamp?.timeToResolveDueAt).toBe('2026-01-05T14:00:00.000Z')

    // Paused for 30 minutes.
    const resumed = await resumeTicketSlaFromPending(ticketId, new Date('2026-01-05T10:40:00Z'))
    expect(resumed?.timeToResolveDueAt).toBe('2026-01-05T14:30:00.000Z')
    stamp = await loadStamp(ticketId)
    expect(stamp?.pausedAt).toBeNull()
    expect(stamp?.timeToResolveDueAt).toBe('2026-01-05T14:30:00.000Z')

    const events = await eventsFor(ticketId)
    expect(events.find((e) => e.kind === 'paused')).toBeTruthy()
    const resumedEvent = events.find((e) => e.kind === 'resumed')
    expect(resumedEvent?.meta.pausedForSecs).toBe(1800)
    expect(resumedEvent?.conversationId).toBeNull()
  })

  it('pauseOnPending=false leaves the deadline and pausedAt untouched', async () => {
    const ticketId = await seedTicket()
    const policy = await createSlaPolicy({
      name: 'NoPause',
      timeToResolveTargetSecs: 4 * 3600,
      pauseOnPending: false,
    })
    await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))

    await pauseTicketSlaOnPending(ticketId, new Date('2026-01-05T10:10:00Z'))
    let stamp = await loadStamp(ticketId)
    expect(stamp?.pausedAt).toBeFalsy()
    expect(stamp?.timeToResolveDueAt).toBe('2026-01-05T14:00:00.000Z')

    await resumeTicketSlaFromPending(ticketId, new Date('2026-01-05T10:40:00Z'))
    stamp = await loadStamp(ticketId)
    expect(stamp?.timeToResolveDueAt).toBe('2026-01-05T14:00:00.000Z')

    const events = await eventsFor(ticketId)
    expect(events.some((e) => e.kind === 'paused' || e.kind === 'resumed')).toBe(false)
  })

  it('settle-while-pending excludes the elapsed pause up to the settle moment', async () => {
    const ticketId = await seedTicket()
    const policy = await createSlaPolicy({ name: 'MidPause', timeToResolveTargetSecs: 3600 }) // due 11:00
    await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // Pending at 10:10, still pending when the ticket closes at 11:20.
    await pauseTicketSlaOnPending(ticketId, new Date('2026-01-05T10:10:00Z'))
    // Elapsed pause so far: 11:20 - 10:10 = 70 min. Effective due = 11:00 + 70min = 12:10.
    // A close at 11:20 is inside that shifted deadline -> met, not breached.
    await recordTicketResolution(ticketId, new Date('2026-01-05T11:20:00Z'))

    const event = (await eventsFor(ticketId)).find((e) => e.kind.startsWith('time_to_resolve'))
    expect(event?.kind).toBe('time_to_resolve_met')
    expect(event?.meta.dueAt).toBe('2026-01-05T12:10:00.000Z')

    // Still pending: pausedAt survives the settle, and the outcome is stamped.
    const stamp = await loadStamp(ticketId)
    expect(stamp?.pausedAt).toBe('2026-01-05T10:10:00.000Z')
    expect(stamp?.resolvedAt).toBe('2026-01-05T11:20:00.000Z')
  })

  it('double pending cycles accumulate the shift; a settled deadline is never shifted', async () => {
    const ticketId = await seedTicket()
    const policy = await createSlaPolicy({ name: 'DoubleCycle', timeToResolveTargetSecs: 3600 }) // due 11:00
    await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // Cycle 1: paused 10 minutes. Cycle 2: paused 30 minutes.
    await pauseTicketSlaOnPending(ticketId, new Date('2026-01-05T10:10:00Z'))
    await resumeTicketSlaFromPending(ticketId, new Date('2026-01-05T10:20:00Z'))
    await pauseTicketSlaOnPending(ticketId, new Date('2026-01-05T11:00:00Z'))
    await resumeTicketSlaFromPending(ticketId, new Date('2026-01-05T11:30:00Z'))

    const stamp = await loadStamp(ticketId)
    // Cumulative shift: 10 + 30 = 40 minutes.
    expect(stamp?.timeToResolveDueAt).toBe('2026-01-05T11:40:00.000Z')
    expect((await eventsFor(ticketId)).filter((e) => e.kind === 'paused')).toHaveLength(2)
  })

  it('is a no-op when no SLA is applied', async () => {
    const ticketId = await seedTicket()
    await pauseTicketSlaOnPending(ticketId, new Date('2026-01-05T10:10:00Z'))
    await resumeTicketSlaFromPending(ticketId, new Date('2026-01-05T10:40:00Z'))
    expect(await eventsFor(ticketId)).toHaveLength(0)
    expect(await loadStamp(ticketId)).toBeNull()
  })
})

describe.skipIf(!fixture.available)('sweepOverdueTicketSlaBreaches (real DB, rolled back)', () => {
  beforeEach(() => {
    workspaceHours.schedule = { enabled: false, timezone: 'UTC', intervals: [] }
    return fixture.begin()
  })
  afterEach(fixture.rollback)

  it('records an overdue, unsettled TTR deadline exactly once (a repeat sweep is a no-op)', async () => {
    const ticketId = await seedTicket()
    const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 3600 }) // due 11:00
    await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))

    // Due 11:00, no close. Sweep at 11:05 -> one breach event, ticket-anchored.
    const first = await sweepOverdueTicketSlaBreaches(new Date('2026-01-05T11:05:00Z'))
    expect(first.recorded).toBe(1)
    let events = (await eventsFor(ticketId)).filter((e) => e.kind !== 'applied')
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('time_to_resolve_breached')
    expect(events[0].conversationId).toBeNull()
    expect(events[0].meta.overdueSecs).toBe(300)

    // Sweeping again (and again later) must not duplicate the event.
    expect((await sweepOverdueTicketSlaBreaches(new Date('2026-01-05T11:06:00Z'))).recorded).toBe(0)
    expect((await sweepOverdueTicketSlaBreaches(new Date('2026-01-05T12:00:00Z'))).recorded).toBe(0)
    events = (await eventsFor(ticketId)).filter((e) => e.kind !== 'applied')
    expect(events).toHaveLength(1)
  })

  it('leaves not-yet-due and settled clocks untouched', async () => {
    const notDue = await seedTicket()
    const settled = await seedTicket()
    const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 3600 })
    await applySlaToTicket(notDue, policy.id, new Date('2026-01-05T10:00:00Z'))
    await applySlaToTicket(settled, policy.id, new Date('2026-01-05T10:00:00Z'))
    await recordTicketResolution(settled, new Date('2026-01-05T10:30:00Z'))

    expect((await sweepOverdueTicketSlaBreaches(new Date('2026-01-05T10:45:00Z'))).recorded).toBe(0)
    expect((await sweepOverdueTicketSlaBreaches(new Date('2026-01-05T11:30:00Z'))).recorded).toBe(1)
    const settledKinds = (await eventsFor(settled)).map((e) => e.kind)
    expect(settledKinds.sort()).toEqual(['applied', 'time_to_resolve_met'])
  })

  it('does not breach a clock that is currently paused (pending under pauseOnPending)', async () => {
    const ticketId = await seedTicket()
    const policy = await createSlaPolicy({ name: 'Paused', timeToResolveTargetSecs: 3600 })
    await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))
    await pauseTicketSlaOnPending(ticketId, new Date('2026-01-05T10:30:00Z'))

    // The stamped due date (11:00) has passed, but the clock is paused.
    expect((await sweepOverdueTicketSlaBreaches(new Date('2026-01-05T11:05:00Z'))).recorded).toBe(0)
    expect((await sweepOverdueTicketSlaBreaches(new Date('2026-01-06T10:00:00Z'))).recorded).toBe(0)
    const kinds = (await eventsFor(ticketId)).map((e) => e.kind)
    expect(kinds).toEqual(['applied', 'paused'])
  })

  it('after a resume, breaches against the pause-shifted deadline, not the original one', async () => {
    const ticketId = await seedTicket()
    const policy = await createSlaPolicy({ name: 'Shifted', timeToResolveTargetSecs: 3600 })
    await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))
    // Paused 10:30 -> 11:30 (1h): due shifts from 11:00 to 12:00 on resume.
    await pauseTicketSlaOnPending(ticketId, new Date('2026-01-05T10:30:00Z'))
    await resumeTicketSlaFromPending(ticketId, new Date('2026-01-05T11:30:00Z'))

    // Past the original 11:00 but inside the shifted 12:00 -> not a breach.
    expect((await sweepOverdueTicketSlaBreaches(new Date('2026-01-05T11:45:00Z'))).recorded).toBe(0)
    // Past the shifted deadline -> breaches, judged against 12:00.
    expect((await sweepOverdueTicketSlaBreaches(new Date('2026-01-05T12:05:00Z'))).recorded).toBe(1)
    const breach = (await eventsFor(ticketId)).find((e) => e.kind === 'time_to_resolve_breached')
    expect(breach?.meta.dueAt).toBe('2026-01-05T12:00:00.000Z')
  })
})
