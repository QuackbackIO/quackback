/**
 * "Reopen when a visitor replies" (stored as messenger.preventRepliesWhenClosed)
 * reaches the visitor's thread: the thread load says whether a reply reopens a
 * closed conversation, and with the setting off a reply to a closed one is
 * refused with CONVERSATION_CLOSED, the code the thread explains.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId, type WorkspaceId } from '@quackback/ids'
import { createDbTestFixture, testDb } from './db-test-fixture'
import { principal, user, conversations, eq, settings } from '@/lib/server/db'
import type { AuthContext } from '@/lib/server/functions/auth-helpers'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('./db-test-fixture')).testDb,
}))
import { getOrCreateTestCustomer } from '../test-customer'
import {
  runGetMyConversation,
  runSendConversationMessage,
} from '@/lib/server/functions/conversation'

const fixture = await createDbTestFixture()

async function seed(preventRepliesWhenClosed: boolean): Promise<AuthContext> {
  const owner = createId('principal')
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Acme',
    slug: 'acme',
    createdAt: new Date(),
    widgetConfig: JSON.stringify({ messenger: { preventRepliesWhenClosed } }),
  })
  const uid = createId('user')
  await testDb.insert(user).values({ id: uid, name: 'Acme', email: 'you@example.com' })
  await testDb
    .insert(principal)
    .values({ id: owner, userId: uid, role: 'admin', type: 'user', createdAt: new Date() })
  // A teammate's test customer can use the messenger while it is off for everyone else.
  const customer = await getOrCreateTestCustomer(owner, 'en')
  return {
    settings: {
      id: createId('workspace') as WorkspaceId,
      slug: 'acme',
      name: 'Acme',
      logoKey: null,
    },
    user: { id: customer.userId as UserId, email: '', name: 'Visitor', image: null },
    principal: { id: customer.id as PrincipalId, role: 'user', type: 'anonymous' },
    permissions: [],
    scope: 'widget',
  }
}

async function closedThread(ctx: AuthContext): Promise<string> {
  const sent = await runSendConversationMessage(ctx, { content: 'Hi! Is anyone there?' })
  const id = sent.conversation.id
  await testDb
    .update(conversations)
    .set({ status: 'closed', resolvedAt: new Date() })
    .where(eq(conversations.id, id as never))
  return id
}

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
})
afterEach(fixture.rollback)
afterAll(fixture.close)

describe('replies to a closed conversation', () => {
  it('reopen it by default, and the thread says so', async () => {
    const ctx = await seed(false)
    const id = await closedThread(ctx)
    expect((await runGetMyConversation(ctx, { conversationId: id })).reopensOnReply).toBe(true)
    await runSendConversationMessage(ctx, { conversationId: id, content: 'One more thing' })
    const [stored] = await testDb
      .select({ status: conversations.status })
      .from(conversations)
      .where(eq(conversations.id, id as never))
    expect(stored?.status).toBe('open')
  })

  it('are refused when the workspace prevents them, and the thread says so', async () => {
    const ctx = await seed(true)
    const id = await closedThread(ctx)
    expect((await runGetMyConversation(ctx, { conversationId: id })).reopensOnReply).toBe(false)
    await expect(
      runSendConversationMessage(ctx, { conversationId: id, content: 'One more thing' })
    ).rejects.toMatchObject({ code: 'CONVERSATION_CLOSED', statusCode: 409 })
  })
})
