/**
 * Real-DB coverage for `listConversationsForAgent`'s RBAC wiring
 * (UNIFIED-INBOX-SPEC.md §6): `conversationFilter(actor)` is now ANDed into
 * the list query (previously an unwired seam — any `conversation.view`
 * holder saw every conversation). This is an execution-level test of the
 * SERVICE, distinct from `policy/__tests__/conversations.test.ts` which
 * covers the predicate itself in isolation. Runs inside the db-test-fixture
 * rollback transaction (see server/__tests__/README.md).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type PrincipalId,
  type TeamId,
  type UserId,
  type ConversationId,
} from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, teams, teamMembers, principal, user, PERMISSIONS } from '@/lib/server/db'
import type { PermissionKey } from '@/lib/server/db'
import { listConversationsForAgent } from '../conversation.query'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'

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

/** Seed agents, teams, memberships, a visitor, and one conversation per audience
 *  (mirrors policy/__tests__/conversations.test.ts's world, at the service level). */
async function seedWorld() {
  const agentA = await seedPrincipal() // member of team X
  const agentB = await seedPrincipal() // no team membership
  const visitor = await seedPrincipal('user')

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

  return { agentA, agentB, ids }
}

async function visibleLabels(actor: Actor, world: Awaited<ReturnType<typeof seedWorld>>) {
  const page = await listConversationsForAgent({}, actor)
  const seen = new Set(page.conversations.map((c) => c.id))
  return new Set(
    Object.entries(world.ids)
      .filter(([, id]) => seen.has(id))
      .map(([label]) => label)
  )
}

describe.skipIf(!fixture.available)(
  'listConversationsForAgent RBAC wiring (real DB, rolled back)',
  () => {
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

    it('bare conversation.view sees assigned-to-me + my-team only (not unassigned)', async () => {
      const world = await seedWorld()
      const memberA = buildActor({
        principalId: world.agentA,
        permissions: new Set([PERMISSIONS.CONVERSATION_VIEW]),
      })
      expect(await visibleLabels(memberA, world)).toEqual(new Set(['selfA', 'teamX']))
    })

    it('bare conversation.view with no team membership sees assigned-to-me only', async () => {
      const world = await seedWorld()
      const soloB = buildActor({
        principalId: world.agentB,
        permissions: new Set([PERMISSIONS.CONVERSATION_VIEW]),
      })
      expect(await visibleLabels(soloB, world)).toEqual(new Set(['selfB']))
    })

    it('an actor with no conversation.view (and anonymous) sees nothing', async () => {
      const world = await seedWorld()
      const noPerm = buildActor({ principalId: world.agentA, permissions: new Set() })
      expect(await visibleLabels(noPerm, world)).toEqual(new Set())
      expect(await visibleLabels(ANONYMOUS_ACTOR, world)).toEqual(new Set())
    })
  }
)
