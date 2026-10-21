/**
 * Real-DB coverage for a due date given at creation (`createTicket` ->
 * `createTicketCore`): the date is stored with its alert markers, the
 * `ticket.created` activity row carries it, and the team window applies to a
 * teammate or integration filing the ticket. The requester's own create path
 * (customer window) is covered in requester.service.test.ts. Runs inside the
 * db-test-fixture rollback transaction.
 *
 * Actors are backed by real principal rows: the activity insert carries an FK
 * to principal, and the creator becomes the default assignee.
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
  and,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// Keep ticket.created out of the real event pipeline mid-rollback; assert it fires.
const emitTicketCreated = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../ticket.webhooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ticket.webhooks')>()),
  emitTicketCreated,
}))

const realtime = vi.hoisted(() => ({ publishTicketEvent: vi.fn() }))
vi.mock('@/lib/server/realtime/conversation-channels', () => realtime)

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

import { createTicket } from '../ticket.service'
import { ValidationError } from '@/lib/shared/errors'
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
const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
/** A minute-aligned instant `offsetMs` from now (the window check uses the real clock). */
const fromNow = (offsetMs: number) => {
  const d = new Date(Date.now() + offsetMs)
  d.setSeconds(0, 0)
  return d
}

async function adminActor(): Promise<Actor> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Agent-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return {
    principalId,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: resolveActorPermissions('admin'),
  }
}

/** A settings row (stage labels) and a deterministic default open status. */
async function seedWorkspace() {
  await testDb
    .insert(settings)
    .values({ name: 'Test WS', slug: `test_${suffix()}`, createdAt: new Date() })
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  await testDb.insert(ticketStatuses).values({
    name: 'C-Open',
    slug: `c_open_${suffix()}`,
    category: 'open',
    position: 100,
    isDefault: true,
    publicStage: 'received',
  })
}

async function readTicket(id: TicketId) {
  const [row] = await testDb.select().from(tickets).where(eq(tickets.id, id)).limit(1)
  return row
}

async function createdActivity(id: TicketId) {
  const [row] = await testDb
    .select()
    .from(ticketActivity)
    .where(and(eq(ticketActivity.ticketId, id), eq(ticketActivity.type, 'ticket.created')))
  return row
}

describe.skipIf(!fixture.available)('createTicket with a due date (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  beforeEach(() => emitTicketCreated.mockClear())
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('stores dueAt and puts it in the ticket.created activity metadata', async () => {
    await seedWorkspace()
    const actor = await adminActor()
    const due = fromNow(3 * DAY)

    const dto = await createTicket(
      { type: 'back_office', title: 'Quarterly audit', dueAt: due },
      actor
    )

    expect(dto.dueAt).toBe(due.toISOString())
    const row = await readTicket(dto.id)
    expect(row.dueAt?.getTime()).toBe(due.getTime())
    // A date beyond the soon window arms both alerts, even for the assignee.
    expect(row.dueSoonNotifiedFor).toBeNull()
    expect(row.overdueNotifiedFor).toBeNull()

    const activity = await createdActivity(dto.id)
    expect(activity.metadata).toEqual({ ticketType: 'back_office', dueAt: due.toISOString() })
    expect(emitTicketCreated).toHaveBeenCalledTimes(1)
    expect(emitTicketCreated.mock.calls[0][1].dueAt?.getTime()).toBe(due.getTime())
  })

  it('leaves dueAt out of the activity metadata when none is given', async () => {
    await seedWorkspace()
    const actor = await adminActor()

    const dto = await createTicket({ type: 'back_office', title: 'No date' }, actor)

    expect(dto.dueAt).toBeNull()
    expect((await readTicket(dto.id)).dueAt).toBeNull()
    expect((await createdActivity(dto.id)).metadata).toEqual({ ticketType: 'back_office' })
  })

  it('skips only the due-soon alert when the creator (default assignee) picks a near-term date', async () => {
    await seedWorkspace()
    const actor = await adminActor()
    const soon = fromNow(2 * HOUR)

    const dto = await createTicket({ type: 'back_office', title: 'Today', dueAt: soon }, actor)

    const row = await readTicket(dto.id)
    expect(row.assigneePrincipalId).toBe(actor.principalId)
    expect(row.dueSoonNotifiedFor?.getTime()).toBe(soon.getTime())
    expect(row.overdueNotifiedFor).toBeNull()
  })

  it('lets a teammate record a past date (team window) with both alerts suppressed', async () => {
    await seedWorkspace()
    const actor = await adminActor()
    const past = fromNow(-2 * DAY)

    const dto = await createTicket({ type: 'back_office', title: 'Backfill', dueAt: past }, actor)

    const row = await readTicket(dto.id)
    expect(row.dueAt?.getTime()).toBe(past.getTime())
    expect(row.dueSoonNotifiedFor?.getTime()).toBe(past.getTime())
    expect(row.overdueNotifiedFor?.getTime()).toBe(past.getTime())
  })

  it('rejects a date outside the team window before creating anything', async () => {
    await seedWorkspace()
    const actor = await adminActor()

    const err = await createTicket(
      { type: 'back_office', title: 'Too far', dueAt: fromNow(6 * 365 * DAY) },
      actor
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ValidationError)
    expect(err).toMatchObject({ code: 'INVALID_DUE_DATE' })
    expect(emitTicketCreated).not.toHaveBeenCalled()
  })
})
