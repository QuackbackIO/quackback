/**
 * The in-memory scope rule against the SQL filters, row by row.
 *
 * `rowInScope` decides, without a query, whether a teammate's scope holds an
 * item, from the item's owner and team and the teammate's team ids. The
 * realtime inbox stream filters every frame with it, so it must give exactly
 * the answer `conversationFilter` and `ticketFilter` give the inbox list, or
 * the stream and the list disagree about what a teammate can see.
 *
 * Real here: the filters, the seeded rows and memberships, and
 * `teamIdsForPrincipal`, which supplies the team ids the stream caches. The
 * actors are built in memory, as the filters take them.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type TypeId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  tickets,
  ticketStatuses,
  teams,
  teamMembers,
  principal,
  user,
  and,
  eq,
  inArray,
} from '@/lib/server/db'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { conversationFilter } from '../conversations'
import { canViewTicket, ticketFilter } from '../tickets'
import { rowInScope } from '../row-scope'
import { teamIdsForPrincipal } from '@/lib/server/domains/teams'
import { ANONYMOUS_ACTOR, type Actor } from '../types'

type TeamId = TypeId<'team'>
type TicketId = TypeId<'ticket'>
type TicketStatusId = TypeId<'ticket_status'>
type ConversationId = TypeId<'conversation'>

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: teamMembers.id }).from(teamMembers).limit(0)
  },
})

afterAll(fixture.close)

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

async function seedPrincipal(role: 'member' | 'user' = 'member'): Promise<PrincipalId> {
  const id = createId('principal') as PrincipalId
  const userId = createId('user') as UserId
  await testDb.insert(user).values({ id: userId, name: `P-${suffix()}` })
  await testDb.insert(principal).values({ id, userId, role, type: 'user', createdAt: new Date() })
  return id
}

/**
 * Agent A is on teams X and Z, agent B on no team. One conversation and one
 * ticket per owner shape, and a deleted ticket of A's own.
 */
async function seedWorld() {
  const agentA = await seedPrincipal()
  const agentB = await seedPrincipal()
  const visitor = await seedPrincipal('user')
  const [teamX, teamY, teamZ] = [0, 1, 2].map(() => createId('team') as TeamId)
  await testDb.insert(teams).values([
    { id: teamX, name: `X-${suffix()}` },
    { id: teamY, name: `Y-${suffix()}` },
    { id: teamZ, name: `Z-${suffix()}` },
  ])
  await testDb.insert(teamMembers).values([
    { teamId: teamX, principalId: agentA },
    { teamId: teamZ, principalId: agentA },
  ])

  const shapes = {
    selfA: { assignee: agentA, team: null },
    selfAOtherTeam: { assignee: agentA, team: teamY },
    teamX: { assignee: null, team: teamX },
    teamZByB: { assignee: agentB, team: teamZ },
    teamY: { assignee: null, team: teamY },
    selfB: { assignee: agentB, team: null },
    unassigned: { assignee: null, team: null },
  } as const

  const conversationIds = {} as Record<keyof typeof shapes, ConversationId>
  for (const [label, shape] of Object.entries(shapes) as Array<
    [keyof typeof shapes, (typeof shapes)[keyof typeof shapes]]
  >) {
    const id = createId('conversation') as ConversationId
    conversationIds[label] = id
    await testDb.insert(conversations).values({
      id,
      visitorPrincipalId: visitor,
      channel: 'messenger',
      assignedAgentPrincipalId: shape.assignee,
      assignedTeamId: shape.team,
    })
  }

  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'New', slug: `st-${suffix()}` })
  const ticketIds = {} as Record<keyof typeof shapes | 'deletedSelfA', TicketId>
  for (const [label, shape] of Object.entries(shapes) as Array<
    [keyof typeof shapes, (typeof shapes)[keyof typeof shapes]]
  >) {
    const id = createId('ticket') as TicketId
    ticketIds[label] = id
    await testDb.insert(tickets).values({
      id,
      title: label,
      statusId,
      assigneePrincipalId: shape.assignee,
      assigneeTeamId: shape.team,
    })
  }
  ticketIds.deletedSelfA = createId('ticket') as TicketId
  await testDb.insert(tickets).values({
    id: ticketIds.deletedSelfA,
    title: 'deleted',
    statusId,
    assigneePrincipalId: agentA,
    deletedAt: new Date(),
  })

  return { agentA, agentB, conversationIds, ticketIds }
}

type World = Awaited<ReturnType<typeof seedWorld>>

/** Every actor shape the filters branch on, with the team ids the stream would cache. */
async function actorsFor(world: World): Promise<Array<[string, Actor]>> {
  const both = [PERMISSIONS.CONVERSATION_VIEW, PERMISSIONS.TICKET_VIEW] as PermissionKey[]
  return [
    [
      'service',
      buildActor({ principalId: createId('principal') as PrincipalId, principalType: 'service' }),
    ],
    [
      'personal key of A',
      buildActor({
        principalId: createId('principal') as PrincipalId,
        principalType: 'service',
        scopePrincipalId: world.agentA,
        permissions: new Set(both),
      }),
    ],
    [
      'view_all',
      buildActor({
        principalId: world.agentB,
        permissions: new Set([
          ...both,
          PERMISSIONS.CONVERSATION_VIEW_ALL,
          PERMISSIONS.TICKET_VIEW_ALL,
        ]),
      }),
    ],
    ['scoped A', buildActor({ principalId: world.agentA, permissions: new Set(both) })],
    ['scoped B', buildActor({ principalId: world.agentB, permissions: new Set(both) })],
    ['A without view keys', buildActor({ principalId: world.agentA })],
    ['anonymous', ANONYMOUS_ACTOR],
  ]
}

describe.skipIf(!fixture.available)('rowInScope agrees with the SQL filters (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  it('teamIdsForPrincipal reads every team a teammate belongs to', async () => {
    const world = await seedWorld()
    expect((await teamIdsForPrincipal(world.agentA)).size).toBe(2)
    expect((await teamIdsForPrincipal(world.agentB)).size).toBe(0)
  })

  it('conversations: rowInScope admits exactly the rows conversationFilter admits', async () => {
    const world = await seedWorld()
    const allIds = Object.values(world.conversationIds)
    for (const [name, actor] of await actorsFor(world)) {
      const scopeOf = actor.scopePrincipalId ?? actor.principalId
      const teamIds = scopeOf ? await teamIdsForPrincipal(scopeOf) : new Set<string>()
      const admitted = await testDb
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(inArray(conversations.id, allIds), conversationFilter(actor)))
      const sqlVisible = new Set(admitted.map((r) => r.id))
      for (const [label, id] of Object.entries(world.conversationIds)) {
        const [row] = await testDb
          .select({
            assigneePrincipalId: conversations.assignedAgentPrincipalId,
            teamId: conversations.assignedTeamId,
          })
          .from(conversations)
          .where(eq(conversations.id, id))
        expect(rowInScope(actor, 'conversation', row, teamIds), `${name} / ${label}`).toBe(
          sqlVisible.has(id)
        )
      }
    }
  })

  it('tickets: rowInScope and canViewTicket admit exactly the rows ticketFilter admits', async () => {
    const world = await seedWorld()
    const allIds = Object.values(world.ticketIds)
    for (const [name, actor] of await actorsFor(world)) {
      const scopeOf = actor.scopePrincipalId ?? actor.principalId
      const teamIds = scopeOf ? await teamIdsForPrincipal(scopeOf) : new Set<string>()
      const admitted = await testDb
        .select({ id: tickets.id })
        .from(tickets)
        .where(and(inArray(tickets.id, allIds), ticketFilter(actor)))
      const sqlVisible = new Set(admitted.map((r) => r.id))
      for (const [label, id] of Object.entries(world.ticketIds)) {
        const [row] = await testDb
          .select({
            assigneePrincipalId: tickets.assigneePrincipalId,
            assigneeTeamId: tickets.assigneeTeamId,
            deletedAt: tickets.deletedAt,
          })
          .from(tickets)
          .where(eq(tickets.id, id))
        const where = `${name} / ${label}`
        expect(canViewTicket(actor, row, teamIds).allowed, where).toBe(sqlVisible.has(id))
        // The stream's rule ignores deletion, so a delete frame still reaches
        // the teammates who held the ticket; on a live row it is the filter.
        const inScope = rowInScope(
          actor,
          'ticket',
          { assigneePrincipalId: row.assigneePrincipalId, teamId: row.assigneeTeamId },
          teamIds
        )
        if (row.deletedAt === null) expect(inScope, where).toBe(sqlVisible.has(id))
      }
    }
  })

  it('rowInScope keeps a deleted ticket in the scope of the teammate who holds it', async () => {
    const world = await seedWorld()
    const actor = buildActor({
      principalId: world.agentA,
      permissions: new Set([PERMISSIONS.TICKET_VIEW]),
    })
    expect(
      rowInScope(actor, 'ticket', { assigneePrincipalId: world.agentA, teamId: null }, new Set())
    ).toBe(true)
  })
})
