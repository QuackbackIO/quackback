/**
 * Real-DB coverage for the ticket due-date alert sweep (ticket-due.sweep.ts):
 * one due-soon and one overdue alert per due date, re-armed by a date change,
 * claim-after-enqueue (a failed dispatch leaves the marker for the next
 * tick), the closed-category gap claimed silently, the claim never touching
 * `updated_at`, and the deadline provider going quiet once every alert has
 * fired. Runs inside the db-test-fixture rollback transaction; only the two
 * dispatchers are mocked.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type TicketId, type TicketStatusId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const dispatch = vi.hoisted(() => ({
  dispatchTicketDueSoon: vi.fn(),
  dispatchTicketOverdue: vi.fn(),
}))
vi.mock('@/lib/server/events/dispatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/events/dispatch')>()),
  ...dispatch,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { tickets, ticketStatuses, eq, sql } from '@/lib/server/db'
import {
  dueAlertEventId,
  dueAlertPendingSql,
  nextTicketDueAlertAt,
  sweepTicketDueAlerts,
} from '../ticket-due.sweep'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: tickets.id, a: tickets.dueSoonNotifiedFor, b: tickets.overdueNotifiedFor })
      .from(tickets)
      .limit(0)
  },
})

const HOUR = 60 * 60 * 1000
const NOW = new Date('2026-10-14T12:00:00.000Z')
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z')
const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedStatus(category: 'open' | 'closed'): Promise<TicketStatusId> {
  const id = createId('ticket_status') as TicketStatusId
  await testDb
    .insert(ticketStatuses)
    .values({ id, name: category, slug: `due-${category}-${suffix()}`, category })
  return id
}

async function seedTicket(dueAt: Date | null, category: 'open' | 'closed' = 'open') {
  const id = createId('ticket') as TicketId
  await testDb.insert(tickets).values({
    id,
    title: 'Renew the contract',
    statusId: await seedStatus(category),
    priority: 'high',
    dueAt,
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
  })
  return id
}

async function markers(id: TicketId) {
  const [row] = await testDb
    .select({
      dueAt: tickets.dueAt,
      dueSoon: tickets.dueSoonNotifiedFor,
      overdue: tickets.overdueNotifiedFor,
      updatedAt: tickets.updatedAt,
    })
    .from(tickets)
    .where(eq(tickets.id, id))
  return row
}

const sweep = (id: TicketId, at: Date = NOW) => sweepTicketDueAlerts(at, [id])

describe.skipIf(!fixture.available)('ticket due-date alert sweep (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    dispatch.dispatchTicketDueSoon.mockReset().mockResolvedValue(undefined)
    dispatch.dispatchTicketOverdue.mockReset().mockResolvedValue(undefined)
    // Park every other pending ticket in the shared test DB (rolled back with
    // the rest), so the unscoped deadline provider sees only this test's rows.
    await testDb.update(tickets).set({ deletedAt: NOW }).where(dueAlertPendingSql())
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('sends one due-soon and then one overdue alert per due date', async () => {
    const dueAt = new Date(NOW.getTime() + 2 * HOUR)
    const id = await seedTicket(dueAt)
    const iso = dueAt.toISOString()

    expect(await sweep(id)).toEqual({ dueSoon: 1, overdue: 0, silenced: 0 })
    expect(dispatch.dispatchTicketDueSoon).toHaveBeenCalledExactlyOnceWith(
      dueAlertEventId('due_soon', id, iso),
      {
        ticket: expect.objectContaining({ id, priority: 'high', dueAt: iso }),
        title: 'Renew the contract',
        dueAt: iso,
      }
    )
    expect(dueAlertEventId('due_soon', id, iso)).toBe(`timer:ticket.due_soon:${id}:${iso}`)
    expect((await markers(id)).dueSoon?.toISOString()).toBe(iso)

    // A repeat tick inside the window sends nothing more.
    expect(await sweep(id, new Date(NOW.getTime() + HOUR))).toEqual({
      dueSoon: 0,
      overdue: 0,
      silenced: 0,
    })
    expect(dispatch.dispatchTicketDueSoon).toHaveBeenCalledTimes(1)
    expect(await nextTicketDueAlertAt()).toEqual(dueAt)

    const after = new Date(dueAt.getTime() + 60_000)
    expect(await sweep(id, after)).toEqual({ dueSoon: 0, overdue: 1, silenced: 0 })
    expect(dispatch.dispatchTicketOverdue).toHaveBeenCalledExactlyOnceWith(
      dueAlertEventId('overdue', id, iso),
      expect.objectContaining({ title: 'Renew the contract', dueAt: iso })
    )
    expect(await sweep(id, new Date(after.getTime() + HOUR))).toEqual({
      dueSoon: 0,
      overdue: 0,
      silenced: 0,
    })
    expect(dispatch.dispatchTicketOverdue).toHaveBeenCalledTimes(1)
    const m = await markers(id)
    expect([m.dueSoon?.toISOString(), m.overdue?.toISOString()]).toEqual([iso, iso])
  })

  it('sends only the overdue alert for a ticket first seen past its due date', async () => {
    const dueAt = new Date(NOW.getTime() - HOUR)
    const id = await seedTicket(dueAt)
    expect(await sweep(id)).toEqual({ dueSoon: 0, overdue: 1, silenced: 0 })
    expect(dispatch.dispatchTicketDueSoon).not.toHaveBeenCalled()
    expect((await markers(id)).dueSoon?.toISOString()).toBe(dueAt.toISOString())
  })

  it('re-arms both alerts when the due date moves', async () => {
    const first = new Date(NOW.getTime() + 2 * HOUR)
    const id = await seedTicket(first)
    await sweep(id)
    expect(dispatch.dispatchTicketDueSoon).toHaveBeenCalledTimes(1)

    const moved = new Date(NOW.getTime() + 5 * HOUR)
    await testDb.update(tickets).set({ dueAt: moved }).where(eq(tickets.id, id))
    expect(await nextTicketDueAlertAt()).toEqual(new Date(moved.getTime() - 24 * HOUR))
    expect(await sweep(id)).toEqual({ dueSoon: 1, overdue: 0, silenced: 0 })
    expect(dispatch.dispatchTicketDueSoon).toHaveBeenLastCalledWith(
      dueAlertEventId('due_soon', id, moved.toISOString()),
      expect.objectContaining({ dueAt: moved.toISOString() })
    )
  })

  it('leaves the marker unclaimed when the dispatch fails, and retries next tick', async () => {
    const dueAt = new Date(NOW.getTime() + 2 * HOUR)
    const id = await seedTicket(dueAt)
    dispatch.dispatchTicketDueSoon.mockRejectedValueOnce(new Error('outbox down'))

    expect(await sweep(id)).toEqual({ dueSoon: 0, overdue: 0, silenced: 0 })
    expect((await markers(id)).dueSoon).toBeNull()
    // Still due: the provider keeps the sweep awake for the retry.
    expect(await nextTicketDueAlertAt()).toEqual(new Date(dueAt.getTime() - 24 * HOUR))

    expect(await sweep(id)).toEqual({ dueSoon: 1, overdue: 0, silenced: 0 })
    expect(dispatch.dispatchTicketDueSoon).toHaveBeenCalledTimes(2)
    expect((await markers(id)).dueSoon?.toISOString()).toBe(dueAt.toISOString())
  })

  it('does not claim a date that moved between the scan and the claim', async () => {
    const dueAt = new Date(NOW.getTime() - HOUR)
    const moved = new Date(NOW.getTime() + 3 * 24 * HOUR)
    const id = await seedTicket(dueAt)
    dispatch.dispatchTicketOverdue.mockImplementationOnce(async () => {
      await testDb.update(tickets).set({ dueAt: moved }).where(eq(tickets.id, id))
    })

    expect(await sweep(id)).toEqual({ dueSoon: 0, overdue: 0, silenced: 0 })
    const m = await markers(id)
    expect([m.dueSoon, m.overdue]).toEqual([null, null])
  })

  it('claims a closed-category ticket silently (resolved_at never stamped)', async () => {
    const dueAt = new Date(NOW.getTime() - HOUR)
    const id = await seedTicket(dueAt, 'closed')

    expect(await sweep(id)).toEqual({ dueSoon: 0, overdue: 0, silenced: 1 })
    expect(dispatch.dispatchTicketDueSoon).not.toHaveBeenCalled()
    expect(dispatch.dispatchTicketOverdue).not.toHaveBeenCalled()
    const m = await markers(id)
    expect([m.dueSoon?.toISOString(), m.overdue?.toISOString()]).toEqual([
      dueAt.toISOString(),
      dueAt.toISOString(),
    ])
    expect(await nextTicketDueAlertAt()).toBeNull()
  })

  it('never changes updated_at when it claims', async () => {
    const soon = await seedTicket(new Date(NOW.getTime() + HOUR))
    const late = await seedTicket(new Date(NOW.getTime() - HOUR))
    const closed = await seedTicket(new Date(NOW.getTime() - HOUR), 'closed')
    await sweepTicketDueAlerts(NOW, [soon, late, closed])
    for (const id of [soon, late, closed]) {
      const m = await markers(id)
      expect(m.dueSoon).not.toBeNull()
      expect(m.updatedAt).toEqual(LONG_AGO)
    }
  })

  it('skips resolved, deleted and undated tickets', async () => {
    const resolved = await seedTicket(new Date(NOW.getTime() - HOUR))
    await testDb.update(tickets).set({ resolvedAt: NOW }).where(eq(tickets.id, resolved))
    const deleted = await seedTicket(new Date(NOW.getTime() - HOUR))
    await testDb.update(tickets).set({ deletedAt: NOW }).where(eq(tickets.id, deleted))
    const undated = await seedTicket(null)

    expect(await sweepTicketDueAlerts(NOW, [resolved, deleted, undated])).toEqual({
      dueSoon: 0,
      overdue: 0,
      silenced: 0,
    })
    expect(dispatch.dispatchTicketOverdue).not.toHaveBeenCalled()
    expect(await nextTicketDueAlertAt()).toBeNull()
  })

  it('reports no deadline when idle, and the next instant otherwise', async () => {
    expect(await nextTicketDueAlertAt()).toBeNull()

    const far = new Date(NOW.getTime() + 10 * 24 * HOUR)
    const id = await seedTicket(far)
    expect(await nextTicketDueAlertAt()).toEqual(new Date(far.getTime() - 24 * HOUR))

    // An assignee who set a near date on their own ticket already holds the
    // due-soon marker, so only the overdue instant is left.
    await testDb.update(tickets).set({ dueSoonNotifiedFor: far }).where(eq(tickets.id, id))
    expect(await nextTicketDueAlertAt()).toEqual(far)

    await testDb.update(tickets).set({ overdueNotifiedFor: far }).where(eq(tickets.id, id))
    expect(await nextTicketDueAlertAt()).toBeNull()
  })

  it('compares the claim at millisecond precision for a due date stored with microseconds', async () => {
    const id = await seedTicket(null)
    await testDb
      .update(tickets)
      .set({ dueAt: sql`'2026-10-14T11:00:00.123456Z'::timestamptz` })
      .where(eq(tickets.id, id))

    expect(await sweep(id)).toEqual({ dueSoon: 0, overdue: 1, silenced: 0 })
    expect(await sweep(id)).toEqual({ dueSoon: 0, overdue: 0, silenced: 0 })
    expect(dispatch.dispatchTicketOverdue).toHaveBeenCalledTimes(1)
  })
})
