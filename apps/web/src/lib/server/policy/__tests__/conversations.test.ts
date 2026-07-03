/**
 * Real-DB coverage for conversationFilter (§4.11 resolution over
 * `conversations`) — the ADDITIVE agent-side visibility seam. Runs inside the
 * db-test-fixture rollback transaction (see server/__tests__/README.md).
 * conversationFilter is a pure SQL predicate; the suite seeds conversations with
 * different agent/team assignees via `testDb` and asserts which a given actor's
 * filter admits. Conversations have no soft-delete column, so there is no
 * deleted-row case here (unlike ticketFilter).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type TypeId, type UserId } from '@quackback/ids'

type TeamId = TypeId<'team'>
type ConversationId = TypeId<'conversation'>

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, teams, teamMembers, principal, user, and, inArray } from '@/lib/server/db'
import { PERMISSIONS, type PermissionKey } from '@/lib/server/db'
import { conversationFilter } from '../conversations'
import { ANONYMOUS_ACTOR, type Actor } from '../types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db.select({ id: teamMembers.id }).from(teamMembers).limit(0)
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

async function seedPrincipal(role: 'member' | 'user' = 'member'): Promise<PrincipalId> {
  const id = createId('principal') as PrincipalId
  const userId = createId('user') as UserId
  await testDb.insert(user).values({ id: userId, name: `P-${suffix()}` })
  await testDb.insert(principal).values({ id, userId, role, type: 'user', createdAt: new Date() })
  return id
}

/** Seed agents, teams, memberships, a visitor, and one conversation per audience. */
async function seedWorld() {
  const agentA = await seedPrincipal() // member of team X
  const agentB = await seedPrincipal() // no team membership
  const visitor = await seedPrincipal('user') // the conversation owner side

  const teamX = createId('team') as TeamId
  const teamY = createId('team') as TeamId
  await testDb.insert(teams).values([
    { id: teamX, name: `X-${suffix()}` },
    { id: teamY, name: `Y-${suffix()}` },
  ])
  await testDb.insert(teamMembers).values({ teamId: teamX, principalId: agentA })

  const ids = {
    selfA: createId('conversation') as ConversationId, // agent = agentA
    teamX: createId('conversation') as ConversationId, // team = X (agentA member)
    teamY: createId('conversation') as ConversationId, // team = Y (agentA not a member)
    selfB: createId('conversation') as ConversationId, // agent = agentB
    unassigned: createId('conversation') as ConversationId, // no assignee
  }
  const base = { visitorPrincipalId: visitor, channel: 'messenger' as const }
  await testDb.insert(conversations).values([
    { id: ids.selfA, ...base, assignedAgentPrincipalId: agentA },
    { id: ids.teamX, ...base, assignedTeamId: teamX },
    { id: ids.teamY, ...base, assignedTeamId: teamY },
    { id: ids.selfB, ...base, assignedAgentPrincipalId: agentB },
    { id: ids.unassigned, ...base },
  ])

  const allIds = Object.values(ids) as ConversationId[]
  return { agentA, agentB, ids, allIds }
}

async function visibleLabels(actor: Actor, world: Awaited<ReturnType<typeof seedWorld>>) {
  const rows = await testDb
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(inArray(conversations.id, world.allIds), conversationFilter(actor)))
  const seen = new Set(rows.map((r) => r.id))
  return new Set(
    Object.entries(world.ids)
      .filter(([, id]) => seen.has(id))
      .map(([label]) => label)
  )
}

describe.skipIf(!fixture.available)('conversationFilter (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('service principals see ALL conversations', async () => {
    const world = await seedWorld()
    const service = buildActor({
      principalId: createId('principal') as PrincipalId,
      principalType: 'service',
    })
    expect(await visibleLabels(service, world)).toEqual(
      new Set(['selfA', 'teamX', 'teamY', 'selfB', 'unassigned'])
    )
  })

  it('conversation.view_all sees ALL conversations', async () => {
    const world = await seedWorld()
    const viewAll = buildActor({
      principalId: createId('principal') as PrincipalId,
      permissions: new Set([PERMISSIONS.CONVERSATION_VIEW_ALL]),
    })
    expect(await visibleLabels(viewAll, world)).toEqual(
      new Set(['selfA', 'teamX', 'teamY', 'selfB', 'unassigned'])
    )
  })

  it('conversation.view + team membership sees team-assigned OR self-assigned', async () => {
    const world = await seedWorld()
    const memberA = buildActor({
      principalId: world.agentA,
      permissions: new Set([PERMISSIONS.CONVERSATION_VIEW]),
    })
    expect(await visibleLabels(memberA, world)).toEqual(new Set(['selfA', 'teamX']))
  })

  it('conversation.view with NO team membership sees assigned-to-me only', async () => {
    const world = await seedWorld()
    const soloB = buildActor({
      principalId: world.agentB,
      permissions: new Set([PERMISSIONS.CONVERSATION_VIEW]),
    })
    expect(await visibleLabels(soloB, world)).toEqual(new Set(['selfB']))
  })

  it('an actor without conversation.view (and anonymous) sees nothing', async () => {
    const world = await seedWorld()
    const noPerm = buildActor({ principalId: world.agentA, permissions: new Set() })
    expect(await visibleLabels(noPerm, world)).toEqual(new Set())
    expect(await visibleLabels(ANONYMOUS_ACTOR, world)).toEqual(new Set())
  })
})
