/**
 * Real-Postgres proof of the spam lifecycle: a spam-ended conversation leaves
 * every triage list, surfaces only in the Spam view (`spamOnly`), and a
 * restore returns it to the open queue with the spam marker fully cleared.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type ConversationId, type PrincipalId, type UserId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
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

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: vi.fn(),
  publishConversationMessage: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
}))

vi.mock('../conversation.query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversation.query')>()),
  conversationToDTO: vi.fn(async (row: { id: string }) => ({ id: row.id })),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, conversationMessages, principal, user, eq } from '@/lib/server/db'
import {
  endConversation,
  restoreConversationFromSpam,
  deleteConversationPermanently,
} from '../conversation.service'
import { listConversationsForAgent } from '../conversation.query'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ spamReason: conversations.spamReason }).from(conversations).limit(0)
  },
})

let agentPrincipalId: PrincipalId | null = null
let visitorPrincipalId: PrincipalId | null = null

function agentActor(): Actor {
  return {
    principalId: agentPrincipalId,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
  }
}

async function seedConversation(): Promise<ConversationId> {
  const agentUserId = createId('user') as UserId
  const visitorUserId = createId('user') as UserId
  agentPrincipalId = createId('principal') as PrincipalId
  visitorPrincipalId = createId('principal') as PrincipalId
  const conversationId = createId('conversation') as ConversationId
  await testDb.insert(user).values([
    { id: agentUserId, name: 'Agent' },
    { id: visitorUserId, name: 'Visitor' },
  ])
  await testDb.insert(principal).values([
    {
      id: agentPrincipalId,
      userId: agentUserId,
      role: 'admin',
      type: 'user',
      createdAt: new Date(),
    },
    {
      id: visitorPrincipalId,
      userId: visitorUserId,
      role: 'user',
      type: 'user',
      createdAt: new Date(),
    },
  ])
  await testDb.insert(conversations).values({
    id: conversationId,
    visitorPrincipalId,
    channel: 'messenger',
  })
  return conversationId
}

describe.skipIf(!fixture.available)('spam lifecycle', () => {
  beforeEach(fixture.begin)
  afterEach(() => vi.clearAllMocks())
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('a spam-ended conversation leaves every triage list and only surfaces in the spam list', async () => {
    const id = await seedConversation()
    await endConversation(id, 'spam', null, agentActor())

    const ids = (page: { conversations: Array<{ id: string }> }) =>
      page.conversations.map((c) => c.id)

    // Every triage facet is blind to it: the open queue, the closed list, and
    // the unfiltered (facet 'all') feed.
    expect(ids(await listConversationsForAgent({ status: 'open' }, agentActor()))).not.toContain(id)
    expect(ids(await listConversationsForAgent({ status: 'closed' }, agentActor()))).not.toContain(
      id
    )
    expect(ids(await listConversationsForAgent({}, agentActor()))).not.toContain(id)

    // The Spam view is the one list that surfaces it — and lists nothing else.
    const spam = await listConversationsForAgent({ spamOnly: true }, agentActor())
    expect(ids(spam)).toContain(id)
    expect(spam.conversations.every((c) => c.status === 'closed' && c.endReason === 'spam')).toBe(
      true
    )
    // An agent-filed spam records 'manual' as its filing reason.
    expect(spam.conversations.find((c) => c.id === id)?.spamReason).toBe('manual')
  })

  it('restore reopens the thread, clears the spam marker, and returns it to triage', async () => {
    const id = await seedConversation()
    await endConversation(id, 'spam', 'obvious junk', agentActor())

    await restoreConversationFromSpam(id, agentActor())

    const stored = await testDb.query.conversations.findFirst({ where: eq(conversations.id, id) })
    expect(stored?.status).toBe('open')
    expect(stored?.endReason).toBeNull()
    expect(stored?.endNote).toBeNull()
    expect(stored?.spamReason).toBeNull()
    expect(stored?.resolvedAt).toBeNull()

    const ids = (page: { conversations: Array<{ id: string }> }) =>
      page.conversations.map((c) => c.id)
    expect(ids(await listConversationsForAgent({ status: 'open' }, agentActor()))).toContain(id)
    expect(ids(await listConversationsForAgent({ spamOnly: true }, agentActor()))).not.toContain(id)
  })

  it('restore rejects a conversation that was never marked spam', async () => {
    const id = await seedConversation()
    await expect(restoreConversationFromSpam(id, agentActor())).rejects.toThrow()
  })

  it('delete-forever removes a spam-ended conversation and its cascaded children', async () => {
    const id = await seedConversation()
    await testDb.insert(conversationMessages).values({
      conversationId: id,
      principalId: visitorPrincipalId,
      senderType: 'visitor',
      content: 'buy my stuff',
    })
    await endConversation(id, 'spam', null, agentActor())

    await deleteConversationPermanently(id, agentActor())

    const stored = await testDb.query.conversations.findFirst({ where: eq(conversations.id, id) })
    expect(stored).toBeUndefined()
    const messages = await testDb
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, id))
    expect(messages).toEqual([])
    const spam = await listConversationsForAgent({ spamOnly: true }, agentActor())
    expect(spam.conversations.map((c) => c.id)).not.toContain(id)
  })

  it('delete-forever rejects a conversation that is not marked spam', async () => {
    const id = await seedConversation()
    await expect(deleteConversationPermanently(id, agentActor())).rejects.toThrow()
    const stored = await testDb.query.conversations.findFirst({ where: eq(conversations.id, id) })
    expect(stored?.status).toBe('open')
  })
})
