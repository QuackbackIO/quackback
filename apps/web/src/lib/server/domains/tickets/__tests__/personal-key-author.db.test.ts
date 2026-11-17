/**
 * Real-Postgres coverage for whose name a message sent through an API key
 * shows.
 *
 * A personal key acts as the teammate who created it, so a ticket it opens and
 * the replies and notes it writes show that teammate: their public name to the
 * customer (portal and widget), their account name to the team (inbox). The
 * stored message keeps the key's own service principal, so the reply-timing
 * rules that read it and the audit trail are unchanged. A workspace key belongs
 * to nobody and keeps showing its own name.
 *
 * Only a personal key made at or after the cutoff that the migration
 * `0316_personal_key_reply_cutoff` records shows its creator, the same rule the
 * reply-timing code uses. An older personal key, or any key while no cutoff is
 * recorded, keeps its own name.
 *
 * Keys come from createApiKey and authenticate through withApiKeyAuth; the
 * ticket is opened through createTicket exactly as POST /api/v1/tickets does.
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

// The conversation webhook bridge runs for real, so the event payloads it
// builds are what these tests read; only the bus underneath is a spy.
vi.mock('@/lib/server/events/dispatch', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>()
  return Object.fromEntries(
    Object.entries(real).map(([name, value]) => [
      name,
      typeof value === 'function' ? vi.fn().mockResolvedValue(undefined) : value,
    ])
  )
})

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('../../conversation/conversation.notify', () => ({
  notifyVisitorMessage: vi.fn().mockResolvedValue(undefined),
  notifyAgentReply: vi.fn().mockResolvedValue(undefined),
  notifyConversationStarted: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/server/domains/assistant/assistant.orchestrator', () => ({
  runAssistantTurnForConversation: vi.fn().mockResolvedValue(undefined),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  apiKeys,
  conversationMessages,
  ticketConversations,
  eq,
  principal,
  roles,
  settings,
  sql,
  ticketStatuses,
  user,
} from '@/lib/server/db'
import { ALL_PERMISSIONS, SYSTEM_ROLES } from '@/lib/shared/permissions'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { serviceActorFromApiAuth } from '@/lib/server/domains/api/service-actor'
import { createApiKey } from '@/lib/server/domains/api-keys/api-key.service'
import {
  loadAuthors,
  PERSONAL_KEY_CUTOFF_KV_KEY,
} from '@/lib/server/domains/principals/principal-display'
import { createTicket } from '../ticket.service'
import { dispatchMessageCreated, dispatchMessageNoteCreated } from '@/lib/server/events/dispatch'
import { Route as ReplyRoute } from '@/routes/api/v1/conversations/$conversationId.reply'
import { Route as NoteRoute } from '@/routes/api/v1/conversations/$conversationId.note'
import {
  addTicketNote,
  listTicketMessages,
  listTicketMessagesForAgent,
  sendTicketMessage,
} from '../ticket-message.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: apiKeys.id, kind: apiKeys.kind }).from(apiKeys).limit(0)
    await db.select({ id: conversationMessages.id }).from(conversationMessages).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const KEY_NAME = 'demo-local-test'
const PUBLIC_NAME = 'Pat from Support'
const ACCOUNT_NAME = 'Patricia Account'
const CREATOR_IMAGE = 'https://images.example.com/pat.png'

/** Record the personal-key cutoff, as the migration does, at `at`; null clears it. */
async function setCutoff(at: Date | null): Promise<void> {
  await testDb.execute(sql`delete from kv_store where key = ${PERSONAL_KEY_CUTOFF_KV_KEY}`)
  if (!at) return
  await testDb.execute(sql`insert into kv_store (workspace_key, key, value, expires_at)
    values ('_', ${PERSONAL_KEY_CUTOFF_KV_KEY}, to_jsonb(${at.toISOString()}::timestamptz),
      now() + interval '100 years')`)
}

const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000)
const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000)

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

/** The key's creator: three distinct names in play (key, public, account). */
async function seedCreator(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({
    id: userId,
    name: ACCOUNT_NAME,
    image: CREATOR_IMAGE,
    email: `key-author-${suffix()}@example.com`,
  })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'admin',
    type: 'user',
    displayName: PUBLIC_NAME,
    createdAt: new Date(),
  })
  return principalId
}

async function seedCustomer(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Customer ${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type: 'user', createdAt: new Date() })
  return principalId
}

async function managerRoleId(): Promise<RoleId> {
  const [row] = await testDb
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, SYSTEM_ROLES.MANAGER))
  return row.id as RoleId
}

async function keyActor(token: string) {
  const auth = await withApiKeyAuth(
    new Request('https://example.com/api/v1/tickets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  )
  return serviceActorFromApiAuth(auth)
}

/** Open a customer ticket through a key, as POST /api/v1/tickets does. */
async function openTicketThroughKey(token: string) {
  const actor = await keyActor(token)
  const requester = await seedCustomer()
  const dto = await createTicket(
    {
      type: 'customer',
      title: 'Export is stuck',
      description: 'Opening words from the team',
      requesterPrincipalId: requester,
      withBackingConversation: true,
    },
    actor
  )
  return { actor, ticketId: dto.id as TicketId }
}

type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>
const post = (route: unknown): Handler =>
  (route as { options: { server: { handlers: Record<string, Handler> } } }).options.server.handlers
    .POST

/** Reply, then add a note, on a ticket's conversation through the REST routes. */
async function replyAndNoteThroughRoutes(token: string, ticketId: TicketId) {
  const [link] = await testDb
    .select({ conversationId: ticketConversations.conversationId })
    .from(ticketConversations)
    .where(
      and(
        eq(ticketConversations.ticketId, ticketId),
        eq(ticketConversations.ticketType, 'customer')
      )
    )
  const call = (route: unknown, content: string) =>
    post(route)({
      request: new Request('https://example.com/api/v1/conversations/x', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      }),
      params: { conversationId: link.conversationId },
    })
  expect((await call(ReplyRoute, 'A route reply')).status).toBe(201)
  expect((await call(NoteRoute, 'A route note')).status).toBe(201)
  const created = vi
    .mocked(dispatchMessageCreated)
    .mock.calls.find(([, message]) => message.content === 'A route reply')
  const noted = vi
    .mocked(dispatchMessageNoteCreated)
    .mock.calls.find(([, message]) => message.content === 'A route note')
  expect(created).toBeDefined()
  expect(noted).toBeDefined()
  return {
    reply: { actorName: created![0].displayName, authorName: created![1].authorName },
    note: { actorName: noted![0].displayName, authorName: noted![1].authorName },
  }
}

function openingMessage<T extends { senderType: string; content: string }>(messages: T[]): T {
  const found = messages.find(
    (m) => m.senderType === 'agent' && m.content === 'Opening words from the team'
  )
  expect(found).toBeDefined()
  return found!
}

if (fixture.available) {
  beforeEach(() => vi.clearAllMocks())
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())
}

describe.skipIf(!fixture.available)('messages sent through an API key', () => {
  it('a ticket opened through a personal key made after the cutoff shows its creator in the portal and the inbox', async () => {
    await setCutoff(anHourAgo())
    await seedDefaultStatus()
    const creator = await seedCreator()
    const { apiKey, plainTextKey } = await createApiKey({ name: KEY_NAME }, creator)
    const { ticketId } = await openTicketThroughKey(plainTextKey)

    // Stored under the key's own principal: attribution and the reply-timing
    // rules read this column, and it does not move.
    const stored = await testDb
      .select({ principalId: conversationMessages.principalId })
      .from(conversationMessages)
      .where(eq(conversationMessages.content, 'Opening words from the team'))
    expect(stored.map((r) => r.principalId)).toEqual([apiKey.principalId])

    // The customer's view (portal and widget read the public label).
    const portal = openingMessage((await listTicketMessages(ticketId)).messages)
    expect(portal.author?.principalId).toBe(apiKey.principalId)
    expect(portal.author?.displayName).toBe(PUBLIC_NAME)
    expect(portal.author?.avatarUrl).toBe(CREATOR_IMAGE)

    // The team's view (the inbox reads the account name).
    const inbox = openingMessage((await listTicketMessagesForAgent(ticketId, creator)).messages)
    expect(inbox.author?.principalId).toBe(apiKey.principalId)
    expect(inbox.author?.displayName).toBe(ACCOUNT_NAME)
    expect(inbox.author?.avatarUrl).toBe(CREATOR_IMAGE)
  })

  it('webhooks for a reply and a note through a personal key made after the cutoff name its creator', async () => {
    await setCutoff(anHourAgo())
    await seedDefaultStatus()
    const creator = await seedCreator()
    const { plainTextKey } = await createApiKey({ name: KEY_NAME }, creator)
    const { ticketId } = await openTicketThroughKey(plainTextKey)

    const events = await replyAndNoteThroughRoutes(plainTextKey, ticketId)
    // The reply goes to the customer, so it carries the name they saw.
    expect(events.reply).toEqual({ actorName: PUBLIC_NAME, authorName: PUBLIC_NAME })
    // A note is team-only, so it carries the account name the inbox shows.
    expect(events.note).toEqual({ actorName: ACCOUNT_NAME, authorName: ACCOUNT_NAME })
  })

  it('a reply and a note through a personal key made after the cutoff show its creator, as sent and on reload', async () => {
    await setCutoff(anHourAgo())
    await seedDefaultStatus()
    const creator = await seedCreator()
    const { plainTextKey } = await createApiKey({ name: KEY_NAME }, creator)
    const { actor, ticketId } = await openTicketThroughKey(plainTextKey)

    const reply = await sendTicketMessage(actor, { ticketId, content: 'A reply via the key' })
    // The returned copy is the team's (the ticket channel is team-only).
    expect(reply.message.author?.displayName).toBe(ACCOUNT_NAME)
    const note = await addTicketNote(actor, { ticketId, content: 'A note via the key' })
    expect(note.message.author?.displayName).toBe(ACCOUNT_NAME)

    const portal = (await listTicketMessages(ticketId)).messages
    expect(portal.find((m) => m.content === 'A reply via the key')?.author?.displayName).toBe(
      PUBLIC_NAME
    )
    const inbox = (await listTicketMessagesForAgent(ticketId, creator, { includeInternal: true }))
      .messages
    expect(inbox.find((m) => m.content === 'A reply via the key')?.author?.displayName).toBe(
      ACCOUNT_NAME
    )
    expect(inbox.find((m) => m.content === 'A note via the key')?.author?.displayName).toBe(
      ACCOUNT_NAME
    )
  })

  it('a workspace key keeps showing its own name', async () => {
    await setCutoff(anHourAgo())
    await seedDefaultStatus()
    const creator = await seedCreator()
    const { apiKey, plainTextKey } = await createApiKey(
      { name: 'ops-bot', kind: 'workspace', roleId: await managerRoleId() },
      creator,
      { permissions: ALL_PERMISSIONS, role: 'admin' }
    )
    const { ticketId } = await openTicketThroughKey(plainTextKey)

    const portal = openingMessage((await listTicketMessages(ticketId)).messages)
    expect(portal.author?.principalId).toBe(apiKey.principalId)
    expect(portal.author?.displayName).toBe('ops-bot')

    const inbox = openingMessage((await listTicketMessagesForAgent(ticketId, creator)).messages)
    expect(inbox.author?.displayName).toBe('ops-bot')
    expect(inbox.author?.avatarUrl).toBeNull()

    const events = await replyAndNoteThroughRoutes(plainTextKey, ticketId)
    expect(events.reply).toEqual({ actorName: 'ops-bot', authorName: 'ops-bot' })
    expect(events.note).toEqual({ actorName: 'ops-bot', authorName: 'ops-bot' })
  })

  it('a personal key made before the cutoff keeps its own name', async () => {
    await setCutoff(inAnHour())
    await seedDefaultStatus()
    const creator = await seedCreator()
    const { apiKey, plainTextKey } = await createApiKey({ name: KEY_NAME }, creator)
    const { ticketId } = await openTicketThroughKey(plainTextKey)

    const portal = openingMessage((await listTicketMessages(ticketId)).messages)
    expect(portal.author?.principalId).toBe(apiKey.principalId)
    expect(portal.author?.displayName).toBe(KEY_NAME)
    const inbox = openingMessage((await listTicketMessagesForAgent(ticketId, creator)).messages)
    expect(inbox.author?.displayName).toBe(KEY_NAME)
  })

  it('with no cutoff recorded, a personal key keeps its own name', async () => {
    await setCutoff(null)
    await seedDefaultStatus()
    const creator = await seedCreator()
    const { plainTextKey } = await createApiKey({ name: KEY_NAME }, creator)
    const { ticketId } = await openTicketThroughKey(plainTextKey)

    const portal = openingMessage((await listTicketMessages(ticketId)).messages)
    expect(portal.author?.displayName).toBe(KEY_NAME)
    const inbox = openingMessage((await listTicketMessagesForAgent(ticketId, creator)).messages)
    expect(inbox.author?.displayName).toBe(KEY_NAME)
  })

  it('a personal key with no recorded creator keeps its own name', async () => {
    await setCutoff(anHourAgo())
    const creator = await seedCreator()
    const { apiKey } = await createApiKey({ name: KEY_NAME }, creator)
    await testDb.update(apiKeys).set({ createdById: null }).where(eq(apiKeys.id, apiKey.id))

    const authors = await loadAuthors([apiKey.principalId], { preferAccountName: true })
    expect(authors.get(apiKey.principalId)?.displayName).toBe(KEY_NAME)
  })
})
