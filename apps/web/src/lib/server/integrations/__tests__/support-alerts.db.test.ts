/**
 * When a chat channel (Slack, Discord) holds back a support notice, against
 * real rows. Only the presence read is stubbed.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  user,
  principal,
  conversations,
  conversationMessages,
  integrations,
  integrationEventMappings,
} from '@/lib/server/db'
import type {
  ConversationCreatedEvent,
  EventData,
  MessageCreatedEvent,
} from '@/lib/server/events/types'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
const presence = vi.hoisted(() => ({ readAvailableAgentIds: vi.fn() }))
vi.mock('@/lib/server/realtime/presence', () => presence)

import { supportAlertHold } from '../support-alerts'
import { refreshConversationSyncEvent } from '../sync/sources'

const fixture = await createDbTestFixture()
beforeEach(fixture.begin)
afterEach(async () => {
  vi.clearAllMocks()
  await fixture.rollback()
})
afterAll(fixture.close)

async function person(name: string, type: 'user' | 'member' = 'user') {
  const [u] = await testDb
    .insert(user)
    .values({ name, email: `${createId('user')}@example.com` })
    .returning()
  const [p] = await testDb
    .insert(principal)
    .values({
      userId: u.id,
      type: 'user',
      role: type === 'member' ? 'admin' : 'user',
      displayName: name,
      createdAt: new Date(),
    })
    .returning()
  return p
}

async function seed(opts: { assigned?: boolean; channelEvents?: string[] } = {}) {
  const customer = await person('Vera')
  const agent = await person('Sam', 'member')
  const [conversation] = await testDb
    .insert(conversations)
    .values({
      visitorPrincipalId: customer.id,
      channel: 'messenger',
      assignedAgentPrincipalId: opts.assigned ? agent.id : null,
    })
    .returning()
  const [integration] = await testDb
    .insert(integrations)
    .values({ integrationType: 'discord', status: 'active', config: {} })
    .returning()
  for (const eventType of opts.channelEvents ?? ['message.created']) {
    await testDb.insert(integrationEventMappings).values({
      integrationId: integration.id,
      eventType,
      actionType: 'send_message',
      enabled: true,
      actionConfig: { channelId: 'C1' },
    })
  }
  return { customer, agent, conversation, integration }
}

function customerMessage(
  conversationId: string,
  authorId: string,
  opts: { first?: boolean; senderType?: 'visitor' | 'agent' } = {}
): MessageCreatedEvent {
  return {
    id: createId('event'),
    type: 'message.created',
    timestamp: new Date().toISOString(),
    actor: { type: 'user', principalId: authorId },
    data: {
      isFirstMessage: opts.first ?? false,
      conversation: { id: conversationId, status: 'open', channel: 'messenger', priority: 'none' },
      message: {
        id: createId('conversation_message'),
        conversationId,
        senderType: opts.senderType ?? 'visitor',
        authorPrincipalId: authorId,
        authorName: 'Vera',
        authorEmail: null,
        content: 'Still broken',
        createdAt: new Date().toISOString(),
      },
    },
  }
}

const route = (integrationId: string, channelId = 'C1') => ({ integrationId, channelId })

describe('supportAlertHold: customer replies', () => {
  it('holds a reply while the assigned teammate is online and available', async () => {
    const { customer, agent, conversation, integration } = await seed({ assigned: true })
    presence.readAvailableAgentIds.mockResolvedValue([agent.id])
    const event = customerMessage(conversation.id, customer.id)
    expect(await supportAlertHold(event, route(integration.id))).toBe('assignee_online')
  })

  it('posts while the assigned teammate is away or offline, even if others are online', async () => {
    const { customer, conversation, integration } = await seed({ assigned: true })
    const other = await person('Kim', 'member')
    presence.readAvailableAgentIds.mockResolvedValue([other.id])
    const event = customerMessage(conversation.id, customer.id)
    expect(await supportAlertHold(event, route(integration.id))).toBeNull()
  })

  it('posts when nobody is assigned, without reading presence', async () => {
    const { customer, conversation, integration } = await seed()
    const event = customerMessage(conversation.id, customer.id)
    expect(await supportAlertHold(event, route(integration.id))).toBeNull()
    expect(presence.readAvailableAgentIds).not.toHaveBeenCalled()
  })

  it('posts when presence cannot be read, so a reply is never lost', async () => {
    const { customer, conversation, integration } = await seed({ assigned: true })
    presence.readAvailableAgentIds.mockResolvedValue(null)
    const event = customerMessage(conversation.id, customer.id)
    expect(await supportAlertHold(event, route(integration.id))).toBeNull()
  })
})

describe('supportAlertHold: the opening message', () => {
  it('is held when the same channel already gets the new conversation notice', async () => {
    const { customer, conversation, integration } = await seed({
      channelEvents: ['conversation.created', 'message.created'],
    })
    const event = customerMessage(conversation.id, customer.id, { first: true })
    expect(await supportAlertHold(event, route(integration.id))).toBe('opening_message')
  })

  it('posts when the new conversation notice goes to a different channel', async () => {
    const { customer, conversation, integration } = await seed({
      channelEvents: ['conversation.created', 'message.created'],
    })
    const event = customerMessage(conversation.id, customer.id, { first: true })
    expect(await supportAlertHold(event, route(integration.id, 'C2'))).toBeNull()
  })

  it('posts when the channel only gets customer messages', async () => {
    const { customer, conversation, integration } = await seed({ assigned: true })
    presence.readAvailableAgentIds.mockResolvedValue([])
    const event = customerMessage(conversation.id, customer.id, { first: true })
    expect(await supportAlertHold(event, route(integration.id))).toBeNull()
  })
})

describe('supportAlertHold: other events', () => {
  it('never holds a new conversation notice or a non-support event', async () => {
    const { integration } = await seed()
    const created = { type: 'conversation.created' } as unknown as EventData
    const post = { type: 'post.created' } as unknown as EventData
    expect(await supportAlertHold(created, route(integration.id))).toBeNull()
    expect(await supportAlertHold(post, route(integration.id))).toBeNull()
  })
})

describe('refreshConversationSyncEvent: opening message', () => {
  it('attaches the first customer message to a new conversation notice', async () => {
    const { customer, agent, conversation } = await seed()
    await testDb.insert(conversationMessages).values([
      {
        conversationId: conversation.id,
        principalId: customer.id,
        senderType: 'visitor',
        content: 'My login fails on the tablet',
        createdAt: new Date('2026-11-01T10:00:00Z'),
      },
      {
        conversationId: conversation.id,
        principalId: agent.id,
        senderType: 'agent',
        content: 'Looking now',
        createdAt: new Date('2026-11-01T10:01:00Z'),
      },
    ])
    const event = {
      id: createId('event'),
      type: 'conversation.created',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', principalId: customer.id },
      data: { conversation: { id: conversation.id } },
    } as unknown as ConversationCreatedEvent
    expect(await refreshConversationSyncEvent(event)).toBe(true)
    expect(event.data.conversation.openingMessage).toBe('My login fails on the tablet')
  })
})
