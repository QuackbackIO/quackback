/**
 * Real-Postgres coverage for the authority a /api/chat/stream actor carries.
 *
 * A dashboard stream acts with the principal's assignment-derived permission
 * set, so a teammate whose assigned role grants only team-scoped `ticket.view`
 * opens their own and their teams' tickets and nothing else, and a role without
 * `conversation.view` opens only conversations it owns. A non-dashboard
 * audience (widget token, portal session) never carries team authority: a
 * teammate's widget stream reaches its own conversation and no other.
 *
 * Real here: the route, the principal read, the role-assignment resolution,
 * `assertTicketVisible` / `ticketFilter` and `canViewConversation` against
 * seeded rows. Stood in for: the stream token signature (a token is
 * `<principalId>.<scope>`), the session read, the feature-flag gate, pub/sub,
 * presence and the activity snapshot, none of which decide visibility.
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
  conversations,
  eq,
  permissions,
  principal,
  principalRoleAssignments,
  rolePermissions,
  roles,
  teamMembers,
  teams,
  tickets,
  ticketStatuses,
  user,
} from '@/lib/server/db'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

type TeamId = TypeId<'team'>
type TicketId = TypeId<'ticket'>
type TicketStatusId = TypeId<'ticket_status'>

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/realtime/stream-token', () => ({
  verifyStreamToken: (token: string | null) => {
    if (!token) return null
    const dot = token.lastIndexOf('.')
    return { principalId: token.slice(0, dot), scope: token.slice(dot + 1) }
  },
}))

vi.mock('@/lib/server/auth', () => ({
  auth: { api: { getSession: vi.fn(async () => null) } },
}))

vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isConversationsEnabledFor: vi.fn(async () => true),
  isSupportTicketsEnabled: vi.fn(async () => true),
}))

vi.mock('@/lib/server/realtime/pubsub', () => ({
  subscribe: vi.fn(async () => async () => {}),
}))

vi.mock('@/lib/server/realtime/presence', () => ({
  markPresent: vi.fn(async () => {}),
  refreshPresence: vi.fn(async () => {}),
  clearPresence: vi.fn(async () => false),
}))

vi.mock('@/lib/server/domains/assistant/assistant-activity-snapshot', () => ({
  readActivitySnapshot: vi.fn(async () => null),
}))

import { Route } from '../stream'

type RouteOpts = { server: { handlers: { GET: (a: { request: Request }) => Promise<Response> } } }
const GET = (Route as unknown as { options: RouteOpts }).options.server.handlers.GET

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db.select({ id: principalRoleAssignments.id }).from(principalRoleAssignments).limit(0)
  },
})

if (fixture.available) {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())
}

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(role: 'admin' | 'member' | 'user'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: `Stream ${role}`, email: `stream-${suffix()}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

/** Give a principal a workspace-wide custom role holding exactly `granted`. */
async function assignCustomRole(principalId: PrincipalId, granted: PermissionKey[]) {
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
  await testDb.insert(principalRoleAssignments).values({ principalId, roleId })
}

/**
 * A scoped teammate (legacy `member`, assigned a role with `ticket.view` only)
 * on team X, a workspace-wide ticket viewer, and one ticket per audience.
 */
async function seedTickets() {
  const scoped = await seedPrincipal('member')
  await assignCustomRole(scoped, [PERMISSIONS.TICKET_VIEW])
  const viewAll = await seedPrincipal('member')
  await assignCustomRole(viewAll, [PERMISSIONS.TICKET_VIEW, PERMISSIONS.TICKET_VIEW_ALL])
  const other = await seedPrincipal('member')

  const teamX = createId('team') as TeamId
  const teamY = createId('team') as TeamId
  await testDb.insert(teams).values([
    { id: teamX, name: `X-${suffix()}` },
    { id: teamY, name: `Y-${suffix()}` },
  ])
  await testDb.insert(teamMembers).values({ teamId: teamX, principalId: scoped })

  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'New', slug: `st-${suffix()}` })
  const ids = {
    mine: createId('ticket') as TicketId,
    myTeam: createId('ticket') as TicketId,
    otherTeam: createId('ticket') as TicketId,
    others: createId('ticket') as TicketId,
  }
  await testDb.insert(tickets).values([
    { id: ids.mine, title: 'mine', statusId, assigneePrincipalId: scoped },
    { id: ids.myTeam, title: 'my team', statusId, assigneeTeamId: teamX },
    { id: ids.otherTeam, title: 'other team', statusId, assigneeTeamId: teamY },
    { id: ids.others, title: 'others', statusId, assigneePrincipalId: other },
  ])
  return { scoped, viewAll, ids }
}

async function seedConversation(visitorPrincipalId: PrincipalId): Promise<ConversationId> {
  const id = createId('conversation') as ConversationId
  await testDb.insert(conversations).values({ id, visitorPrincipalId, channel: 'messenger' })
  return id
}

/** Open a stream as `principalId` on audience `scope`; release it once answered. */
async function openStream(principalId: PrincipalId, scope: string, query: string) {
  const res = await GET({
    request: new Request(
      `http://test/api/chat/stream?${query}&token=${encodeURIComponent(`${principalId}.${scope}`)}`
    ),
  })
  await res.body?.cancel()
  return res.status
}

describe.skipIf(!fixture.available)('/api/chat/stream actor permissions (real Postgres)', () => {
  describe('ticket streams follow the assigned role', () => {
    it('404s a ticket.view teammate on a ticket outside their own and their teams', async () => {
      const { scoped, ids } = await seedTickets()
      expect(await openStream(scoped, 'dashboard', `ticketId=${ids.others}`)).toBe(404)
      expect(await openStream(scoped, 'dashboard', `ticketId=${ids.otherTeam}`)).toBe(404)
    })

    it('opens a ticket.view teammate on a ticket assigned to them or their team', async () => {
      const { scoped, ids } = await seedTickets()
      expect(await openStream(scoped, 'dashboard', `ticketId=${ids.mine}`)).toBe(200)
      expect(await openStream(scoped, 'dashboard', `ticketId=${ids.myTeam}`)).toBe(200)
    })

    it('opens any ticket for a teammate holding ticket.view_all', async () => {
      const { viewAll, ids } = await seedTickets()
      expect(await openStream(viewAll, 'dashboard', `ticketId=${ids.others}`)).toBe(200)
      expect(await openStream(viewAll, 'dashboard', `ticketId=${ids.otherTeam}`)).toBe(200)
    })

    it('404s a teammate whose assigned role holds no ticket permission', async () => {
      const { ids } = await seedTickets()
      const noTickets = await seedPrincipal('member')
      await assignCustomRole(noTickets, [PERMISSIONS.CONVERSATION_VIEW])
      expect(await openStream(noTickets, 'dashboard', `ticketId=${ids.others}`)).toBe(404)
    })
  })

  describe('conversation streams', () => {
    it('404s a dashboard teammate whose assigned role lacks conversation.view', async () => {
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const teammate = await seedPrincipal('member')
      await assignCustomRole(teammate, [PERMISSIONS.TICKET_VIEW])
      expect(await openStream(teammate, 'dashboard', `conversationId=${conversationId}`)).toBe(404)
    })

    it('opens a dashboard teammate holding conversation.view on any conversation', async () => {
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      const teammate = await seedPrincipal('member')
      await assignCustomRole(teammate, [PERMISSIONS.CONVERSATION_VIEW])
      expect(await openStream(teammate, 'dashboard', `conversationId=${conversationId}`)).toBe(200)
    })

    it('404s a teammate on a widget audience asking for a conversation it does not own', async () => {
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      // The teammate's assignment holds conversation.view; a widget audience
      // must not carry it.
      const teammate = await seedPrincipal('member')
      await assignCustomRole(teammate, [PERMISSIONS.CONVERSATION_VIEW])
      expect(await openStream(teammate, 'widget', `conversationId=${conversationId}`)).toBe(404)
      expect(await openStream(teammate, 'portal', `conversationId=${conversationId}`)).toBe(404)
    })

    it('opens the owning visitor on their own conversation', async () => {
      const visitor = await seedPrincipal('user')
      const conversationId = await seedConversation(visitor)
      expect(await openStream(visitor, 'widget', `conversationId=${conversationId}`)).toBe(200)
    })

    it('opens a teammate on a widget audience on the conversation they own', async () => {
      const teammate = await seedPrincipal('member')
      await assignCustomRole(teammate, [PERMISSIONS.CONVERSATION_VIEW])
      const conversationId = await seedConversation(teammate)
      expect(await openStream(teammate, 'widget', `conversationId=${conversationId}`)).toBe(200)
    })
  })
})
