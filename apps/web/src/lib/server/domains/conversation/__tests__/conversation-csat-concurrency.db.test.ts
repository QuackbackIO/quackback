/** Real-Postgres proof that the CSAT row lock serializes racing widget calls. */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { createId, type ConversationId, type PrincipalId, type UserId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

const emit = vi.hoisted(() => ({
  submitted: vi.fn(),
  commentAdded: vi.fn(),
}))

vi.mock('../conversation.webhooks', () => ({
  emitConversationCreated: vi.fn(),
  emitMessageCreated: vi.fn(),
  emitMessageNoteCreated: vi.fn(),
  emitMessageDeleted: vi.fn(),
  emitConversationStatusChanged: vi.fn(),
  emitConversationAssigned: vi.fn(),
  emitConversationPriorityChanged: vi.fn(),
  emitConversationCsatSubmitted: emit.submitted,
  emitConversationCsatCommentAdded: emit.commentAdded,
}))

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
}))

vi.mock('../conversation.query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversation.query')>()),
  conversationToDTO: vi.fn(async (row: { id: string }) => ({ id: row.id })),
}))

vi.mock('@/lib/server/domains/assistant/assistant.orchestrator', () => ({
  attributeCsatIfLastHandler: vi.fn(),
}))

import { db, conversations, principal, user, eq, sql } from '@/lib/server/db'
import { recordCsat } from '../conversation.service'

let available = false
try {
  await db.execute(sql`select 1`)
  available = true
} catch {
  // Local/unit-only runs without Postgres skip this integration proof.
}

let conversationId: ConversationId | null = null
let principalId: PrincipalId | null = null
let userId: UserId | null = null

afterEach(async () => {
  if (!available) return
  if (conversationId) await db.delete(conversations).where(eq(conversations.id, conversationId))
  if (principalId) await db.delete(principal).where(eq(principal.id, principalId))
  if (userId) await db.delete(user).where(eq(user.id, userId))
  conversationId = null
  principalId = null
  userId = null
  vi.clearAllMocks()
})

afterAll(async () => {
  const client = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client
  await client?.end?.()
})

describe.skipIf(!available)('recordCsat concurrency', () => {
  it('keeps one score and emits each once when rating and comment calls race', async () => {
    userId = createId('user') as UserId
    principalId = createId('principal') as PrincipalId
    conversationId = createId('conversation') as ConversationId
    await db.insert(user).values({ id: userId, name: 'CSAT concurrency visitor' })
    await db.insert(principal).values({
      id: principalId,
      userId,
      role: 'user',
      type: 'user',
      createdAt: new Date(),
    })
    await db.insert(conversations).values({
      id: conversationId,
      visitorPrincipalId: principalId,
      channel: 'messenger',
    })

    const actor: Actor = {
      principalId,
      role: 'user',
      principalType: 'user',
      segmentIds: new Set(),
    }
    await Promise.all([
      recordCsat(conversationId, 5, undefined, actor),
      recordCsat(conversationId, 1, 'context', actor),
    ])

    const stored = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
    })
    expect(stored?.csatRating).toBe(emit.submitted.mock.calls[0]?.[1]?.csatRating)
    expect(stored?.csatSubmittedAt).toEqual(emit.submitted.mock.calls[0]?.[1]?.csatSubmittedAt)
    expect(stored?.csatComment).toBe('context')
    expect(emit.submitted).toHaveBeenCalledTimes(1)
    expect(emit.commentAdded).toHaveBeenCalledTimes(1)
  })
})
