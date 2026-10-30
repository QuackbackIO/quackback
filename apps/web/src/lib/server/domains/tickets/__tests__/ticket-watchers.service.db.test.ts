/**
 * Real-DB coverage for the people-facing watcher rules (ticket-watchers.service)
 * and the fan-out's visibility filter. Teammates' visibility is real: a scoped
 * teammate holds a custom role with ticket.view only (their own and their
 * teams' tickets), a manager-preset teammate sees every ticket. Only the event
 * bridge and the fire-and-forget activity write are spied, so each call is
 * recorded with its arguments.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type TeamId, type TicketId, type UserId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
const emit = vi.hoisted(() => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
  emitTicketReplied: vi.fn().mockResolvedValue(undefined),
  emitTicketRepliedAs: vi.fn().mockResolvedValue(undefined),
  emitTicketNoteAdded: vi.fn().mockResolvedValue(undefined),
  emitTicketExternalStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketSubscriberAdded: vi.fn().mockResolvedValue(undefined),
  emitTicketSubscriberRemoved: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/domains/tickets/ticket.webhooks', () => emit)
const activity = vi.hoisted(() => ({ recordTicketActivity: vi.fn() }))
vi.mock('@/lib/server/domains/tickets/ticket-activity.service', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/domains/tickets/ticket-activity.service')
  >()),
  recordTicketActivity: activity.recordTicketActivity,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  tickets,
  ticketStatuses,
  ticketSubscriptions,
  principal,
  principalRoleAssignments,
  permissions,
  rolePermissions,
  roles,
  teams,
  teamMembers,
  user,
  and,
  eq,
  inArray,
  PERMISSIONS,
  type PermissionKey,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import {
  addTicketWatcher,
  removeTicketWatcher,
  watchTicketForSelf,
  unwatchTicketForSelf,
  listTicketWatcherCandidates,
  listWatchersOfTicket,
} from '../ticket-watchers.service'
import { getTicketWatchersForEvent } from '../ticket-subscription.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketSubscriptions.id }).from(ticketSubscriptions).limit(0)
    await db.select({ id: principalRoleAssignments.id }).from(principalRoleAssignments).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPerson(role: 'member' | 'user', name: string): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role,
    type: 'user',
    displayName: name,
    createdAt: new Date(),
  })
  return principalId
}

/** A teammate who sees only their own and their teams' tickets (ticket.view, no view_all). */
async function seedScopedTeammate(name: string): Promise<PrincipalId> {
  const principalId = await seedPerson('member', name)
  const [role] = await testDb
    .insert(roles)
    .values({ key: `scoped_${suffix()}`, name: 'Scoped agent' })
    .returning()
  const granted = await testDb
    .select({ id: permissions.id })
    .from(permissions)
    .where(inArray(permissions.key, [PERMISSIONS.TICKET_VIEW]))
  await testDb
    .insert(rolePermissions)
    .values(granted.map((p) => ({ roleId: role.id, permissionId: p.id })))
  await testDb.insert(principalRoleAssignments).values({ principalId, roleId: role.id })
  return principalId
}

async function seedWorld() {
  const [status] = await testDb
    .insert(ticketStatuses)
    .values({ name: 'W-Open', slug: `w_open_${suffix()}`, category: 'open', position: 300 })
    .returning()
  const teamId = createId('team') as TeamId
  await testDb.insert(teams).values({ id: teamId, name: `Billing ${suffix()}` })
  const requester = await seedPerson('user', 'Rita Requester')
  const [ticket] = await testDb
    .insert(tickets)
    .values({
      type: 'customer',
      title: `Refund ${suffix()}`,
      statusId: status.id,
      requesterPrincipalId: requester,
      assigneeTeamId: teamId,
    })
    .returning()
  return { ticketId: ticket.id as TicketId, teamId, requester }
}

function managerActor(principalId: PrincipalId): Actor {
  return {
    principalId,
    role: 'member',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set<PermissionKey>([
      PERMISSIONS.TICKET_VIEW,
      PERMISSIONS.TICKET_VIEW_ALL,
      PERMISSIONS.TICKET_ASSIGN,
    ]),
  }
}

async function reasonOf(ticketId: TicketId, principalId: PrincipalId) {
  const [row] = await testDb
    .select({ reason: ticketSubscriptions.reason })
    .from(ticketSubscriptions)
    .where(
      and(
        eq(ticketSubscriptions.ticketId, ticketId),
        eq(ticketSubscriptions.principalId, principalId)
      )
    )
  return row?.reason ?? null
}

describe.skipIf(!fixture.available)('ticket-watchers.service (real DB, rolled back)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    return fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('adds a teammate who can see the ticket, once, and tells everyone who needs to know', async () => {
    const { ticketId } = await seedWorld()
    const lead = await seedPerson('member', 'Lea Lead')
    const mate = await seedPerson('member', 'Max Mate')

    expect(await addTicketWatcher(ticketId, mate, managerActor(lead))).toEqual({ added: true })
    expect(await reasonOf(ticketId, mate)).toBe('manual')
    expect(emit.emitTicketSubscriberAdded).toHaveBeenCalledTimes(1)
    expect(emit.emitTicketSubscriberAdded.mock.calls[0][2]).toBe(mate)
    expect(activity.recordTicketActivity).toHaveBeenCalledWith({
      ticketId,
      principalId: lead,
      type: 'watcher.added',
      metadata: { watcherPrincipalId: mate, watcherName: 'Max Mate' },
    })

    // Adding them again changes nothing and announces nothing.
    vi.clearAllMocks()
    expect(await addTicketWatcher(ticketId, mate, managerActor(lead))).toEqual({ added: false })
    expect(emit.emitTicketSubscriberAdded).not.toHaveBeenCalled()
    expect(activity.recordTicketActivity).not.toHaveBeenCalled()
  })

  it('refuses someone who is not a teammate', async () => {
    const { ticketId } = await seedWorld()
    const lead = await seedPerson('member', 'Lea Lead')
    const customer = await seedPerson('user', 'Cleo Customer')

    await expect(addTicketWatcher(ticketId, customer, managerActor(lead))).rejects.toMatchObject({
      code: 'INVALID_WATCHER',
    })
    expect(await reasonOf(ticketId, customer)).toBeNull()
  })

  it('refuses a teammate the ticket is hidden from, and accepts them once it is their team', async () => {
    const { ticketId, teamId } = await seedWorld()
    const lead = await seedPerson('member', 'Lea Lead')
    const scoped = await seedScopedTeammate('Sam Scoped')

    await expect(addTicketWatcher(ticketId, scoped, managerActor(lead))).rejects.toMatchObject({
      code: 'WATCHER_CANNOT_SEE_TICKET',
    })

    await testDb.insert(teamMembers).values({ teamId, principalId: scoped })
    expect(await addTicketWatcher(ticketId, scoped, managerActor(lead))).toEqual({ added: true })
  })

  it("needs ticket.assign, and a ticket the caller can see, to change someone else's watch", async () => {
    const { ticketId } = await seedWorld()
    const mate = await seedPerson('member', 'Max Mate')
    const viewer = await seedPerson('member', 'Vic Viewer')

    const noAssign: Actor = {
      ...managerActor(viewer),
      permissions: new Set<PermissionKey>([PERMISSIONS.TICKET_VIEW_ALL, PERMISSIONS.TICKET_VIEW]),
    }
    await expect(addTicketWatcher(ticketId, mate, noAssign)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    const blind: Actor = {
      ...managerActor(viewer),
      permissions: new Set<PermissionKey>([PERMISSIONS.TICKET_VIEW, PERMISSIONS.TICKET_ASSIGN]),
    }
    await expect(addTicketWatcher(ticketId, mate, blind)).rejects.toMatchObject({
      code: 'TICKET_NOT_FOUND',
    })
  })

  it('a self watch and unwatch announce themselves but leave no timeline entry', async () => {
    const { ticketId } = await seedWorld()
    const mate = await seedPerson('member', 'Max Mate')

    expect(await watchTicketForSelf(ticketId, managerActor(mate))).toEqual({ added: true })
    expect(emit.emitTicketSubscriberAdded).toHaveBeenCalledTimes(1)
    expect(await unwatchTicketForSelf(ticketId, managerActor(mate))).toEqual({ removed: true })
    expect(emit.emitTicketSubscriberRemoved).toHaveBeenCalledTimes(1)
    expect(emit.emitTicketSubscriberRemoved.mock.calls[0][3]).toBe('manual')
    expect(activity.recordTicketActivity).not.toHaveBeenCalled()
  })

  it("removes anyone's watch, the requester's included, and is a clean no-op otherwise", async () => {
    const { ticketId, requester } = await seedWorld()
    const lead = await seedPerson('member', 'Lea Lead')
    await testDb
      .insert(ticketSubscriptions)
      .values({ ticketId, principalId: requester, reason: 'requester' })

    expect(await removeTicketWatcher(ticketId, requester, managerActor(lead))).toEqual({
      removed: true,
    })
    expect(await reasonOf(ticketId, requester)).toBeNull()
    expect(emit.emitTicketSubscriberRemoved.mock.calls[0][3]).toBe('requester')
    expect(activity.recordTicketActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'watcher.removed', principalId: lead })
    )

    vi.clearAllMocks()
    expect(await removeTicketWatcher(ticketId, requester, managerActor(lead))).toEqual({
      removed: false,
    })
    expect(emit.emitTicketSubscriberRemoved).not.toHaveBeenCalled()
  })

  it('offers every teammate in the picker, marked with whether the ticket is visible to them', async () => {
    const { ticketId } = await seedWorld()
    const lead = await seedPerson('member', 'Lea Lead')
    const scoped = await seedScopedTeammate('Sam Scoped')

    const candidates = await listTicketWatcherCandidates(ticketId, managerActor(lead))
    const byId = new Map(candidates.map((c) => [c.principalId, c.canView]))
    expect(byId.get(lead)).toBe(true)
    expect(byId.get(scoped)).toBe(false)
  })

  it('lists watchers with whether each is a teammate today', async () => {
    const { ticketId, requester } = await seedWorld()
    const mate = await seedPerson('member', 'Max Mate')
    await testDb.insert(ticketSubscriptions).values([
      { ticketId, principalId: requester, reason: 'requester' },
      { ticketId, principalId: mate, reason: 'manual' },
    ])

    const watchers = await listWatchersOfTicket(ticketId, managerActor(mate))
    expect(watchers.map((w) => [w.principalId, w.isTeamMember])).toEqual([
      [requester, false],
      [mate, true],
    ])
  })

  it('stops fanning out to a teammate who lost sight of the ticket, never to the requester', async () => {
    const { ticketId, teamId, requester } = await seedWorld()
    const scoped = await seedScopedTeammate('Sam Scoped')
    await testDb.insert(teamMembers).values({ teamId, principalId: scoped })
    await testDb.insert(ticketSubscriptions).values([
      { ticketId, principalId: requester, reason: 'requester' },
      { ticketId, principalId: scoped, reason: 'manual' },
    ])
    expect(new Set(await getTicketWatchersForEvent(ticketId))).toEqual(new Set([requester, scoped]))

    // The ticket moves to another team: the scoped teammate keeps the row but
    // hears nothing until it comes back to them.
    const otherTeam = createId('team') as TeamId
    await testDb.insert(teams).values({ id: otherTeam, name: `Other ${suffix()}` })
    await testDb.update(tickets).set({ assigneeTeamId: otherTeam }).where(eq(tickets.id, ticketId))

    expect(await getTicketWatchersForEvent(ticketId)).toEqual([requester])
    expect(await reasonOf(ticketId, scoped)).toBe('manual')
  })
})
