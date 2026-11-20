/**
 * The AI agent's end_conversation tool closes the conversation on a real
 * customer-support turn. It runs autonomously under the agent's own bounded
 * actor (quinnActor), so the agent's permission ceiling must hold the one
 * permission the tool declares, conversation.set_status; without it the
 * permission check denies every call and the conversation stays open.
 *
 * Real tool spec, real pipeline, real actor and real Postgres (rolled back);
 * only the outbound side effects of a close (realtime, webhooks, channel
 * delivery, AI classification) are stubbed.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type ConversationId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, principal, eq } from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'

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
vi.mock('@/lib/server/domains/conversation/conversation.webhooks', () => ({
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
vi.mock('@/lib/server/domains/channels', () => ({
  requireChannelAdapter: () => ({ deliverLifecycleEvent: vi.fn(async () => {}) }),
}))
vi.mock('@/lib/server/domains/conversation-attributes/ai-classification.service', () => ({
  classifyConversationAttributes: vi.fn(async () => []),
}))

import { assembleAssistantToolset } from '../assistant.tools'
import { makeAssistantToolContext, ASSISTANT_TOOL_SPECS } from '../assistant.toolspec'
import { quinnActor } from '../assistant.actor'

const fixture = await createDbTestFixture()

let assistant: PrincipalId
let visitor: PrincipalId

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  assistant = createId('principal')
  visitor = createId('principal')
  await testDb.insert(principal).values([
    { id: assistant, type: 'service', role: 'member', displayName: 'Agent', createdAt: new Date() },
    { id: visitor, type: 'anonymous', role: 'user', createdAt: new Date() },
  ])
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function openConversation(): Promise<ConversationId> {
  const [row] = await testDb
    .insert(conversations)
    .values({
      visitorPrincipalId: visitor,
      channel: 'messenger',
      status: 'open',
      customAttributes: {},
    })
    .returning()
  return row!.id
}

async function statusOf(id: ConversationId) {
  const row = await testDb.query.conversations.findFirst({ where: eq(conversations.id, id) })
  return row!.status
}

describe('end_conversation on a customer-support turn', () => {
  it('closes the conversation under the AI agent’s own actor', async () => {
    const conversationId = await openConversation()
    const ctx = makeAssistantToolContext({
      db: testDb,
      assistantPrincipalId: assistant,
      audience: 'public',
      conversationId,
      role: 'customer_support',
      writeToolPolicy: 'execute',
      simulate: false,
    })
    // The context defaults to the agent's bounded actor; pin that here so the
    // test cannot pass under a broader one.
    expect(ctx.actor).toEqual(quinnActor(assistant))

    const { tools } = await assembleAssistantToolset(ctx)
    const endConversation = tools.find((t) => t.name === 'end_conversation')
    expect(endConversation?.execute).toBeDefined()

    const out = await endConversation!.execute!({ reason: 'Customer confirmed they are done' }, {
      context: ctx,
      emitCustomEvent: () => {},
    } as never)

    expect(out).toMatchObject({ closed: true })
    expect(await statusOf(conversationId)).toBe('closed')
  })

  it('is the only built-in tool that the conversation.set_status grant unlocks', () => {
    const declaring = Object.values(ASSISTANT_TOOL_SPECS)
      .filter((spec) => spec.permissions.includes(PERMISSIONS.CONVERSATION_SET_STATUS))
      .map((spec) => spec.name)
    expect(declaring).toEqual(['end_conversation'])
  })
})
