/**
 * Assignment notices are team-only. "Conversation assigned to <teammate>" and
 * "Conversation assigned to the <team> team" are stored internal and broadcast
 * on the agent channel only, so the customer never sees them in the messenger,
 * the portal, or a linked ticket thread. Rows written before the change were
 * public; the customer reads filter them by kind (or by their fixed English
 * content, for the team notice that carried no kind), so history is hidden
 * without a data migration. The agent thread keeps every notice.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type ConversationId,
  type PrincipalId,
  type TeamId,
  type TicketId,
  type TicketStatusId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversationMessages,
  conversations,
  eq,
  principal,
  teams,
  ticketConversations,
  tickets,
  ticketStatuses,
  user,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'

const spies = vi.hoisted(() => ({
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  distributeToTeamMember: vi.fn(),
}))

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: spies.publishConversationEvent,
  publishConversationMessage: vi.fn(),
  publishAgentConversationEvent: spies.publishAgentConversationEvent,
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))
vi.mock('../conversation.webhooks', () => ({
  emitConversationCreated: vi.fn(),
  emitMessageCreated: vi.fn(),
  emitMessageNoteCreated: vi.fn(),
  emitMessageDeleted: vi.fn(),
  emitConversationStatusChanged: vi.fn(),
  emitConversationAssigned: vi.fn(),
  emitConversationPriorityChanged: vi.fn(),
  emitConversationCsatSubmitted: vi.fn(),
  emitConversationCsatCommentAdded: vi.fn(),
}))
vi.mock('../routing', () => ({
  routeConversation: vi.fn(async () => ({ assignedPrincipalId: null })),
  distributeToTeamMember: spies.distributeToTeamMember,
}))

import { assignConversation, assignTeam } from '../conversation.service'
import { conversationToDTO, countVisitorUnreadMessages, listMessages } from '../conversation.query'
import { listPairThreadMessages } from '@/lib/server/domains/tickets/pair-thread.service'

const fixture = await createDbTestFixture()

let teammate: PrincipalId
let visitor: PrincipalId
let actor: Actor

async function insertTeammate(name: string): Promise<PrincipalId> {
  const userId = createId('user')
  const id = createId('principal')
  await testDb.insert(user).values({ id: userId, name, email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id, userId, type: 'user', role: 'admin', displayName: name, createdAt: new Date() })
  return id
}

async function newConversation(): Promise<ConversationId> {
  const [row] = await testDb
    .insert(conversations)
    .values({
      visitorPrincipalId: visitor,
      channel: 'messenger',
      status: 'open',
      customAttributes: {},
      lastMessagePreview: 'My invoice is wrong',
      lastMessageAt: new Date('2026-11-01T09:00:00Z'),
    })
    .returning()
  await testDb.insert(conversationMessages).values({
    conversationId: row!.id,
    principalId: visitor,
    senderType: 'visitor',
    content: 'My invoice is wrong',
    createdAt: new Date('2026-11-01T09:00:00Z'),
  })
  return row!.id
}

async function newTeam(name: string): Promise<TeamId> {
  const [row] = await testDb.insert(teams).values({ name }).returning()
  return row!.id
}

async function loadConversation(id: ConversationId) {
  const row = await testDb.query.conversations.findFirst({ where: eq(conversations.id, id) })
  return row!
}

const contents = (messages: Array<{ content: string }>) => messages.map((m) => m.content)

/** Every message event the customer channel received. */
function customerChannelMessages(): string[] {
  return spies.publishConversationEvent.mock.calls
    .map(([, event]) => event as { kind: string; message?: { content: string } })
    .filter((event) => event.kind === 'message')
    .map((event) => event.message!.content)
}

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  vi.clearAllMocks()
  spies.distributeToTeamMember.mockResolvedValue(null)
  visitor = createId('principal')
  await testDb
    .insert(principal)
    .values({ id: visitor, type: 'anonymous', role: 'user', createdAt: new Date() })
  teammate = await insertTeammate('Alex')
  actor = { principalId: teammate, principalType: 'user', role: 'admin', segmentIds: new Set() }
})
afterEach(fixture.rollback)
afterAll(fixture.close)

describe('a new assignment notice is team-only', () => {
  it('team assignment: the customer thread has no notice, the agent thread has it', async () => {
    const conversationId = await newConversation()
    const teamId = await newTeam('Billing')

    await assignTeam(conversationId, teamId, actor)

    const agent = await listMessages(conversationId, { includeInternal: true })
    expect(contents(agent.messages)).toContain('Conversation assigned to the Billing team')
    const notice = agent.messages.find((m) => m.senderType === 'system')!
    expect(notice.isInternal).toBe(true)

    const customer = await listMessages(conversationId)
    expect(contents(customer.messages)).toEqual(['My invoice is wrong'])

    expect(customerChannelMessages()).toEqual([])
    expect(spies.publishAgentConversationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'message',
        message: expect.objectContaining({ content: 'Conversation assigned to the Billing team' }),
      })
    )
  })

  it('teammate assignment: the customer thread has no notice, the agent thread has it', async () => {
    const conversationId = await newConversation()

    await assignConversation(conversationId, teammate, actor)

    const agent = await listMessages(conversationId, { includeInternal: true })
    expect(contents(agent.messages)).toContain('Conversation assigned to Alex')

    const customer = await listMessages(conversationId)
    expect(contents(customer.messages)).toEqual(['My invoice is wrong'])
    expect(customerChannelMessages()).toEqual([])
  })

  it('a team that hands the conversation to a member posts both notices team-only', async () => {
    const conversationId = await newConversation()
    const teamId = await newTeam('Billing')
    const member = await insertTeammate('Sam')
    spies.distributeToTeamMember.mockResolvedValue(member)

    await assignTeam(conversationId, teamId, actor)

    const agent = await listMessages(conversationId, { includeInternal: true })
    expect(contents(agent.messages)).toEqual(
      expect.arrayContaining([
        'Conversation assigned to the Billing team',
        'Conversation assigned to Sam',
      ])
    )
    const customer = await listMessages(conversationId)
    expect(contents(customer.messages)).toEqual(['My invoice is wrong'])
    expect(customerChannelMessages()).toEqual([])
  })

  it("leaves the customer's preview, updated time and unread count alone", async () => {
    const conversationId = await newConversation()
    const before = await conversationToDTO(await loadConversation(conversationId), 'visitor')

    await assignTeam(conversationId, await newTeam('Billing'), actor)
    await assignConversation(conversationId, teammate, actor)

    const after = await conversationToDTO(await loadConversation(conversationId), 'visitor')
    expect(after.lastMessagePreview).toBe(before.lastMessagePreview)
    expect(after.lastMessageAt).toBe(before.lastMessageAt)
    expect(after.unreadCount).toBe(0)
    expect(await countVisitorUnreadMessages(visitor)).toBe(0)
  })
})

describe('assignment notices written public before the change stay hidden from customers', () => {
  async function seedLegacyNotices(conversationId: ConversationId) {
    await testDb.insert(conversationMessages).values([
      {
        conversationId,
        principalId: null,
        senderType: 'system',
        content: 'Conversation assigned to the Billing team',
        isInternal: false,
        metadata: null,
        createdAt: new Date('2026-11-01T09:01:00Z'),
      },
      {
        conversationId,
        principalId: null,
        senderType: 'system',
        content: 'Conversation assigned to Alex',
        isInternal: false,
        metadata: { systemEvent: { kind: 'assigned', agentName: 'Alex' } },
        createdAt: new Date('2026-11-01T09:02:00Z'),
      },
      {
        conversationId,
        principalId: null,
        senderType: 'system',
        content: 'Conversation ended',
        isInternal: false,
        metadata: { systemEvent: { kind: 'chat_ended' } },
        createdAt: new Date('2026-11-01T09:03:00Z'),
      },
      {
        conversationId,
        principalId: null,
        senderType: 'system',
        content: 'Conversation reopened',
        isInternal: false,
        metadata: null,
        createdAt: new Date('2026-11-01T09:04:00Z'),
      },
    ])
  }

  it('the messenger thread hides them; other public notices stay; the agent sees all', async () => {
    const conversationId = await newConversation()
    await seedLegacyNotices(conversationId)

    const customer = await listMessages(conversationId)
    expect(contents(customer.messages)).toEqual([
      'My invoice is wrong',
      'Conversation ended',
      'Conversation reopened',
    ])

    const agent = await listMessages(conversationId, { includeInternal: true })
    expect(contents(agent.messages)).toEqual([
      'My invoice is wrong',
      'Conversation assigned to the Billing team',
      'Conversation assigned to Alex',
      'Conversation ended',
      'Conversation reopened',
    ])
  })

  it('the linked ticket thread hides them from the requester', async () => {
    const conversationId = await newConversation()
    await seedLegacyNotices(conversationId)
    const statusId = createId('ticket_status') as TicketStatusId
    await testDb
      .insert(ticketStatuses)
      .values({ id: statusId, name: 'New', slug: `assignint_${createId('ticket')}` })
    const ticketId = createId('ticket') as TicketId
    await testDb.insert(tickets).values({ id: ticketId, title: 'Invoice', statusId })
    await testDb
      .insert(ticketConversations)
      .values({ ticketId, conversationId, ticketType: 'customer' })

    const requester = await listPairThreadMessages(ticketId, { includeInternal: false })
    expect(contents(requester.messages)).toEqual([
      'My invoice is wrong',
      'Conversation ended',
      'Conversation reopened',
    ])
    const requesterAll = await listPairThreadMessages(ticketId, { all: true })
    expect(contents(requesterAll.messages)).toEqual(contents(requester.messages))

    const agent = await listPairThreadMessages(ticketId, { includeInternal: true })
    expect(contents(agent.messages)).toHaveLength(5)
  })
})
