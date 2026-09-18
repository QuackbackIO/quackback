/**
 * The HTTP retry boundary, on real PostgreSQL.
 *
 * The interesting case is the FIRST send, which carries no conversation id: a
 * retry of it must not create a second conversation, and no amount of
 * server-side message deduplication can notice that on its own, because the two
 * requests are identical and both are legitimate-looking new threads.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

process.env.BASE_URL = 'http://localhost:4319'
process.env.SECRET_KEY = 'conversation-request-receipt-secret-at-least-32c'

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationUpdate: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationOnlyEvent: vi.fn(),
}))
vi.mock('../conversation.notify', () => ({
  notifyAgentReply: vi.fn(async () => {}),
  notifyVisitorMessage: vi.fn(),
  notifyConversationStarted: vi.fn(),
}))

import {
  db,
  conversations,
  conversationMessages,
  assistantRequestReceipts,
  principal,
  and,
  eq,
  sql,
} from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import { sendVisitorMessage } from '../conversation.service'
import type { Actor } from '@/lib/server/policy/types'

const available = await db
  .execute(sql`SELECT to_regclass('public.assistant_request_receipts') AS t`)
  .then(
    (result) => !!getExecuteRows<{ t: string | null }>(result)[0]?.t,
    () => false
  )

let visitorId: PrincipalId

function actorFor(principalId: PrincipalId): Actor {
  return { principalId, principalType: 'anonymous', role: 'user', segmentIds: new Set() }
}

async function myConversations() {
  return db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.visitorPrincipalId, visitorId))
}

describe.skipIf(!available)('visitor send retry boundary on real PostgreSQL', () => {
  beforeAll(async () => {
    const [visitor] = await db
      .insert(principal)
      .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
      .returning()
    visitorId = visitor.id
    // Durable intake would enqueue a turn job per send; the retry boundary is
    // what is under test here, so keep the queue out of it.
    process.env.ASSISTANT_EXECUTION_MODE = 'legacy'
  })

  afterAll(async () => {
    delete process.env.ASSISTANT_EXECUTION_MODE
    for (const { id } of await myConversations()) {
      await db.delete(conversations).where(eq(conversations.id, id))
    }
    if (visitorId) {
      await db
        .delete(assistantRequestReceipts)
        .where(eq(assistantRequestReceipts.principalId, visitorId))
      await db.delete(principal).where(eq(principal.id, visitorId))
    }
  })

  it('returns the same identities and creates one conversation when the first send is retried', async () => {
    const author = { principalId: visitorId, displayName: 'Visitor' }
    const payload = {
      content: 'my order never arrived',
      clientMutationId: 'mutation-first-send',
    }

    const first = await sendVisitorMessage(payload, author, actorFor(visitorId))
    expect(first.created).toBe(true)
    const replay = await sendVisitorMessage(payload, author, actorFor(visitorId))

    expect(replay.conversation.id).toBe(first.conversation.id)
    expect(replay.message.id).toBe(first.message.id)
    // A replay did not create the conversation; only the original send did.
    expect(replay.created).toBe(false)
    expect(await myConversations()).toHaveLength(1)
    const messages = await db
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, first.conversation.id as ConversationId),
          eq(conversationMessages.senderType, 'visitor')
        )
      )
    expect(messages).toHaveLength(1)
  })

  it('rejects the same key with different content instead of answering with the old result', async () => {
    const author = { principalId: visitorId, displayName: 'Visitor' }
    const conversationId = (await myConversations())[0].id
    await sendVisitorMessage(
      { conversationId, content: 'first body', clientMutationId: 'mutation-reused' },
      author,
      actorFor(visitorId)
    )
    await expect(
      sendVisitorMessage(
        { conversationId, content: 'a different body', clientMutationId: 'mutation-reused' },
        author,
        actorFor(visitorId)
      )
    ).rejects.toThrow(/already used/i)
  })

  it('leaves older clients that omit the key working unchanged', async () => {
    const author = { principalId: visitorId, displayName: 'Visitor' }
    const conversationId = (await myConversations())[0].id
    const a = await sendVisitorMessage(
      { conversationId, content: 'no key A' },
      author,
      actorFor(visitorId)
    )
    const b = await sendVisitorMessage(
      { conversationId, content: 'no key B' },
      author,
      actorFor(visitorId)
    )
    expect(a.message.id).not.toBe(b.message.id)
    const receipts = await db
      .select()
      .from(assistantRequestReceipts)
      .where(eq(assistantRequestReceipts.principalId, visitorId))
    // Only the keyed sends above wrote receipts.
    expect(receipts).toHaveLength(2)
  })
})
