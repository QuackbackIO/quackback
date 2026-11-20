/**
 * Real-Postgres proof of what a new message does to a conversation filed as
 * spam (CUS-E-15):
 *
 *  - a CUSTOMER message lands in the thread, but the conversation stays closed
 *    and in Spam: no reopen, no team alert, no message event (so no workflow
 *    trigger, webhook or next-response SLA re-arm), and the filing time the
 *    retention sweep keys on is untouched;
 *  - a TEAMMATE reply or reopen takes it out of Spam, clearing the spam marker
 *    the same way Restore does.
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

vi.mock('../conversation.notify', () => ({
  notifyVisitorMessage: vi.fn(async () => {}),
  notifyAgentReply: vi.fn(async () => {}),
  notifyConversationStarted: vi.fn(async () => {}),
}))

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: vi.fn(),
  publishConversationMessage: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
}))

vi.mock('@/lib/server/realtime/inbox-publish', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/realtime/inbox-publish')>()),
  publishInboxRemoval: vi.fn(),
  publishInboxRemovals: vi.fn(async () => {}),
}))

vi.mock('../conversation.query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversation.query')>()),
  conversationToDTO: vi.fn(async (row: { id: string }) => ({ id: row.id })),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, conversationMessages, principal, user, eq } from '@/lib/server/db'
import {
  autoFileConversationAsSpam,
  endConversation,
  sendAgentMessage,
  sendVisitorMessage,
  setConversationStatus,
} from '../conversation.service'
import { sweepFiledSpamConversations } from '../conversation.spam-retention'
import { emitMessageCreated } from '../conversation.webhooks'
import { notifyVisitorMessage } from '../conversation.notify'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ spamReason: conversations.spamReason }).from(conversations).limit(0)
  },
})

let agentPrincipalId: PrincipalId
let visitorPrincipalId: PrincipalId

function agentActor(): Actor {
  return {
    principalId: agentPrincipalId,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
  }
}

function visitorActor(): Actor {
  return {
    principalId: visitorPrincipalId,
    role: 'user',
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

async function load(id: ConversationId) {
  return testDb.query.conversations.findFirst({ where: eq(conversations.id, id) })
}

async function customerSays(id: ConversationId, content: string) {
  return sendVisitorMessage(
    { conversationId: id, content },
    { principalId: visitorPrincipalId, displayName: 'Visitor' },
    visitorActor()
  )
}

describe.skipIf(!fixture.available)('a new message on a conversation filed as spam', () => {
  beforeEach(fixture.begin)
  afterEach(() => vi.clearAllMocks())
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('a customer message lands but the conversation stays closed and in Spam, with no alerts', async () => {
    const id = await seedConversation()
    expect(await autoFileConversationAsSpam(id, 'ai_classifier')).toBe(true)
    const filed = await load(id)
    vi.clearAllMocks()

    await customerSays(id, 'buy my stuff, again')

    const stored = await load(id)
    expect(stored?.status).toBe('closed')
    expect(stored?.endReason).toBe('spam')
    expect(stored?.spamReason).toBe('ai_classifier')
    // The filing time the retention sweep keys on does not move.
    expect(stored?.resolvedAt?.toISOString()).toBe(filed?.resolvedAt?.toISOString())
    // Nobody is waiting on a reply to spam.
    expect(stored?.waitingSince).toBeNull()

    // The message itself is kept, so a teammate reviewing Spam sees it.
    const messages = await testDb
      .select({ content: conversationMessages.content })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, id))
    expect(messages.map((m) => m.content)).toContain('buy my stuff, again')

    // No team email/bell, and no message event: the event is what drives
    // workflow triggers, webhooks and the next-response SLA re-arm.
    expect(notifyVisitorMessage).not.toHaveBeenCalled()
    expect(emitMessageCreated).not.toHaveBeenCalled()
  })

  it('repeated customer messages cannot keep filed spam past the retention window', async () => {
    const id = await seedConversation()
    await autoFileConversationAsSpam(id, 'ai_classifier')
    const longAgo = new Date(Date.now() - 31 * 86_400_000)
    await testDb.update(conversations).set({ resolvedAt: longAgo }).where(eq(conversations.id, id))

    await customerSays(id, 'still here')

    await sweepFiledSpamConversations()
    expect(await load(id)).toBeUndefined()
  })

  it('a customer message on a plain closed conversation still reopens it and alerts the team', async () => {
    const id = await seedConversation()
    await endConversation(id, 'resolved', null, agentActor())
    vi.clearAllMocks()

    await customerSays(id, 'one more thing')

    const stored = await load(id)
    expect(stored?.status).toBe('open')
    expect(stored?.resolvedAt).toBeNull()
    expect(notifyVisitorMessage).toHaveBeenCalledTimes(1)
    expect(emitMessageCreated).toHaveBeenCalledTimes(1)
  })

  it('a teammate reply takes the conversation out of Spam, like Restore', async () => {
    const id = await seedConversation()
    await endConversation(id, 'spam', 'looked like junk', agentActor())

    await sendAgentMessage(
      id,
      'Sorry, this was filed by mistake',
      { principalId: agentPrincipalId, displayName: 'Agent' },
      agentActor()
    )

    const stored = await load(id)
    expect(stored?.status).toBe('open')
    expect(stored?.endReason).toBeNull()
    expect(stored?.endNote).toBeNull()
    expect(stored?.spamReason).toBeNull()
    expect(stored?.resolvedAt).toBeNull()
  })

  it('a teammate reopen takes the conversation out of Spam, like Restore', async () => {
    const id = await seedConversation()
    await autoFileConversationAsSpam(id, 'ai_classifier')

    await setConversationStatus(id, 'open', agentActor())

    const stored = await load(id)
    expect(stored?.status).toBe('open')
    expect(stored?.endReason).toBeNull()
    expect(stored?.endNote).toBeNull()
    expect(stored?.spamReason).toBeNull()
  })

  it('closing a conversation that is already in Spam keeps it in Spam', async () => {
    const id = await seedConversation()
    await autoFileConversationAsSpam(id, 'ai_classifier')

    await setConversationStatus(id, 'closed', agentActor())

    const stored = await load(id)
    expect(stored?.endReason).toBe('spam')
    expect(stored?.spamReason).toBe('ai_classifier')
  })
})
