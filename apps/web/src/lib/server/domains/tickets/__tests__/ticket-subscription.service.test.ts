/**
 * Real-DB coverage for ticket subscriptions (watchers): subscribe is
 * idempotent with first-reason-wins, unsubscribe deletes the row, mute is a
 * timestamp (future = suppressed from event fan-out, expired = active), and
 * both FKs cascade. Runs inside the db-test-fixture rollback transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type TicketId, type UserId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { tickets, ticketStatuses, ticketSubscriptions, principal, user, eq } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  subscribeToTicket,
  unsubscribeFromTicket,
  muteTicket,
  unmuteTicket,
  getTicketWatchStatus,
  getTicketWatchersForEvent,
  getTicketAgentWatchersForEvent,
  listTicketWatchers,
} from '../ticket-subscription.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketSubscriptions.id }).from(ticketSubscriptions).limit(0)
    await db.select({ id: tickets.id }).from(tickets).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedTicket(): Promise<TicketId> {
  const [status] = await testDb
    .insert(ticketStatuses)
    .values({ name: 'Sub-Open', slug: `sub_open_${suffix()}`, category: 'open', position: 200 })
    .returning()
  const [ticket] = await testDb
    .insert(tickets)
    .values({ type: 'customer', title: `Watched ticket ${suffix()}`, statusId: status.id })
    .returning()
  return ticket.id
}

async function seedPrincipal(role: 'member' | 'user' = 'member'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Watcher-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

async function readRows(ticketId: TicketId) {
  return testDb.select().from(ticketSubscriptions).where(eq(ticketSubscriptions.ticketId, ticketId))
}

describe.skipIf(!fixture.available)('ticket-subscription.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('subscribe is idempotent and the first reason wins', async () => {
    const ticketId = await seedTicket()
    const principalId = await seedPrincipal()

    await subscribeToTicket(principalId, ticketId, 'requester')
    await subscribeToTicket(principalId, ticketId, 'assignee')

    const rows = await readRows(ticketId)
    expect(rows).toHaveLength(1)
    expect(rows[0].reason).toBe('requester')
  })

  it('unsubscribe deletes the row; re-subscribe refreshes the reason', async () => {
    const ticketId = await seedTicket()
    const principalId = await seedPrincipal()

    await subscribeToTicket(principalId, ticketId, 'requester')
    await unsubscribeFromTicket(principalId, ticketId)
    expect(await readRows(ticketId)).toHaveLength(0)

    await subscribeToTicket(principalId, ticketId, 'assignee')
    const rows = await readRows(ticketId)
    expect(rows).toHaveLength(1)
    expect(rows[0].reason).toBe('assignee')
  })

  it('mute sets muted_until, unmute clears it, and status reflects both', async () => {
    const ticketId = await seedTicket()
    const principalId = await seedPrincipal()
    const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    await subscribeToTicket(principalId, ticketId, 'manual')
    await muteTicket(principalId, ticketId, until)

    let status = await getTicketWatchStatus(principalId, ticketId)
    expect(status).toEqual({ watching: true, reason: 'manual', mutedUntil: until })

    await unmuteTicket(principalId, ticketId)
    status = await getTicketWatchStatus(principalId, ticketId)
    expect(status).toEqual({ watching: true, reason: 'manual', mutedUntil: null })
  })

  it('mute without a subscription no-ops (no row is created)', async () => {
    const ticketId = await seedTicket()
    const principalId = await seedPrincipal()

    await muteTicket(principalId, ticketId, new Date(Date.now() + 1000))
    expect(await readRows(ticketId)).toHaveLength(0)
    expect(await getTicketWatchStatus(principalId, ticketId)).toEqual({
      watching: false,
      reason: null,
      mutedUntil: null,
    })
  })

  it('getTicketWatchersForEvent excludes future mutes and includes expired ones', async () => {
    const ticketId = await seedTicket()
    const active = await seedPrincipal()
    const mutedNow = await seedPrincipal()
    const muteExpired = await seedPrincipal()

    await subscribeToTicket(active, ticketId, 'requester')
    await subscribeToTicket(mutedNow, ticketId, 'manual')
    await subscribeToTicket(muteExpired, ticketId, 'assignee')
    await muteTicket(mutedNow, ticketId, new Date(Date.now() + 60 * 60 * 1000))
    await muteTicket(muteExpired, ticketId, new Date(Date.now() - 60 * 60 * 1000))

    const watchers = await getTicketWatchersForEvent(ticketId)
    expect(watchers).toHaveLength(2)
    expect(watchers).toContain(active)
    expect(watchers).toContain(muteExpired)
    expect(watchers).not.toContain(mutedNow)
  })

  it('getTicketAgentWatchersForEvent keeps team members only, mute-filtered', async () => {
    const ticketId = await seedTicket()
    const agent = await seedPrincipal('member')
    const mutedAgent = await seedPrincipal('member')
    const requester = await seedPrincipal('user')

    await subscribeToTicket(agent, ticketId, 'replier')
    await subscribeToTicket(mutedAgent, ticketId, 'assignee')
    await subscribeToTicket(requester, ticketId, 'requester')
    await muteTicket(mutedAgent, ticketId, new Date(Date.now() + 60 * 60 * 1000))

    expect(await getTicketAgentWatchersForEvent(ticketId)).toEqual([agent])
  })

  it('listTicketWatchers joins principal identity and role', async () => {
    const ticketId = await seedTicket()
    const agent = await seedPrincipal('member')
    const requester = await seedPrincipal('user')

    await subscribeToTicket(requester, ticketId, 'requester')
    await subscribeToTicket(agent, ticketId, 'replier')

    const watchers = await listTicketWatchers(ticketId)
    expect(watchers).toHaveLength(2)
    const byId = new Map(watchers.map((w) => [w.principalId, w]))
    expect(byId.get(agent)?.role).toBe('member')
    expect(byId.get(agent)?.reason).toBe('replier')
    expect(byId.get(requester)?.role).toBe('user')
    expect(byId.get(requester)?.reason).toBe('requester')
    expect(byId.get(agent)?.displayName).toBeDefined()
  })

  it('cascades: deleting the ticket or the principal removes subscription rows', async () => {
    const ticketId = await seedTicket()
    const keeper = await seedPrincipal()
    const removed = await seedPrincipal()

    await subscribeToTicket(keeper, ticketId, 'manual')
    await subscribeToTicket(removed, ticketId, 'manual')

    await testDb.delete(principal).where(eq(principal.id, removed))
    expect((await readRows(ticketId)).map((r) => r.principalId)).toEqual([keeper])

    await testDb.delete(tickets).where(eq(tickets.id, ticketId))
    expect(await readRows(ticketId)).toHaveLength(0)
  })
})
