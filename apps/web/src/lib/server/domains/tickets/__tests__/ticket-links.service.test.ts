/**
 * Real-DB coverage for the tracker-link service (support platform §4.9): a
 * tracker groups customer tickets it "tracks"; linking validates the two types,
 * is one-tracker-per-customer-ticket, idempotent on a same-tracker re-link, and
 * records a team-only 'ticket_linked' note. Runs inside the fixture rollback.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import {
  createId,
  type PrincipalId,
  type TicketId,
  type TicketStatusId,
  type UserId,
} from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  tickets,
  ticketStatuses,
  settings,
  ticketLinks,
  user,
  principal,
  eq,
  and,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// Neutralize the fire-and-forget webhook bridge (createTicket emits ticket.created).
vi.mock('../ticket.webhooks', () => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
}))

// Neutralize the real Redis-backed realtime publish (unified inbox §3.2, M3):
// createTicket/setTicketStatus now fire it too, and this suite isn't
// exercising that behavior.
vi.mock('@/lib/server/realtime/conversation-channels', () => ({ publishTicketEvent: vi.fn() }))

import { createTicket, setTicketStatus } from '../ticket.service'
import {
  linkTicketToTracker,
  unlinkTicketFromTracker,
  listLinkedTicketIds,
  listLinkedTickets,
  getTrackerForTicket,
} from '../ticket-links.service'
import { listTicketMessages } from '../ticket-message.service'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import type { Actor } from '@/lib/server/policy/types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: ticketLinks.trackerTicketId }).from(ticketLinks).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/** Seed a real user+principal (the link stores linked_by_principal_id, an FK). */
async function seedActor(): Promise<Actor> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Agent-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return {
    principalId,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: resolveActorPermissions('admin'),
  }
}

async function seedSettings(): Promise<void> {
  await testDb
    .insert(settings)
    .values({ name: 'Test WS', slug: `test_${suffix()}`, createdAt: new Date() })
}

async function seedDefaultStatus() {
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  const [open] = await testDb
    .insert(ticketStatuses)
    .values({
      name: 'T-Open',
      slug: `t_open_${suffix()}`,
      category: 'open',
      position: 100,
      isDefault: true,
      publicStage: 'received',
    })
    .returning()
  return open
}

async function makeTicket(type: 'customer' | 'tracker', actor: Actor): Promise<TicketId> {
  const dto = await createTicket({ type, title: `${type} ${suffix()}` }, actor)
  return dto.id
}

/** An in-progress + a closed status, beyond the seeded default 'received' open. */
async function seedCascadeStatuses(): Promise<{
  inProgress: TicketStatusId
  closed: TicketStatusId
}> {
  const [inProgress] = await testDb
    .insert(ticketStatuses)
    .values({
      name: 'In Progress',
      slug: `t_ip_${suffix()}`,
      category: 'open',
      position: 200,
      publicStage: 'in_progress',
    })
    .returning()
  const [closed] = await testDb
    .insert(ticketStatuses)
    .values({
      name: 'Resolved',
      slug: `t_res_${suffix()}`,
      category: 'closed',
      position: 300,
      publicStage: 'resolved',
    })
    .returning()
  return { inProgress: inProgress.id, closed: closed.id }
}

async function statusOf(ticketId: TicketId): Promise<TicketStatusId> {
  const [row] = await testDb
    .select({ statusId: tickets.statusId })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
  return row.statusId
}

describe.skipIf(!fixture.available)('ticket-links.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('links a customer ticket to a tracker and records a team-only note', async () => {
    await seedSettings()
    await seedDefaultStatus()
    const actor = await seedActor()
    const tracker = await makeTicket('tracker', actor)
    const customer = await makeTicket('customer', actor)

    await linkTicketToTracker(tracker, customer, actor)

    expect(await listLinkedTicketIds(tracker)).toEqual([customer])

    // The audit note is internal (team-only) and carries the structured event.
    const page = await listTicketMessages(customer, { includeInternal: true })
    const event = page.messages.find((m) => m.systemEvent?.kind === 'ticket_linked')
    expect(event).toBeDefined()
    expect(event?.isInternal).toBe(true)
    expect(event?.systemEvent?.trackerReference).toBeTruthy()

    // ...and never leaks to the requester view.
    const requesterView = await listTicketMessages(customer, { includeInternal: false })
    expect(
      requesterView.messages.find((m) => m.systemEvent?.kind === 'ticket_linked')
    ).toBeUndefined()
  })

  it('rejects self-links and cross-type links', async () => {
    await seedSettings()
    await seedDefaultStatus()
    const actor = await seedActor()
    const tracker = await makeTicket('tracker', actor)
    const customer = await makeTicket('customer', actor)

    await expect(linkTicketToTracker(tracker, tracker, actor)).rejects.toThrow(/itself/i)
    // A customer ticket cannot be the tracker.
    await expect(linkTicketToTracker(customer, tracker, actor)).rejects.toThrow(
      /must be a tracker/i
    )
    // A tracker cannot be tracked (only customer tickets can).
    const tracker2 = await makeTicket('tracker', actor)
    await expect(linkTicketToTracker(tracker, tracker2, actor)).rejects.toThrow(/customer tickets/i)
  })

  it('is idempotent on a same-tracker re-link but rejects a second tracker', async () => {
    await seedSettings()
    await seedDefaultStatus()
    const actor = await seedActor()
    const tracker = await makeTicket('tracker', actor)
    const tracker2 = await makeTicket('tracker', actor)
    const customer = await makeTicket('customer', actor)

    await linkTicketToTracker(tracker, customer, actor)
    await linkTicketToTracker(tracker, customer, actor) // no-op, no throw, no dup
    const links = await testDb
      .select()
      .from(ticketLinks)
      .where(eq(ticketLinks.linkedTicketId, customer))
    expect(links).toHaveLength(1)

    await expect(linkTicketToTracker(tracker2, customer, actor)).rejects.toThrow(/already tracked/i)
  })

  it('unlink removes the link', async () => {
    await seedSettings()
    await seedDefaultStatus()
    const actor = await seedActor()
    const tracker = await makeTicket('tracker', actor)
    const customer = await makeTicket('customer', actor)

    await linkTicketToTracker(tracker, customer, actor)
    await unlinkTicketFromTracker(tracker, customer, actor)
    expect(await listLinkedTicketIds(tracker)).toEqual([])
  })

  it('listLinkedTickets + getTrackerForTicket resolve the two link directions as DTOs', async () => {
    await seedSettings()
    await seedDefaultStatus()
    const actor = await seedActor()
    const tracker = await makeTicket('tracker', actor)
    const customer = await makeTicket('customer', actor)
    await linkTicketToTracker(tracker, customer, actor)

    // Forward: the tracker's linked customer tickets, as DTOs.
    const linked = await listLinkedTickets(tracker)
    expect(linked.map((t) => t.id)).toEqual([customer])
    expect(linked[0].type).toBe('customer')

    // Reverse: the tracker a customer ticket belongs to.
    const owner = await getTrackerForTicket(customer)
    expect(owner?.id).toBe(tracker)
    // An unlinked ticket has no tracker.
    const loner = await makeTicket('customer', actor)
    expect(await getTrackerForTicket(loner)).toBeNull()
  })

  it('closing a tracker cascades its status onto the linked customer tickets', async () => {
    await seedSettings()
    await seedDefaultStatus()
    const { closed } = await seedCascadeStatuses()
    const actor = await seedActor()
    const tracker = await makeTicket('tracker', actor)
    const a = await makeTicket('customer', actor)
    const b = await makeTicket('customer', actor)
    await linkTicketToTracker(tracker, a, actor)
    await linkTicketToTracker(tracker, b, actor)

    // Tracker crosses into the closed category (received -> resolved); both
    // linked tickets follow.
    await setTicketStatus(tracker, closed, actor)

    expect(await statusOf(a)).toBe(closed)
    expect(await statusOf(b)).toBe(closed)
  })

  it('closing a tracker via a NULL-STAGE status ("Won\'t do") cascades too, silently', async () => {
    await seedSettings()
    await seedDefaultStatus()
    // A closed status with no public stage — the "Won't do"/"Duplicate" shape:
    // invisible to the requester, but still a real close for the cascade.
    const [wontDo] = await testDb
      .insert(ticketStatuses)
      .values({
        name: "Won't do",
        slug: `t_wd_${suffix()}`,
        category: 'closed',
        position: 300,
        publicStage: null,
      })
      .returning()
    const actor = await seedActor()
    const tracker = await makeTicket('tracker', actor)
    const a = await makeTicket('customer', actor)
    const b = await makeTicket('customer', actor)
    await linkTicketToTracker(tracker, a, actor)
    await linkTicketToTracker(tracker, b, actor)

    await setTicketStatus(tracker, wontDo.id, actor)

    // The category crossing (open -> closed) drives the cascade even though
    // the status projects no stage at all...
    expect(await statusOf(a)).toBe(wontDo.id)
    expect(await statusOf(b)).toBe(wontDo.id)
    // ...while the customer-facing stage event legitimately stays silent on
    // the tracker's own thread (null-stage statuses never post one).
    const page = await listTicketMessages(tracker, { includeInternal: true })
    expect(
      page.messages.find((m) => m.systemEvent?.kind === 'ticket_status_changed')
    ).toBeUndefined()
  })

  it('reopening a tracker cascades back out, but never regresses an already-closed linked ticket', async () => {
    await seedSettings()
    const openDefault = await seedDefaultStatus()
    const { closed } = await seedCascadeStatuses()
    // A second open status the tracker reopens INTO (distinct from the
    // seeded default so the cascade has a real move to fan out).
    const [reopened] = await testDb
      .insert(ticketStatuses)
      .values({
        name: 'Reopened',
        slug: `t_re_${suffix()}`,
        category: 'open',
        position: 50,
        publicStage: 'received',
      })
      .returning()
    const actor = await seedActor()
    const tracker = await makeTicket('tracker', actor)
    const a = await makeTicket('customer', actor)
    const b = await makeTicket('customer', actor)
    await linkTicketToTracker(tracker, a, actor)
    await linkTicketToTracker(tracker, b, actor)

    // Resolve A on its own, then close the tracker (B follows; A already sat
    // on that very status). Reopen B on its own afterwards, so the tracker
    // reopens with one closed and one open linked ticket.
    await setTicketStatus(a, closed, actor)
    await setTicketStatus(tracker, closed, actor)
    await setTicketStatus(b, openDefault.id, actor)

    await setTicketStatus(tracker, reopened.id, actor) // closed -> open crossing

    // The open linked ticket follows the tracker's reopen...
    expect(await statusOf(b)).toBe(reopened.id)
    // ...but the closed one holds — the cascade never regresses a resolved ticket.
    expect(await statusOf(a)).toBe(closed)
  })

  it('a lateral stage move (open -> open, no category crossing) does not cascade', async () => {
    await seedSettings()
    await seedDefaultStatus()
    const { inProgress } = await seedCascadeStatuses()
    const actor = await seedActor()
    const tracker = await makeTicket('tracker', actor)
    const a = await makeTicket('customer', actor)
    const b = await makeTicket('customer', actor)
    await linkTicketToTracker(tracker, a, actor)
    await linkTicketToTracker(tracker, b, actor)

    // Tracker crosses received -> in_progress: a real STAGE crossing (the
    // tracker's own thread posts the event) but no CATEGORY crossing, so the
    // linked tickets stay put.
    const beforeA = await statusOf(a)
    const beforeB = await statusOf(b)
    await setTicketStatus(tracker, inProgress, actor)

    expect(await statusOf(a)).toBe(beforeA)
    expect(await statusOf(b)).toBe(beforeB)
  })

  it('refuses a caller without ticket.assign', async () => {
    await seedSettings()
    await seedDefaultStatus()
    const actor = await seedActor()
    const tracker = await makeTicket('tracker', actor)
    const customer = await makeTicket('customer', actor)

    const viewer: Actor = {
      principalId: createId('principal') as PrincipalId,
      role: 'user',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: new Set(),
    }
    await expect(linkTicketToTracker(tracker, customer, viewer)).rejects.toThrow(/cannot link/i)
    // The FK columns are also cascade-safe, but the guard fails before any write.
    const links = await testDb
      .select()
      .from(ticketLinks)
      .where(
        and(eq(ticketLinks.trackerTicketId, tracker), eq(ticketLinks.linkedTicketId, customer))
      )
    expect(links).toHaveLength(0)
  })
})
