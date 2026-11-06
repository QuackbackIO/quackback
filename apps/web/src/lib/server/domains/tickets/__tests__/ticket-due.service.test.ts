/**
 * Real-DB coverage for `setTicketDueAt`, the one write path for a ticket's
 * shared due date after creation: set, move and clear each record a
 * `due.changed` activity row with from/to, fire `ticket.due_changed` and
 * publish the realtime update; a no-op re-set touches nothing; the alert
 * markers re-arm per `dueAlertMarkersOnSet`; the first-response stamp lands;
 * out-of-window dates and invisible tickets are refused. Runs inside the
 * db-test-fixture rollback transaction.
 *
 * Every actor is backed by a real principal row: the activity insert carries
 * an FK to principal, and a failing statement would abort the fixture's
 * transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId, type TicketId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  tickets,
  ticketStatuses,
  ticketActivity,
  principal,
  user,
  settings,
  eq,
  PERMISSIONS,
  type PermissionKey,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// The event seam: assert ticket.due_changed goes out with the right payload
// without resolving webhook targets mid-rollback.
const dispatch = vi.hoisted(() => ({
  dispatchTicketDueChanged: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/events/dispatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/events/dispatch')>()),
  ...dispatch,
}))

// Realtime publish: neutralize the Postgres-backed publish, assert the wiring.
const realtime = vi.hoisted(() => ({ publishTicketEvent: vi.fn() }))
vi.mock('@/lib/server/realtime/conversation-channels', () => realtime)

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

import { setTicketDueAt } from '../ticket-due.service'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import type { Actor } from '@/lib/server/policy/types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: ticketActivity.id }).from(ticketActivity).limit(0)
    await db.select({ id: settings.id }).from(settings).limit(0)
  },
})

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = new Date('2026-10-14T12:00:00.000Z')
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs)

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedTeammate(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  const displayName = `Agent-${suffix()}`
  await testDb.insert(user).values({ id: userId, name: displayName })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'member',
    type: 'user',
    displayName,
    createdAt: new Date(),
  })
  return principalId
}

async function adminActor(): Promise<Actor> {
  return {
    principalId: await seedTeammate(),
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: resolveActorPermissions('admin'),
  }
}

/** A workspace settings row (stage labels) and one open status; returns the status id. */
async function seedWorkspace() {
  await testDb
    .insert(settings)
    .values({ name: 'Test WS', slug: `test_${suffix()}`, createdAt: new Date() })
  const [open] = await testDb
    .insert(ticketStatuses)
    .values({
      name: 'D-Open',
      slug: `d_open_${suffix()}`,
      category: 'open',
      position: 100,
      publicStage: 'received',
    })
    .returning()
  return open.id
}

async function seedTicket(values: Partial<typeof tickets.$inferInsert> = {}) {
  const statusId = await seedWorkspace()
  const [row] = await testDb
    .insert(tickets)
    .values({ title: 'Needs a date', statusId, ...values })
    .returning()
  return row.id as TicketId
}

async function readTicket(id: TicketId) {
  const [row] = await testDb.select().from(tickets).where(eq(tickets.id, id)).limit(1)
  return row
}

async function dueActivity(id: TicketId) {
  const rows = await testDb
    .select()
    .from(ticketActivity)
    .where(eq(ticketActivity.ticketId, id))
    .orderBy(ticketActivity.id)
  return rows.filter((r) => r.type === 'due.changed')
}

describe.skipIf(!fixture.available)('ticket-due.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  beforeEach(() => {
    dispatch.dispatchTicketDueChanged.mockClear()
    realtime.publishTicketEvent.mockClear()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('sets a due date: writes it, records from/to, emits the event and publishes', async () => {
    const actor = await adminActor()
    const id = await seedTicket()
    const due = at(3 * DAY)

    const dto = await setTicketDueAt(id, due, actor, { now: NOW })

    expect(dto.dueAt).toBe(due.toISOString())
    const row = await readTicket(id)
    expect(row.dueAt?.getTime()).toBe(due.getTime())
    expect(row.updatedAt.getTime()).toBe(NOW.getTime())

    const activity = await dueActivity(id)
    expect(activity).toHaveLength(1)
    expect(activity[0].principalId).toBe(actor.principalId)
    expect(activity[0].metadata).toEqual({ from: null, to: due.toISOString() })

    expect(dispatch.dispatchTicketDueChanged).toHaveBeenCalledTimes(1)
    const [eventActor, ref, title, dueAt, previousDueAt] =
      dispatch.dispatchTicketDueChanged.mock.calls[0]
    expect(eventActor).toEqual({ type: 'user', principalId: actor.principalId })
    expect(ref).toMatchObject({ id, dueAt: due.toISOString() })
    expect(title).toBe('Needs a date')
    expect(dueAt).toBe(due.toISOString())
    expect(previousDueAt).toBeNull()

    expect(realtime.publishTicketEvent).toHaveBeenCalledWith(id, {
      kind: 'ticket_updated',
      ticket: expect.objectContaining({ id, dueAt: due.toISOString() }),
    })
  })

  it('moves a due date: records the previous value as from', async () => {
    const actor = await adminActor()
    const before = at(2 * DAY)
    const after = at(5 * DAY)
    const id = await seedTicket({ dueAt: before })

    await setTicketDueAt(id, after, actor, { now: NOW })

    expect((await readTicket(id)).dueAt?.getTime()).toBe(after.getTime())
    const [activity] = await dueActivity(id)
    expect(activity.metadata).toEqual({ from: before.toISOString(), to: after.toISOString() })
    const call = dispatch.dispatchTicketDueChanged.mock.calls[0]
    expect(call[3]).toBe(after.toISOString())
    expect(call[4]).toBe(before.toISOString())
  })

  it('clears a due date with null: records to null and clears both markers', async () => {
    const actor = await adminActor()
    const before = at(2 * DAY)
    const id = await seedTicket({
      dueAt: before,
      dueSoonNotifiedFor: before,
      overdueNotifiedFor: before,
    })

    const dto = await setTicketDueAt(id, null, actor, { now: NOW })

    expect(dto.dueAt).toBeNull()
    const row = await readTicket(id)
    expect(row.dueAt).toBeNull()
    expect(row.dueSoonNotifiedFor).toBeNull()
    expect(row.overdueNotifiedFor).toBeNull()
    const [activity] = await dueActivity(id)
    expect(activity.metadata).toEqual({ from: before.toISOString(), to: null })
    expect(dispatch.dispatchTicketDueChanged.mock.calls[0][3]).toBeNull()
    expect(realtime.publishTicketEvent).toHaveBeenCalledTimes(1)
  })

  it('re-setting the same instant writes, records, emits and publishes nothing', async () => {
    const actor = await adminActor()
    const due = at(3 * DAY)
    const updatedAt = new Date('2026-10-01T00:00:00.000Z')
    const id = await seedTicket({ dueAt: due, updatedAt })

    // A different Date object for the same instant still counts as unchanged.
    const dto = await setTicketDueAt(id, new Date(due.getTime()), actor, { now: NOW })

    expect(dto.dueAt).toBe(due.toISOString())
    expect((await readTicket(id)).updatedAt.getTime()).toBe(updatedAt.getTime())
    expect(await dueActivity(id)).toEqual([])
    expect(dispatch.dispatchTicketDueChanged).not.toHaveBeenCalled()
    expect(realtime.publishTicketEvent).not.toHaveBeenCalled()
  })

  it('clearing a ticket that has no due date is a no-op too', async () => {
    const actor = await adminActor()
    const id = await seedTicket()

    await setTicketDueAt(id, null, actor, { now: NOW })

    expect(await dueActivity(id)).toEqual([])
    expect(dispatch.dispatchTicketDueChanged).not.toHaveBeenCalled()
    expect(realtime.publishTicketEvent).not.toHaveBeenCalled()
  })

  it('stamps firstResponseAt when a teammate sets the first due date', async () => {
    const actor = await adminActor()
    const id = await seedTicket()

    await setTicketDueAt(id, at(DAY * 2), actor, { now: NOW })

    expect((await readTicket(id)).firstResponseAt?.getTime()).toBe(NOW.getTime())
  })

  it('keeps an existing firstResponseAt', async () => {
    const actor = await adminActor()
    const firstResponseAt = new Date('2026-10-10T09:00:00.000Z')
    const id = await seedTicket({ firstResponseAt })

    await setTicketDueAt(id, at(DAY * 2), actor, { now: NOW })

    expect((await readTicket(id)).firstResponseAt?.getTime()).toBe(firstResponseAt.getTime())
  })

  describe('alert markers', () => {
    it('re-arms both alerts when a previously alerted date moves', async () => {
      const actor = await adminActor()
      const old = at(-HOUR)
      const id = await seedTicket({ dueAt: old, dueSoonNotifiedFor: old, overdueNotifiedFor: old })

      await setTicketDueAt(id, at(3 * DAY), actor, { now: NOW })

      const row = await readTicket(id)
      expect(row.dueSoonNotifiedFor).toBeNull()
      expect(row.overdueNotifiedFor).toBeNull()
    })

    it('suppresses both alerts for a date already in the past', async () => {
      const actor = await adminActor()
      const id = await seedTicket()
      const past = at(-2 * DAY)

      await setTicketDueAt(id, past, actor, { now: NOW })

      const row = await readTicket(id)
      expect(row.dueSoonNotifiedFor?.getTime()).toBe(past.getTime())
      expect(row.overdueNotifiedFor?.getTime()).toBe(past.getTime())
    })

    it('skips only due-soon when the assignee sets a near-term date on their own ticket', async () => {
      const actor = await adminActor()
      const id = await seedTicket({ assigneePrincipalId: actor.principalId as PrincipalId })
      const soon = at(2 * HOUR)

      await setTicketDueAt(id, soon, actor, { now: NOW })

      const row = await readTicket(id)
      expect(row.dueSoonNotifiedFor?.getTime()).toBe(soon.getTime())
      expect(row.overdueNotifiedFor).toBeNull()
    })

    it('arms both alerts when someone other than the assignee sets a near-term date', async () => {
      const actor = await adminActor()
      const id = await seedTicket({ assigneePrincipalId: await seedTeammate() })

      await setTicketDueAt(id, at(2 * HOUR), actor, { now: NOW })

      const row = await readTicket(id)
      expect(row.dueSoonNotifiedFor).toBeNull()
      expect(row.overdueNotifiedFor).toBeNull()
    })
  })

  describe('refusals', () => {
    it('rejects a date outside the team window with INVALID_DUE_DATE and writes nothing', async () => {
      const actor = await adminActor()
      const id = await seedTicket()

      for (const bad of [at(5 * 365 * DAY + 1), at(-365 * DAY - 1)]) {
        const err = await setTicketDueAt(id, bad, actor, { now: NOW }).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(ValidationError)
        expect(err).toMatchObject({ code: 'INVALID_DUE_DATE' })
      }
      expect((await readTicket(id)).dueAt).toBeNull()
      expect(await dueActivity(id)).toEqual([])
      expect(dispatch.dispatchTicketDueChanged).not.toHaveBeenCalled()
    })

    it('404s a member who holds the permission but cannot see the ticket', async () => {
      const id = await seedTicket({ assigneePrincipalId: await seedTeammate() })
      const member: Actor = {
        principalId: await seedTeammate(),
        role: 'member',
        principalType: 'user',
        segmentIds: new Set(),
        permissions: new Set<PermissionKey>([
          PERMISSIONS.TICKET_VIEW,
          PERMISSIONS.TICKET_SET_STATUS,
        ]),
      }

      await expect(setTicketDueAt(id, at(DAY), member, { now: NOW })).rejects.toThrow(NotFoundError)
      expect((await readTicket(id)).dueAt).toBeNull()
    })

    it('lets the same member set the date on a ticket assigned to them', async () => {
      const memberId = await seedTeammate()
      const id = await seedTicket({ assigneePrincipalId: memberId })
      const member: Actor = {
        principalId: memberId,
        role: 'member',
        principalType: 'user',
        segmentIds: new Set(),
        permissions: new Set<PermissionKey>([
          PERMISSIONS.TICKET_VIEW,
          PERMISSIONS.TICKET_SET_STATUS,
        ]),
      }

      const dto = await setTicketDueAt(id, at(3 * DAY), member, { now: NOW })
      expect(dto.dueAt).toBe(at(3 * DAY).toISOString())
    })

    it('404s a soft-deleted ticket', async () => {
      const actor = await adminActor()
      const id = await seedTicket({ deletedAt: new Date('2026-10-01T00:00:00.000Z') })

      await expect(setTicketDueAt(id, at(DAY), actor, { now: NOW })).rejects.toThrow(NotFoundError)
    })
  })
})
