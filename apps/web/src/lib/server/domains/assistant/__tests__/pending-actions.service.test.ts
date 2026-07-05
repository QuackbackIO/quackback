/**
 * Real-DB coverage for the pending-actions service: the propose -> decide ->
 * execute lifecycle, the expiry guard on deciding, the at-most-one-decision
 * guard, and the stale-proposal sweep. Runs inside the db-test-fixture
 * rollback transaction.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { ConversationId, PrincipalId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { assistantPendingActions, conversations, principal, eq } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  proposePendingAction,
  decidePendingAction,
  markPendingActionExecuted,
  markPendingActionFailed,
  expireStalePendingActions,
} from '../pending-actions.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: assistantPendingActions.id }).from(assistantPendingActions).limit(0)
  },
})

async function seedPrincipal(): Promise<PrincipalId> {
  const [row] = await testDb
    .insert(principal)
    .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
    .returning()
  return row.id
}

async function seedConversation(): Promise<ConversationId> {
  const visitorId = await seedPrincipal()
  const [conversation] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: visitorId, channel: 'messenger' })
    .returning()
  return conversation.id
}

describe.skipIf(!fixture.available)('pending-actions.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('propose -> approve -> markPendingActionExecuted happy path', async () => {
    const conversationId = await seedConversation()
    const agentId = await seedPrincipal()

    const proposed = await proposePendingAction({
      conversationId,
      toolName: 'close_conversation',
      args: { reason: 'resolved' },
      summary: 'Close this conversation as resolved.',
    })
    expect(proposed.status).toBe('proposed')
    expect(proposed.expiresAt.getTime()).toBeGreaterThan(Date.now())

    const approved = await decidePendingAction(proposed.id, 'approved', agentId)
    expect(approved?.status).toBe('approved')
    expect(approved?.decidedById).toBe(agentId)
    expect(approved?.decidedAt).not.toBeNull()

    const executed = await markPendingActionExecuted(proposed.id, { closed: true })
    expect(executed?.status).toBe('executed')
    expect(executed?.result).toEqual({ closed: true })
    expect(executed?.executedAt).not.toBeNull()
  })

  it('rejects a proposal', async () => {
    const conversationId = await seedConversation()
    const agentId = await seedPrincipal()
    const proposed = await proposePendingAction({
      conversationId,
      toolName: 'refund_charge',
      args: { amount: 10 },
      summary: 'Refund $10.',
    })

    const rejected = await decidePendingAction(proposed.id, 'rejected', agentId)
    expect(rejected?.status).toBe('rejected')
  })

  it('markPendingActionFailed records the error on an approved action', async () => {
    const conversationId = await seedConversation()
    const agentId = await seedPrincipal()
    const proposed = await proposePendingAction({
      conversationId,
      toolName: 'refund_charge',
      args: { amount: 10 },
      summary: 'Refund $10.',
    })
    await decidePendingAction(proposed.id, 'approved', agentId)

    const failed = await markPendingActionFailed(proposed.id, 'payment provider timed out')
    expect(failed?.status).toBe('failed')
    expect(failed?.result).toEqual({ error: 'payment provider timed out' })
  })

  it('returns null when approving after the proposal has expired', async () => {
    const conversationId = await seedConversation()
    const agentId = await seedPrincipal()
    const proposed = await proposePendingAction({
      conversationId,
      toolName: 'close_conversation',
      args: {},
      summary: 'Close it.',
    })
    await testDb
      .update(assistantPendingActions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(assistantPendingActions.id, proposed.id))

    expect(await decidePendingAction(proposed.id, 'approved', agentId)).toBeNull()
  })

  it('returns null on a second decision (at-most-one guard)', async () => {
    const conversationId = await seedConversation()
    const agentId = await seedPrincipal()
    const proposed = await proposePendingAction({
      conversationId,
      toolName: 'close_conversation',
      args: {},
      summary: 'Close it.',
    })

    expect((await decidePendingAction(proposed.id, 'approved', agentId))?.status).toBe('approved')
    expect(await decidePendingAction(proposed.id, 'rejected', agentId)).toBeNull()
  })

  it('sweep expires only stale proposed rows', async () => {
    const conversationId = await seedConversation()
    const agentId = await seedPrincipal()

    const fresh = await proposePendingAction({
      conversationId,
      toolName: 'close_conversation',
      args: {},
      summary: 'Still within its TTL.',
    })
    const stale = await proposePendingAction({
      conversationId,
      toolName: 'close_conversation',
      args: {},
      summary: 'Nobody decided in time.',
    })
    const decidedButPastExpiry = await proposePendingAction({
      conversationId,
      toolName: 'close_conversation',
      args: {},
      summary: 'Already approved before the sweep runs.',
    })
    await decidePendingAction(decidedButPastExpiry.id, 'approved', agentId)

    await testDb
      .update(assistantPendingActions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(assistantPendingActions.id, stale.id))
    // Also push the decided one's expiry into the past — it must stay untouched
    // because it is no longer `proposed`.
    await testDb
      .update(assistantPendingActions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(assistantPendingActions.id, decidedButPastExpiry.id))

    const expired = await expireStalePendingActions()
    expect(expired.map((r) => r.id)).toEqual([stale.id])

    const [untouchedFresh] = await testDb
      .select({ status: assistantPendingActions.status })
      .from(assistantPendingActions)
      .where(eq(assistantPendingActions.id, fresh.id))
    expect(untouchedFresh?.status).toBe('proposed')

    const [untouchedDecided] = await testDb
      .select({ status: assistantPendingActions.status })
      .from(assistantPendingActions)
      .where(eq(assistantPendingActions.id, decidedButPastExpiry.id))
    expect(untouchedDecided?.status).toBe('approved')
  })
})
