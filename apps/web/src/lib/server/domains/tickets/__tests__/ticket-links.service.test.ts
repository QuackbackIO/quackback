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

async function seedDefaultStatus(): Promise<void> {
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  await testDb.insert(ticketStatuses).values({
    name: 'T-Open',
    slug: `t_open_${suffix()}`,
    category: 'open',
    position: 100,
    isDefault: true,
    publicStage: 'received',
  })
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

  it('a tracker stage crossing cascades its status onto the linked customer tickets', async () => {
    await seedSettings()
    await seedDefaultStatus()
    const { inProgress } = await seedCascadeStatuses()
    const actor = await seedActor()
    const tracker = await makeTicket('tracker', actor)
    const a = await makeTicket('customer', actor)
    const b = await makeTicket('customer', actor)
    await linkTicketToTracker(tracker, a, actor)
    await linkTicketToTracker(tracker, b, actor)

    // Tracker crosses received -> in_progress; both linked tickets follow.
    await setTicketStatus(tracker, inProgress, actor)

    expect(await statusOf(a)).toBe(inProgress)
    expect(await statusOf(b)).toBe(inProgress)
  })

  it('the cascade never regresses a linked ticket already closed', async () => {
    await seedSettings()
    await seedDefaultStatus()
    const { inProgress, closed } = await seedCascadeStatuses()
    const actor = await seedActor()
    const tracker = await makeTicket('tracker', actor)
    const openTicket = await makeTicket('customer', actor)
    const closedTicket = await makeTicket('customer', actor)
    await linkTicketToTracker(tracker, openTicket, actor)
    await linkTicketToTracker(tracker, closedTicket, actor)
    await setTicketStatus(closedTicket, closed, actor) // resolve one first

    // Tracker moves to in_progress: the open one follows, the closed one holds.
    await setTicketStatus(tracker, inProgress, actor)

    expect(await statusOf(openTicket)).toBe(inProgress)
    expect(await statusOf(closedTicket)).toBe(closed)
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
