/**
 * Real-Postgres coverage for a personal API key following its creator's ROW
 * scope, not only their permissions.
 *
 * A key acts as the teammate who created it. Before this, a key's actions were
 * capped by its creator but its rows were workspace-wide, because the policy
 * filters admitted every service actor. Now the key's actor carries
 * `scopePrincipalId` (the creator), so a creator demoted to a team-scoped role
 * gets a key that lists, opens and counts only their own and their teams' items.
 * Keys come from createApiKey, the demotion goes through updateMemberRole, and
 * requests authenticate through withApiKeyAuth inside a rolled-back transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import {
  createId,
  type ConversationId,
  type PrincipalId,
  type RoleId,
  type TypeId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  conversations,
  eq,
  inArray,
  permissions,
  principal,
  rolePermissions,
  roles,
  settings,
  teamMembers,
  ticketLinks,
  teams,
  tickets,
  ticketStatuses,
  user,
} from '@/lib/server/db'
import { ALL_PERMISSIONS, PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { NotFoundError } from '@/lib/shared/errors'

type TeamId = TypeId<'team'>
type TicketId = TypeId<'ticket'>
type TicketStatusId = TypeId<'ticket_status'>

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/cache')>()),
  cacheDel: vi.fn(),
}))

vi.mock('@/lib/server/domains/teams', () => ({
  addPrincipalToDefaultTeam: vi.fn(),
}))

vi.mock('@/lib/server/domains/principals/membership-sync', () => ({
  enqueueMembershipSync: vi.fn(async () => {}),
}))

vi.mock('@/lib/server/domains/api/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 100 })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

import { withApiKeyAuth } from '../auth'
import { serviceActorFromApiAuth } from '../service-actor'
import { createApiKey } from '@/lib/server/domains/api-keys/api-key.service'
import { updateMemberRole } from '@/lib/server/domains/principals/principal.service'
import { assertTicketVisible, createTicket } from '@/lib/server/domains/tickets/ticket.service'
import { listLinkedTicketIds } from '@/lib/server/domains/tickets/ticket-links.service'
import { assertConversationViewable } from '@/lib/server/domains/conversation/conversation.service'
import { ticketFilter } from '@/lib/server/policy/tickets'
import { conversationFilter } from '@/lib/server/policy/conversations'
import type { Actor } from '@/lib/server/policy/types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db.select({ id: teamMembers.id }).from(teamMembers).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedTeammate(role: 'admin' | 'member' | 'user'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: `Teammate ${role}`, email: `row-scope-${suffix()}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

async function seedCustomRole(granted: PermissionKey[]): Promise<RoleId> {
  const roleId = createId('role') as RoleId
  await testDb.insert(roles).values({ id: roleId, key: roleId, name: 'Scoped', isSystem: false })
  for (const key of granted) {
    const [row] = await testDb
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.key, key))
      .limit(1)
    await testDb.insert(rolePermissions).values({ roleId, permissionId: row.id })
  }
  return roleId
}

function bearer(token: string): Request {
  return new Request('https://example.com/api/v1/tickets', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
}

/**
 * An admin creator on team X with a key, a second admin, and one ticket and
 * one conversation per audience: the creator's own, team X's, team Y's, and
 * someone else's.
 */
async function seedWorld() {
  const creator = await seedTeammate('admin')
  const manager = await seedTeammate('admin')
  const other = await seedTeammate('member')
  const visitor = await seedTeammate('user')
  const { plainTextKey } = await createApiKey({ name: 'Personal' }, creator)

  const teamX = createId('team') as TeamId
  const teamY = createId('team') as TeamId
  await testDb.insert(teams).values([
    { id: teamX, name: `X-${suffix()}` },
    { id: teamY, name: `Y-${suffix()}` },
  ])
  await testDb.insert(teamMembers).values({ teamId: teamX, principalId: creator })

  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'New', slug: `rs-${suffix()}` })
  const ticketIds = {
    mine: createId('ticket') as TicketId,
    teamX: createId('ticket') as TicketId,
    teamY: createId('ticket') as TicketId,
    other: createId('ticket') as TicketId,
  }
  await testDb.insert(tickets).values([
    { id: ticketIds.mine, title: 'mine', statusId, assigneePrincipalId: creator },
    { id: ticketIds.teamX, title: 'teamX', statusId, assigneeTeamId: teamX },
    { id: ticketIds.teamY, title: 'teamY', statusId, assigneeTeamId: teamY },
    { id: ticketIds.other, title: 'other', statusId, assigneePrincipalId: other },
  ])

  const conversationIds = {
    mine: createId('conversation') as ConversationId,
    teamX: createId('conversation') as ConversationId,
    teamY: createId('conversation') as ConversationId,
    other: createId('conversation') as ConversationId,
  }
  const base = { visitorPrincipalId: visitor, channel: 'messenger' as const }
  await testDb.insert(conversations).values([
    { id: conversationIds.mine, ...base, assignedAgentPrincipalId: creator },
    { id: conversationIds.teamX, ...base, assignedTeamId: teamX },
    { id: conversationIds.teamY, ...base, assignedTeamId: teamY },
    { id: conversationIds.other, ...base, assignedAgentPrincipalId: other },
  ])

  return { creator, manager, token: plainTextKey, ticketIds, conversationIds }
}

type World = Awaited<ReturnType<typeof seedWorld>>

async function visibleTickets(actor: Actor, world: World): Promise<Set<string>> {
  const rows = await testDb
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(inArray(tickets.id, Object.values(world.ticketIds)), ticketFilter(actor)))
  const seen = new Set<string>(rows.map((r) => r.id))
  return new Set(
    Object.entries(world.ticketIds)
      .filter(([, id]) => seen.has(id))
      .map(([label]) => label)
  )
}

async function visibleConversations(actor: Actor, world: World): Promise<Set<string>> {
  const rows = await testDb
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        inArray(conversations.id, Object.values(world.conversationIds)),
        conversationFilter(actor)
      )
    )
  const seen = new Set<string>(rows.map((r) => r.id))
  return new Set(
    Object.entries(world.conversationIds)
      .filter(([, id]) => seen.has(id))
      .map(([label]) => label)
  )
}

/** Move the creator to a custom role that can view support items but not all of them. */
async function demoteToTeamScope(world: World): Promise<void> {
  const scoped = await seedCustomRole([
    PERMISSIONS.TICKET_VIEW,
    PERMISSIONS.TICKET_CREATE,
    PERMISSIONS.CONVERSATION_VIEW,
  ])
  await updateMemberRole(world.creator, 'member', world.manager, null, undefined, {
    assignRoleId: scoped,
    granterPermissions: ALL_PERMISSIONS,
    granterRole: 'admin',
  })
}

if (fixture.available) {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())
}

describe.skipIf(!fixture.available)('a personal API key follows its creator row scope', () => {
  it('sees the whole workspace while its creator can see everything', async () => {
    const world = await seedWorld()
    const auth = await withApiKeyAuth(bearer(world.token))
    const actor = serviceActorFromApiAuth(auth)

    expect(actor.scopePrincipalId).toBe(world.creator)
    expect(await visibleTickets(actor, world)).toEqual(new Set(['mine', 'teamX', 'teamY', 'other']))
    expect(await visibleConversations(actor, world)).toEqual(
      new Set(['mine', 'teamX', 'teamY', 'other'])
    )
  })

  it('narrows to the creator and their teams once the creator loses view-all', async () => {
    const world = await seedWorld()
    await demoteToTeamScope(world)

    const actor = serviceActorFromApiAuth(await withApiKeyAuth(bearer(world.token)))

    expect(await visibleTickets(actor, world)).toEqual(new Set(['mine', 'teamX']))
    expect(await visibleConversations(actor, world)).toEqual(new Set(['mine', 'teamX']))
  })

  it('opens a ticket the creator can see and 404s one they cannot', async () => {
    const world = await seedWorld()
    await demoteToTeamScope(world)
    const actor = serviceActorFromApiAuth(await withApiKeyAuth(bearer(world.token)))

    await expect(assertTicketVisible(world.ticketIds.teamX, actor)).resolves.toMatchObject({
      id: world.ticketIds.teamX,
    })
    await expect(assertTicketVisible(world.ticketIds.teamY, actor)).rejects.toThrow(NotFoundError)
  })

  it('opens a conversation the creator can see and 404s one they cannot', async () => {
    const world = await seedWorld()
    await demoteToTeamScope(world)
    const actor = serviceActorFromApiAuth(await withApiKeyAuth(bearer(world.token)))

    await expect(
      assertConversationViewable(world.conversationIds.mine, actor)
    ).resolves.toMatchObject({ id: world.conversationIds.mine })
    await expect(assertConversationViewable(world.conversationIds.teamY, actor)).rejects.toThrow(
      NotFoundError
    )
  })

  it("lists only the tracker's linked tickets the creator can see", async () => {
    const world = await seedWorld()
    await demoteToTeamScope(world)
    const actor = serviceActorFromApiAuth(await withApiKeyAuth(bearer(world.token)))
    await testDb.insert(ticketLinks).values([
      { trackerTicketId: world.ticketIds.mine, linkedTicketId: world.ticketIds.teamX },
      { trackerTicketId: world.ticketIds.mine, linkedTicketId: world.ticketIds.teamY },
    ])

    expect(await listLinkedTicketIds(world.ticketIds.mine, actor)).toEqual([world.ticketIds.teamX])
    expect(new Set(await listLinkedTicketIds(world.ticketIds.mine))).toEqual(
      new Set([world.ticketIds.teamX, world.ticketIds.teamY])
    )
  })

  it('assigns a ticket it creates to the creator, so it stays visible', async () => {
    const world = await seedWorld()
    await demoteToTeamScope(world)
    const actor = serviceActorFromApiAuth(await withApiKeyAuth(bearer(world.token)))

    if (!(await testDb.query.settings.findFirst())) {
      await testDb
        .insert(settings)
        .values({ name: 'Acme', slug: `acme-${suffix()}`, createdAt: new Date() })
    }

    const created = await createTicket({ title: 'From the key', type: 'back_office' }, actor)

    expect(created.assignee?.principalId).toBe(world.creator)
    await expect(assertTicketVisible(created.id, actor)).resolves.toMatchObject({ id: created.id })
  })

  it('keeps an actor with no creator behind it (AI agent, workflow) workspace-wide', async () => {
    const world = await seedWorld()
    const agent: Actor = {
      principalId: createId('principal') as PrincipalId,
      role: 'member',
      principalType: 'service',
      segmentIds: new Set(),
      permissions: new Set(),
    }

    expect(await visibleTickets(agent, world)).toEqual(new Set(['mine', 'teamX', 'teamY', 'other']))
    expect(await visibleConversations(agent, world)).toEqual(
      new Set(['mine', 'teamX', 'teamY', 'other'])
    )
  })
})
