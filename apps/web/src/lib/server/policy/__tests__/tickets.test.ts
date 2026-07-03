/**
 * Real-DB coverage for ticketFilter (§4.11 resolution over `tickets`). Runs
 * inside the db-test-fixture rollback transaction (see server/__tests__/
 * README.md). ticketFilter is a pure SQL predicate, so the suite seeds tickets
 * with different assignees/teams via `testDb` and asserts which a given actor's
 * filter admits — no `db` mock (nothing under test reads the global db).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type TypeId, type UserId } from '@quackback/ids'

type TeamId = TypeId<'team'>
type TicketId = TypeId<'ticket'>
type TicketStatusId = TypeId<'ticket_status'>

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  tickets,
  teams,
  teamMembers,
  ticketStatuses,
  principal,
  user,
  and,
  inArray,
} from '@/lib/server/db'
import { PERMISSIONS, type PermissionKey } from '@/lib/server/db'
import { ticketFilter } from '../tickets'
import { ANONYMOUS_ACTOR, type Actor } from '../types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: teamMembers.id }).from(teamMembers).limit(0)
    await db.select({ id: ticketStatuses.id }).from(ticketStatuses).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function buildActor(overrides: Partial<Actor>): Actor {
  return {
    principalId: null,
    role: null,
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set<PermissionKey>(),
    ...overrides,
  }
}

/** Seed principals, teams, memberships, and one ticket per audience. */
async function seedWorld() {
  const actorA = createId('principal') as PrincipalId // member of team X
  const actorB = createId('principal') as PrincipalId // no team membership
  for (const id of [actorA, actorB]) {
    const userId = createId('user') as UserId
    await testDb.insert(user).values({ id: userId, name: `T-${suffix()}` })
    await testDb
      .insert(principal)
      .values({ id, userId, role: 'member', type: 'user', createdAt: new Date() })
  }

  const teamX = createId('team') as TeamId
  const teamY = createId('team') as TeamId
  await testDb.insert(teams).values([
    { id: teamX, name: `X-${suffix()}` },
    { id: teamY, name: `Y-${suffix()}` },
  ])
  await testDb.insert(teamMembers).values({ teamId: teamX, principalId: actorA })

  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'New', slug: `tf-${suffix()}` })

  const ids = {
    selfA: createId('ticket') as TicketId, // assignee = actorA
    teamX: createId('ticket') as TicketId, // team = X (actorA is a member)
    teamY: createId('ticket') as TicketId, // team = Y (actorA is NOT a member)
    selfB: createId('ticket') as TicketId, // assignee = actorB
    unassigned: createId('ticket') as TicketId, // no assignee
    deletedSelfA: createId('ticket') as TicketId, // assignee = actorA, soft-deleted
  }
  await testDb.insert(tickets).values([
    { id: ids.selfA, title: 'selfA', statusId, assigneePrincipalId: actorA },
    { id: ids.teamX, title: 'teamX', statusId, assigneeTeamId: teamX },
    { id: ids.teamY, title: 'teamY', statusId, assigneeTeamId: teamY },
    { id: ids.selfB, title: 'selfB', statusId, assigneePrincipalId: actorB },
    { id: ids.unassigned, title: 'unassigned', statusId },
    {
      id: ids.deletedSelfA,
      title: 'deletedSelfA',
      statusId,
      assigneePrincipalId: actorA,
      deletedAt: new Date(),
    },
  ])

  const allIds = Object.values(ids) as TicketId[]
  return { actorA, actorB, ids, allIds }
}

/** The seeded tickets a given actor's filter admits, keyed back to their labels. */
async function visibleLabels(actor: Actor, world: Awaited<ReturnType<typeof seedWorld>>) {
  const rows = await testDb
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(inArray(tickets.id, world.allIds), ticketFilter(actor)))
  const seen = new Set(rows.map((r) => r.id))
  return new Set(
    Object.entries(world.ids)
      .filter(([, id]) => seen.has(id))
      .map(([label]) => label)
  )
}

describe.skipIf(!fixture.available)('ticketFilter (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('service principals see ALL non-deleted tickets (deleted excluded)', async () => {
    const world = await seedWorld()
    const service = buildActor({
      principalId: createId('principal') as PrincipalId,
      principalType: 'service',
    })
    expect(await visibleLabels(service, world)).toEqual(
      new Set(['selfA', 'teamX', 'teamY', 'selfB', 'unassigned'])
    )
  })

  it('ticket.view_all sees ALL non-deleted tickets', async () => {
    const world = await seedWorld()
    const viewAll = buildActor({
      principalId: createId('principal') as PrincipalId,
      permissions: new Set([PERMISSIONS.TICKET_VIEW_ALL]),
    })
    expect(await visibleLabels(viewAll, world)).toEqual(
      new Set(['selfA', 'teamX', 'teamY', 'selfB', 'unassigned'])
    )
  })

  it('ticket.view + team membership sees team-assigned OR self-assigned', async () => {
    const world = await seedWorld()
    const memberA = buildActor({
      principalId: world.actorA,
      permissions: new Set([PERMISSIONS.TICKET_VIEW]),
    })
    // actorA is a member of team X: sees team-X tickets + their own; never team Y,
    // never someone else's, never unassigned, never the soft-deleted one.
    expect(await visibleLabels(memberA, world)).toEqual(new Set(['selfA', 'teamX']))
  })

  it('ticket.view with NO team membership sees assigned-to-me only', async () => {
    const world = await seedWorld()
    const soloB = buildActor({
      principalId: world.actorB,
      permissions: new Set([PERMISSIONS.TICKET_VIEW]),
    })
    expect(await visibleLabels(soloB, world)).toEqual(new Set(['selfB']))
  })

  it('an actor without ticket.view sees nothing, even tickets assigned to it', async () => {
    const world = await seedWorld()
    const noPerm = buildActor({ principalId: world.actorA, permissions: new Set() })
    expect(await visibleLabels(noPerm, world)).toEqual(new Set())
  })

  it('an anonymous actor sees nothing', async () => {
    const world = await seedWorld()
    expect(await visibleLabels(ANONYMOUS_ACTOR, world)).toEqual(new Set())
  })

  it('the soft-deleted ticket is invisible to every audience', async () => {
    const world = await seedWorld()
    const service = buildActor({
      principalId: createId('principal') as PrincipalId,
      principalType: 'service',
    })
    const viewAll = buildActor({
      principalId: createId('principal') as PrincipalId,
      permissions: new Set([PERMISSIONS.TICKET_VIEW_ALL]),
    })
    const memberA = buildActor({
      principalId: world.actorA,
      permissions: new Set([PERMISSIONS.TICKET_VIEW]),
    })
    for (const actor of [service, viewAll, memberA]) {
      expect((await visibleLabels(actor, world)).has('deletedSelfA')).toBe(false)
    }
  })
})
