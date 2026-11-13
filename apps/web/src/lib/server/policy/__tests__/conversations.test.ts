/**
 * Real-DB coverage for conversationFilter (§4.11 resolution over
 * `conversations`) — the ADDITIVE agent-side visibility seam. Runs inside the
 * db-test-fixture rollback transaction (see server/__tests__/README.md).
 * conversationFilter is a pure SQL predicate; the suite seeds conversations with
 * different agent/team assignees via `testDb` and asserts which a given actor's
 * filter admits. Conversations have no soft-delete column, so there is no
 * deleted-row case here (unlike ticketFilter).
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type TypeId, type UserId } from '@quackback/ids'

type TeamId = TypeId<'team'>
type ConversationId = TypeId<'conversation'>

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, teams, teamMembers, principal, user, and, inArray } from '@/lib/server/db'
import { PERMISSIONS, type PermissionKey } from '@/lib/server/db'
import { conversationFilter } from '../conversations'
import { assertConversationVisible } from '@/lib/server/domains/conversation/conversation.service'
import { ANONYMOUS_ACTOR, type Actor } from '../types'

// The per-item check reads through the app's `db`; point it at the rollback
// transaction so it sees the seeded rows.
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
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
  return { agentA, agentB, visitor, ids, allIds }
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

  it('a service actor acting for a scoped creator (personal API key) sees only what the creator sees', async () => {
    const world = await seedWorld()
    const personalKey = buildActor({
      principalId: createId('principal') as PrincipalId,
      principalType: 'service',
      scopePrincipalId: world.agentA,
      permissions: new Set([PERMISSIONS.CONVERSATION_VIEW]),
    })
    expect(await visibleLabels(personalKey, world)).toEqual(new Set(['selfA', 'teamX']))
  })

  it('a personal API key whose creator holds view_all sees everything', async () => {
    const world = await seedWorld()
    const personalKey = buildActor({
      principalId: createId('principal') as PrincipalId,
      principalType: 'service',
      scopePrincipalId: world.agentA,
      permissions: new Set([PERMISSIONS.CONVERSATION_VIEW_ALL]),
    })
    expect(await visibleLabels(personalKey, world)).toEqual(
      new Set(['selfA', 'teamX', 'teamY', 'selfB', 'unassigned'])
    )
  })

  it('a personal API key without the view permission sees nothing', async () => {
    const world = await seedWorld()
    const personalKey = buildActor({
      principalId: createId('principal') as PrincipalId,
      principalType: 'service',
      scopePrincipalId: world.agentA,
      permissions: new Set(),
    })
    expect(await visibleLabels(personalKey, world)).toEqual(new Set())
  })

  it('an actor without conversation.view (and anonymous) sees nothing', async () => {
    const world = await seedWorld()
    const noPerm = buildActor({ principalId: world.agentA, permissions: new Set() })
    expect(await visibleLabels(noPerm, world)).toEqual(new Set())
    expect(await visibleLabels(ANONYMOUS_ACTOR, world)).toEqual(new Set())
  })
})

describe('assertConversationVisible (real DB, rolled back)', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
  })
  afterEach(fixture.rollback)

  async function openableLabels(actor: Actor, world: Awaited<ReturnType<typeof seedWorld>>) {
    const opened = new Set<string>()
    for (const [label, id] of Object.entries(world.ids)) {
      try {
        const row = await assertConversationVisible(id as ConversationId, actor)
        expect(row.id).toBe(id)
        opened.add(label)
      } catch (error) {
        expect(error).toMatchObject({ code: 'CONVERSATION_NOT_FOUND', statusCode: 404 })
      }
    }
    return opened
  }

  it('opens exactly what the list filter admits for every teammate audience', async () => {
    const world = await seedWorld()
    const audiences: Actor[] = [
      buildActor({ principalId: createId('principal') as PrincipalId, principalType: 'service' }),
      buildActor({
        principalId: createId('principal') as PrincipalId,
        permissions: new Set([PERMISSIONS.CONVERSATION_VIEW_ALL]),
      }),
      buildActor({
        principalId: world.agentA,
        permissions: new Set([PERMISSIONS.CONVERSATION_VIEW]),
      }),
      buildActor({
        principalId: world.agentB,
        permissions: new Set([PERMISSIONS.CONVERSATION_VIEW]),
      }),
      buildActor({
        principalId: createId('principal') as PrincipalId,
        principalType: 'service',
        scopePrincipalId: world.agentA,
        permissions: new Set([PERMISSIONS.CONVERSATION_VIEW]),
      }),
      ANONYMOUS_ACTOR,
    ]
    for (const actor of audiences) {
      expect(await openableLabels(actor, world)).toEqual(await visibleLabels(actor, world))
    }
  })

  it("gives a scoped teammate NotFound for another team's conversation", async () => {
    const world = await seedWorld()
    const agentA = buildActor({
      principalId: world.agentA,
      role: 'member',
      permissions: new Set([PERMISSIONS.CONVERSATION_VIEW]),
    })
    await expect(assertConversationVisible(world.ids.teamY, agentA)).rejects.toMatchObject({
      code: 'CONVERSATION_NOT_FOUND',
    })
    expect((await assertConversationVisible(world.ids.teamX, agentA)).id).toBe(world.ids.teamX)
  })

  it("opens every conversation the visitor owns, and no one else's", async () => {
    const world = await seedWorld()
    const visitor = buildActor({ principalId: world.visitor, role: 'user' })
    expect(await openableLabels(visitor, world)).toEqual(
      new Set(['selfA', 'teamX', 'teamY', 'selfB', 'unassigned'])
    )
    const stranger = buildActor({ principalId: world.agentB, role: 'user' })
    expect(await openableLabels(stranger, world)).toEqual(new Set())
  })
})
