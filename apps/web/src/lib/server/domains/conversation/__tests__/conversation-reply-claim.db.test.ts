/**
 * Replying claims an unassigned conversation only for a person. A service
 * principal (the assistant sending a card, or an API key replying) leaves an
 * unassigned conversation unassigned, and an assistant hand-off releases a
 * conversation the assistant holds so routing can place it with a teammate.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type TicketId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, principal, user, eq } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS } from '@/lib/shared/permissions'

const spies = vi.hoisted(() => ({
  emitConversationAssigned: vi.fn(),
  routeConversation: vi.fn(),
}))

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: vi.fn(),
  publishConversationMessage: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))
vi.mock('../conversation.webhooks', () => ({
  emitConversationCreated: vi.fn(),
  emitMessageCreated: vi.fn(),
  emitMessageNoteCreated: vi.fn(),
  emitMessageDeleted: vi.fn(),
  emitConversationStatusChanged: vi.fn(),
  emitConversationAssigned: spies.emitConversationAssigned,
  emitConversationPriorityChanged: vi.fn(),
  emitConversationCsatSubmitted: vi.fn(),
  emitConversationCsatCommentAdded: vi.fn(),
}))
vi.mock('../conversation.notify', async (original) => ({
  ...(await original<typeof import('../conversation.notify')>()),
  notifyAgentReply: vi.fn(async () => {}),
}))
vi.mock('../routing', () => ({ routeConversation: spies.routeConversation }))
vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchAssistantHandedOff: vi.fn(),
  buildEventActor: vi.fn(() => ({ type: 'service' })),
}))
vi.mock('@/lib/server/domains/workflows/workflow.service', () => ({
  hasLiveWorkflowForTrigger: vi.fn(async () => false),
}))
vi.mock('@/lib/server/domains/conversation-attributes/ai-classification.service', () => ({
  classifyConversationAttributes: vi.fn(async () => []),
}))
vi.mock('@/lib/server/domains/conversation-attributes/set-attribute.service', () => ({
  setConversationAttribute: vi.fn(async () => ({})),
}))
vi.mock('@/lib/server/domains/conversation-attributes/conversation-attribute.service', () => ({
  ensureAssistantEscalationReasonAttribute: vi.fn(async () => {}),
}))

import { executeAssistantHandoff, sendAgentMessage } from '../conversation.service'
import { shareTicket } from '../conversation.cards'
import { quinnActor } from '@/lib/server/domains/assistant/assistant.actor'
import { serviceActorFromApiAuth } from '@/lib/server/domains/api/service-actor'

const fixture = await createDbTestFixture()

let assistant: PrincipalId
let apiKey: PrincipalId
let teammate: PrincipalId
let colleague: PrincipalId
let visitor: PrincipalId

function teammateActor(principalId: PrincipalId): Actor {
  return { principalId, principalType: 'user', role: 'admin', segmentIds: new Set() }
}

async function insertTeammate(name: string): Promise<PrincipalId> {
  const userId = createId('user')
  const id = createId('principal')
  await testDb.insert(user).values({ id: userId, name, email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id, userId, type: 'user', role: 'admin', displayName: name, createdAt: new Date() })
  return id
}

async function newConversation(assignedAgentPrincipalId: PrincipalId | null = null) {
  const [row] = await testDb
    .insert(conversations)
    .values({
      visitorPrincipalId: visitor,
      channel: 'messenger',
      status: 'open',
      customAttributes: {},
      assignedAgentPrincipalId,
    })
    .returning()
  return row!
}

async function assigneeOf(id: string) {
  const row = await testDb.query.conversations.findFirst({
    where: eq(conversations.id, id as never),
  })
  return row!.assignedAgentPrincipalId
}

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  vi.clearAllMocks()
  spies.routeConversation.mockResolvedValue({ assignedPrincipalId: null })
  assistant = createId('principal')
  apiKey = createId('principal')
  visitor = createId('principal')
  await testDb.insert(principal).values([
    {
      id: assistant,
      type: 'service',
      role: 'member',
      displayName: 'Assistant',
      createdAt: new Date(),
    },
    { id: apiKey, type: 'service', role: 'admin', displayName: 'Key', createdAt: new Date() },
    { id: visitor, type: 'anonymous', role: 'user', createdAt: new Date() },
  ])
  teammate = await insertTeammate('Alex')
  colleague = await insertTeammate('Sam')
})
afterEach(fixture.rollback)
afterAll(fixture.close)

describe('a service principal never claims by replying', () => {
  it('an assistant ticket card leaves an unassigned conversation unassigned', async () => {
    const conversation = await newConversation()

    await shareTicket(
      { conversationId: conversation.id, ticketId: createId('ticket') as TicketId },
      {
        agentActor: quinnActor(assistant),
        agentPrincipalId: assistant,
        agent: { principalId: assistant, displayName: 'Assistant' },
      }
    )

    expect(await assigneeOf(conversation.id)).toBeNull()
    expect(spies.emitConversationAssigned).not.toHaveBeenCalled()
  })

  it('an API key reply leaves an unassigned conversation unassigned', async () => {
    const conversation = await newConversation()
    const actor = serviceActorFromApiAuth({
      principalId: apiKey,
      role: 'admin',
      permissions: new Set([PERMISSIONS.CONVERSATION_REPLY]),
    })

    await sendAgentMessage(conversation.id, 'On it', { principalId: apiKey }, actor)

    expect(await assigneeOf(conversation.id)).toBeNull()
    expect(spies.emitConversationAssigned).not.toHaveBeenCalled()
  })
})

describe('a person claims by replying', () => {
  it('a teammate reply claims an unassigned conversation and emits one assignment', async () => {
    const conversation = await newConversation()

    await sendAgentMessage(
      conversation.id,
      'Hello',
      { principalId: teammate, displayName: 'Alex' },
      teammateActor(teammate)
    )

    expect(await assigneeOf(conversation.id)).toBe(teammate)
    expect(spies.emitConversationAssigned).toHaveBeenCalledTimes(1)
    expect(spies.emitConversationAssigned.mock.calls[0]![1]).toMatchObject({
      id: conversation.id,
      assignedAgentPrincipalId: teammate,
    })
  })

  it('a teammate reply never takes a conversation assigned to someone else', async () => {
    const conversation = await newConversation(colleague)

    await sendAgentMessage(
      conversation.id,
      'Hello',
      { principalId: teammate, displayName: 'Alex' },
      teammateActor(teammate)
    )

    expect(await assigneeOf(conversation.id)).toBe(colleague)
    expect(spies.emitConversationAssigned).not.toHaveBeenCalled()
  })
})

describe('an assistant hand-off releases a conversation the assistant holds', () => {
  const author = () => ({ principalId: assistant, displayName: 'Assistant' })

  it('routes it to a routable teammate', async () => {
    spies.routeConversation.mockResolvedValue({ assignedPrincipalId: teammate })
    const conversation = await newConversation(assistant)

    await executeAssistantHandoff(conversation.id, 'explicit_request', author())

    expect(await assigneeOf(conversation.id)).toBe(teammate)
  })

  it('leaves it in the unassigned queue when nobody is routable', async () => {
    const conversation = await newConversation(assistant)

    await executeAssistantHandoff(conversation.id, 'explicit_request', author())

    expect(await assigneeOf(conversation.id)).toBeNull()
  })

  it('keeps a conversation assigned to a teammate with that teammate', async () => {
    spies.routeConversation.mockResolvedValue({ assignedPrincipalId: colleague })
    const conversation = await newConversation(teammate)

    await executeAssistantHandoff(conversation.id, 'explicit_request', author())

    expect(await assigneeOf(conversation.id)).toBe(teammate)
  })
})
