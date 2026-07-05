/**
 * Real-DB coverage for the tool-call audit log: the idempotency claim (a
 * duplicate key is rejected, two NULL keys never conflict), and finalizing a
 * claimed call. Runs inside the db-test-fixture rollback transaction.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { ConversationId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { assistantToolCalls, conversations, principal, eq } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { claimToolCall, finalizeToolCall, recordDeniedToolCall } from '../tool-audit'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: assistantToolCalls.id }).from(assistantToolCalls).limit(0)
  },
})

async function seedConversation(): Promise<ConversationId> {
  const [visitor] = await testDb
    .insert(principal)
    .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
    .returning()
  const [conversation] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: visitor.id, channel: 'messenger' })
    .returning()
  return conversation.id
}

describe.skipIf(!fixture.available)('tool-audit (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('claims a tool call and starts it', async () => {
    const conversationId = await seedConversation()
    const claimed = await claimToolCall({
      conversationId,
      toolName: 'close_conversation',
      args: { reason: 'resolved' },
      idempotencyKey: 'turn-1:close_conversation',
    })
    expect(claimed?.status).toBe('started')
    expect(claimed?.toolName).toBe('close_conversation')
  })

  it('a duplicate idempotency key is rejected on the second claim', async () => {
    const conversationId = await seedConversation()
    const first = await claimToolCall({
      conversationId,
      toolName: 'refund_charge',
      args: { amount: 10 },
      idempotencyKey: 'turn-1:refund_charge',
    })
    expect(first).not.toBeNull()

    const second = await claimToolCall({
      conversationId,
      toolName: 'refund_charge',
      args: { amount: 10 },
      idempotencyKey: 'turn-1:refund_charge',
    })
    expect(second).toBeNull()
  })

  it('two calls with no idempotency key never conflict', async () => {
    const conversationId = await seedConversation()
    const first = await claimToolCall({
      conversationId,
      toolName: 'search_kb',
      args: { query: 'refunds' },
    })
    const second = await claimToolCall({
      conversationId,
      toolName: 'search_kb',
      args: { query: 'refunds' },
    })
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first?.id).not.toBe(second?.id)
  })

  it('finalizeToolCall sets the terminal status and result fields', async () => {
    const conversationId = await seedConversation()
    const claimed = await claimToolCall({
      conversationId,
      toolName: 'close_conversation',
      args: {},
      idempotencyKey: 'turn-2:close_conversation',
    })
    if (!claimed) throw new Error('expected a claim')

    await finalizeToolCall(claimed.id, {
      status: 'succeeded',
      resultSummary: 'Conversation closed.',
      latencyMs: 120,
    })

    const [row] = await testDb
      .select()
      .from(assistantToolCalls)
      .where(eq(assistantToolCalls.id, claimed.id))
    expect(row.status).toBe('succeeded')
    expect(row.resultSummary).toBe('Conversation closed.')
    expect(row.latencyMs).toBe(120)
  })

  it('recordDeniedToolCall writes a denial with no prior claim', async () => {
    const conversationId = await seedConversation()
    const denied = await recordDeniedToolCall({
      conversationId,
      toolName: 'refund_charge',
      args: { amount: 999 },
      reason: 'exceeds auto-approval limit',
    })
    expect(denied.status).toBe('denied')
    expect(denied.error).toBe('exceeds auto-approval limit')
  })
})
