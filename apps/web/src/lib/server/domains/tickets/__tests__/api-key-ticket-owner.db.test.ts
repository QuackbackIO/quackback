/**
 * Real-Postgres coverage for who owns and watches a ticket opened with an API
 * key, through the REST API's actor and through MCP's.
 *
 * A personal key acts as the teammate who created it, so the ticket is theirs:
 * assigned to them unless the caller names an assignee, and watched by them,
 * never by the key. A workspace key belongs to nobody: the ticket is not
 * assigned to it and it does not watch, since a watcher exists to be told
 * about the ticket and a key has nobody to tell.
 *
 * Keys come from createApiKey and authenticate exactly as the two surfaces
 * authenticate them; the ticket is opened through createTicket as POST
 * /api/v1/tickets and MCP create_ticket both do.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import {
  createId,
  type PrincipalId,
  type RoleId,
  type TicketId,
  type TicketStatusId,
  type UserId,
} from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
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

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishTicketEvent: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishConversationMessage: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))

vi.mock('../ticket.webhooks', () => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
  emitTicketReplied: vi.fn().mockResolvedValue(undefined),
  emitTicketNoteAdded: vi.fn().mockResolvedValue(undefined),
  emitTicketExternalStatusChanged: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/server/events/dispatch', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>()
  return Object.fromEntries(
    Object.entries(real).map(([name, value]) => [
      name,
      typeof value === 'function' ? vi.fn().mockResolvedValue(undefined) : value,
    ])
  )
})

vi.mock('../../conversation/conversation.notify', () => ({
  notifyVisitorMessage: vi.fn().mockResolvedValue(undefined),
  notifyAgentReply: vi.fn().mockResolvedValue(undefined),
  notifyConversationStarted: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/server/domains/assistant/assistant.orchestrator', () => ({
  runAssistantTurnForConversation: vi.fn().mockResolvedValue(undefined),
}))

// A qb_ token is never an OAuth access token; MCP then resolves it as a key.
vi.mock('better-auth/oauth2', () => ({
  verifyAccessTokenRequest: vi.fn(async () => {
    throw new Error('not a JWT')
  }),
  requestToResourceInput: vi.fn(() => ({})),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  apiKeys,
  eq,
  principal,
  roles,
  settings,
  ticketStatuses,
  ticketSubscriptions,
  tickets,
  user,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { ALL_PERMISSIONS, SYSTEM_ROLES } from '@/lib/shared/permissions'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { serviceActorFromApiAuth } from '@/lib/server/domains/api/service-actor'
import { createApiKey } from '@/lib/server/domains/api-keys/api-key.service'
import { resolveAuthContext } from '@/lib/server/mcp/handler'
import { mcpAgentActor } from '@/lib/server/mcp/tools/helpers'
import { createTicket } from '../ticket.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: apiKeys.id, kind: apiKeys.kind }).from(apiKeys).limit(0)
    await db.select({ id: ticketSubscriptions.ticketId }).from(ticketSubscriptions).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedDefaultStatus(): Promise<void> {
  await testDb
    .insert(settings)
    .values({ name: 'Test WS', slug: `test_${suffix()}`, createdAt: new Date() })
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  await testDb.insert(ticketStatuses).values({
    id: createId('ticket_status') as TicketStatusId,
    name: 'T-Received',
    slug: `t_received_${suffix()}`,
    category: 'open',
    publicStage: 'received',
    position: 100,
    isDefault: true,
  })
}

async function seedPerson(role: 'admin' | 'member' | 'user'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: `Person ${suffix()}`, email: `p-${suffix()}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

async function managerRoleId(): Promise<RoleId> {
  const [row] = await testDb
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, SYSTEM_ROLES.MANAGER))
  return row.id as RoleId
}

const bearer = (token: string, path: string) =>
  new Request(`https://example.com${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })

/** The actor POST /api/v1/tickets builds for a key. */
async function restActor(token: string): Promise<Actor> {
  return serviceActorFromApiAuth(await withApiKeyAuth(bearer(token, '/api/v1/tickets')))
}

/** The actor MCP create_ticket builds for a key. */
async function mcpActor(token: string): Promise<Actor> {
  const auth = await resolveAuthContext(bearer(token, '/api/mcp'))
  if (auth instanceof Response) throw new Error(`MCP auth refused: ${auth.status}`)
  return mcpAgentActor(auth)
}

async function watchers(ticketId: TicketId) {
  const rows = await testDb
    .select({ principalId: ticketSubscriptions.principalId, reason: ticketSubscriptions.reason })
    .from(ticketSubscriptions)
    .where(eq(ticketSubscriptions.ticketId, ticketId))
  return Object.fromEntries(rows.map((r) => [r.principalId, r.reason]))
}

async function assigneeOf(ticketId: TicketId) {
  const [row] = await testDb
    .select({ assignee: tickets.assigneePrincipalId })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
  return row.assignee
}

if (fixture.available) {
  beforeEach(() => vi.clearAllMocks())
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())
}

describe.skipIf(!fixture.available).each([
  ['REST', restActor],
  ['MCP', mcpActor],
] as const)('a ticket opened with an API key over %s', (_surface, actorFor) => {
  it('with a personal key is its creator’s: assigned to them and watched by them, not the key', async () => {
    await seedDefaultStatus()
    const creator = await seedPerson('admin')
    const requester = await seedPerson('user')
    const { apiKey, plainTextKey } = await createApiKey({ name: 'my-key' }, creator)

    const dto = await createTicket(
      {
        type: 'customer',
        title: 'Refund',
        description: 'Opening words',
        requesterPrincipalId: requester,
        withBackingConversation: true,
      },
      await actorFor(plainTextKey)
    )

    expect(await assigneeOf(dto.id as TicketId)).toBe(creator)
    expect(await watchers(dto.id as TicketId)).toEqual({
      [requester]: 'requester',
      [creator]: 'assignee',
    })
    expect(Object.keys(await watchers(dto.id as TicketId))).not.toContain(apiKey.principalId)
  })

  it('with a personal key and a named assignee is still watched by its creator, not the key', async () => {
    await seedDefaultStatus()
    const creator = await seedPerson('admin')
    const teammate = await seedPerson('member')
    const { plainTextKey } = await createApiKey({ name: 'my-key' }, creator)

    const dto = await createTicket(
      { type: 'back_office', title: 'Chase invoice', assigneePrincipalId: teammate },
      await actorFor(plainTextKey)
    )

    expect(await assigneeOf(dto.id as TicketId)).toBe(teammate)
    expect(await watchers(dto.id as TicketId)).toEqual({
      [teammate]: 'assignee',
      [creator]: 'manual',
    })
  })

  it('with a workspace key is neither assigned to the key nor watched by it', async () => {
    await seedDefaultStatus()
    const creator = await seedPerson('admin')
    const requester = await seedPerson('user')
    const { plainTextKey } = await createApiKey(
      { name: 'ops-bot', kind: 'workspace', roleId: await managerRoleId() },
      creator,
      { permissions: ALL_PERMISSIONS, role: 'admin' }
    )

    const dto = await createTicket(
      {
        type: 'customer',
        title: 'Refund',
        description: 'Opening words',
        requesterPrincipalId: requester,
        withBackingConversation: true,
      },
      await actorFor(plainTextKey)
    )

    expect(await assigneeOf(dto.id as TicketId)).toBeNull()
    expect(await watchers(dto.id as TicketId)).toEqual({ [requester]: 'requester' })
  })

  it('with a workspace key and a named assignee is watched by the assignee only', async () => {
    await seedDefaultStatus()
    const creator = await seedPerson('admin')
    const teammate = await seedPerson('member')
    const { plainTextKey } = await createApiKey(
      { name: 'ops-bot', kind: 'workspace', roleId: await managerRoleId() },
      creator,
      { permissions: ALL_PERMISSIONS, role: 'admin' }
    )

    const dto = await createTicket(
      { type: 'back_office', title: 'Chase invoice', assigneePrincipalId: teammate },
      await actorFor(plainTextKey)
    )

    expect(await assigneeOf(dto.id as TicketId)).toBe(teammate)
    expect(await watchers(dto.id as TicketId)).toEqual({ [teammate]: 'assignee' })
  })
})
