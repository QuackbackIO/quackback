/**
 * Real-Postgres proof that a messenger thread a fixed spam rule files raises
 * nothing, like cold email filed the same way: the team gets no email or
 * bell, no created or message event fires (so no webhook, workflow or SLA
 * clock), the inbox is not told about it and routing does not assign it. The
 * rule is decided before the thread exists and the thread is filed in its
 * insert. The burst rule (one sender opening threads faster than a person
 * types) is driven through the real rate buckets; the threads before the
 * burst are the control that a real thread does raise its signals.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type ConversationId, type PrincipalId, type UserId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('../conversation.webhooks', () => ({
  emitConversationCreated: vi.fn(async () => {}),
  emitMessageCreated: vi.fn(async () => {}),
  emitMessageNoteCreated: vi.fn(),
  emitMessageDeleted: vi.fn(),
  emitConversationStatusChanged: vi.fn(async () => {}),
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

vi.mock('../conversation.query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversation.query')>()),
  conversationToDTO: vi.fn(async (row: { id: string; status: string }) => ({
    id: row.id,
    status: row.status,
  })),
}))

// The AI classifier is off in this workspace's settings; a call would be a bug.
const mockChat = vi.fn()
vi.mock('@tanstack/ai', () => ({ chat: (...args: unknown[]) => mockChat(...args) }))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, principal, settings, user, eq, sql } from '@/lib/server/db'
import { sendVisitorMessage } from '../conversation.service'
import { emitConversationCreated, emitMessageCreated } from '../conversation.webhooks'
import { notifyVisitorMessage } from '../conversation.notify'
import {
  publishConversationMessage,
  publishConversationUpdate,
} from '@/lib/server/realtime/conversation-channels'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ spamReason: conversations.spamReason }).from(conversations).limit(0)
    await db.execute(sql`select workspace_key, key, count from rate_bucket limit 0`)
  },
})

const SENDER = 'burst-visitor@example.com'
let visitorPrincipalId: PrincipalId

function visitorActor(): Actor {
  return {
    principalId: visitorPrincipalId,
    role: 'user',
    principalType: 'anonymous',
    segmentIds: new Set(),
  }
}

async function seed(): Promise<void> {
  await testDb.delete(settings)
  await testDb.insert(settings).values({
    name: 'Test',
    slug: `t-${Date.now().toString(36)}`,
    createdAt: new Date(),
    spamFilterConfig: JSON.stringify({ aiClassifier: false, trustedSenders: [] }),
  })
  const visitorUserId = createId('user') as UserId
  visitorPrincipalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: visitorUserId, name: 'Visitor' })
  await testDb.insert(principal).values({
    id: visitorPrincipalId,
    userId: visitorUserId,
    role: 'user',
    type: 'anonymous',
    createdAt: new Date(),
  })
  await testDb.execute(sql`delete from rate_bucket where key like 'conversation:cold:burst:%'`)
}

/** A new messenger thread, with the email the visitor gave before the chat. */
async function startThread(content: string): Promise<ConversationId> {
  const res = await sendVisitorMessage(
    { content, visitorEmail: SENDER },
    { principalId: visitorPrincipalId, displayName: 'Visitor' },
    visitorActor()
  )
  return res.conversation.id as ConversationId
}

/** Calls of a spy whose first argument (or its `conversation`) is this thread. */
function callsFor(spy: unknown, id: ConversationId): number {
  return (spy as { mock: { calls: unknown[][] } }).mock.calls.filter((args) =>
    JSON.stringify(args).includes(id)
  ).length
}

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  vi.clearAllMocks()
  await seed()
})
afterEach(fixture.rollback)
afterAll(fixture.close)

describe('a messenger thread filed by the burst rule', () => {
  it('is filed in Spam and raises nothing; the threads before it raised their signals', async () => {
    // Three threads in ten minutes is the most a person opens: each is real.
    const real: ConversationId[] = []
    for (let i = 0; i < 3; i++) real.push(await startThread(`Question ${i}`))
    for (const id of real) {
      expect(callsFor(notifyVisitorMessage, id)).toBe(1)
      expect(callsFor(emitConversationCreated, id)).toBe(1)
      expect(callsFor(emitMessageCreated, id)).toBe(1)
      expect(callsFor(publishConversationUpdate, id)).toBeGreaterThan(0)
    }

    const burst = await startThread('Buy followers now')

    // Filed, whenever the filing happens.
    await vi.waitFor(async () => {
      const stored = await testDb.query.conversations.findFirst({
        where: eq(conversations.id, burst),
      })
      expect(stored?.endReason).toBe('spam')
    })
    // Let any fire-and-forget notification start if it is going to.
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(callsFor(notifyVisitorMessage, burst)).toBe(0)
    expect(callsFor(emitConversationCreated, burst)).toBe(0)
    expect(callsFor(emitMessageCreated, burst)).toBe(0)
    expect(callsFor(publishConversationUpdate, burst)).toBe(0)
    expect(callsFor(publishConversationMessage, burst)).toBe(0)
    expect(mockChat).not.toHaveBeenCalled()

    // Filed in the insert: nobody is waiting on a reply to spam.
    const stored = await testDb.query.conversations.findFirst({
      where: eq(conversations.id, burst),
    })
    expect(stored).toMatchObject({
      status: 'closed',
      endReason: 'spam',
      spamReason: 'burst_rate',
      waitingSince: null,
      assignedAgentPrincipalId: null,
    })
    expect(stored?.resolvedAt).not.toBeNull()
  })
})
