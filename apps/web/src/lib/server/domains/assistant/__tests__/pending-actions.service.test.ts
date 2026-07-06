/**
 * Real-DB coverage for the pending-actions service: the propose -> decide ->
 * execute lifecycle, the expiry guard on deciding, the at-most-one-decision
 * guard, and the stale-proposal sweep. Runs inside the db-test-fixture
 * rollback transaction.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { ConversationId, PrincipalId, TicketId, TicketStatusId } from '@quackback/ids'
import { createId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  assistantPendingActions,
  conversations,
  tickets,
  ticketStatuses,
  conversationMessages,
  principal,
  eq,
  and,
} from '@/lib/server/db'

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
  getPendingActionByIdempotencyKey,
} from '../pending-actions.service'
import { ensureAssistantPrincipal } from '../assistant.principal'

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

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedTicket(): Promise<TicketId> {
  const statusId = createId('ticket_status') as TicketStatusId
  await testDb
    .insert(ticketStatuses)
    .values({ id: statusId, name: 'Open', slug: `pas-${suffix()}` })
  const [ticket] = await testDb.insert(tickets).values({ title: 'A ticket', statusId }).returning()
  return ticket.id
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

  describe('proposePendingAction: idempotency key (S1, propose-retry safety)', () => {
    it('dedupes a repeated idempotencyKey onto the same still-proposed row instead of inserting a duplicate', async () => {
      const conversationId = await seedConversation()
      const key = 'conversation_1:conversation_message_1:close_conversation:deadbeef'

      const first = await proposePendingAction({
        conversationId,
        toolName: 'close_conversation',
        args: { reason: 'resolved' },
        summary: 'Close this conversation as resolved.',
        idempotencyKey: key,
      })
      const second = await proposePendingAction({
        conversationId,
        toolName: 'close_conversation',
        args: { reason: 'resolved' },
        summary: 'Close this conversation as resolved.',
        idempotencyKey: key,
      })

      // Both calls report the SAME proposal id — a retry never orphans the
      // first attempt's row or creates a second one the caller loses track of.
      expect(second.id).toBe(first.id)

      const rows = await testDb
        .select({ id: assistantPendingActions.id })
        .from(assistantPendingActions)
        .where(eq(assistantPendingActions.idempotencyKey, key))
      expect(rows).toHaveLength(1)
    })

    it('allows a fresh proposal to reuse a key once the earlier row is no longer proposed', async () => {
      const conversationId = await seedConversation()
      const agentId = await seedPrincipal()
      const key = 'conversation_1:conversation_message_1:close_conversation:deadbeef'

      const first = await proposePendingAction({
        conversationId,
        toolName: 'close_conversation',
        args: {},
        summary: 'Close it.',
        idempotencyKey: key,
      })
      await decidePendingAction(first.id, 'rejected', agentId)

      // Same key, but the earlier row is no longer `proposed`: this must be a
      // genuinely new proposal, not a resurrection of the rejected decision.
      const second = await proposePendingAction({
        conversationId,
        toolName: 'close_conversation',
        args: {},
        summary: 'Close it, asked again.',
        idempotencyKey: key,
      })

      expect(second.id).not.toBe(first.id)
      expect(second.status).toBe('proposed')

      const rows = await testDb
        .select({ id: assistantPendingActions.id, status: assistantPendingActions.status })
        .from(assistantPendingActions)
        .where(eq(assistantPendingActions.idempotencyKey, key))
      expect(rows).toHaveLength(2)
    })

    it('the conflict-fallback path resolves to the live proposed row, not a stale executed row sharing the same key', async () => {
      const conversationId = await seedConversation()
      const agentId = await seedPrincipal()
      const key = 'conversation_1:msg_1:close_conversation:deadbeef'

      // An OLD proposal, decided and executed — its idempotencyKey column
      // stays set (the unique index only guards status = 'proposed').
      const stale = await proposePendingAction({
        conversationId,
        toolName: 'close_conversation',
        args: {},
        summary: 'An earlier turn, already done.',
        idempotencyKey: key,
      })
      await decidePendingAction(stale.id, 'approved', agentId)
      await markPendingActionExecuted(stale.id, { closed: true })

      // A fresh proposal reuses the key (no conflict: the stale row is no
      // longer `proposed`) and is still awaiting a decision.
      const current = await proposePendingAction({
        conversationId,
        toolName: 'close_conversation',
        args: {},
        summary: 'A later turn, still awaiting approval.',
        idempotencyKey: key,
      })

      // A THIRD call with the same key now genuinely conflicts (`current` is
      // still `proposed`), exercising proposePendingAction's onConflictDoNothing
      // fallback with two rows sharing the key on the table. The dedupe must
      // resolve to the live proposal, never resurrect the stale row's id.
      const deduped = await proposePendingAction({
        conversationId,
        toolName: 'close_conversation',
        args: {},
        summary: 'A later turn, still awaiting approval.',
        idempotencyKey: key,
      })
      expect(deduped.id).toBe(current.id)
      expect(deduped.id).not.toBe(stale.id)
      expect(deduped.status).toBe('proposed')
    })

    it('never conflicts across two proposals with no idempotencyKey (legacy no-key callers)', async () => {
      const conversationId = await seedConversation()

      const first = await proposePendingAction({
        conversationId,
        toolName: 'close_conversation',
        args: {},
        summary: 'Close it.',
      })
      const second = await proposePendingAction({
        conversationId,
        toolName: 'close_conversation',
        args: {},
        summary: 'Close it.',
      })

      expect(second.id).not.toBe(first.id)
    })
  })

  describe('getPendingActionByIdempotencyKey', () => {
    it('returns null when nothing carries the key', async () => {
      expect(await getPendingActionByIdempotencyKey('no_such_key')).toBeNull()
    })

    it('finds the row that claimed the key', async () => {
      const conversationId = await seedConversation()
      const proposed = await proposePendingAction({
        conversationId,
        toolName: 'close_conversation',
        args: {},
        summary: 'Close it.',
        idempotencyKey: 'conversation_1:msg_1:close_conversation:abc',
      })

      const found = await getPendingActionByIdempotencyKey(
        'conversation_1:msg_1:close_conversation:abc'
      )
      expect(found?.id).toBe(proposed.id)
    })

    it('resolves to the still-proposed row, never a stale executed row sharing the same key', async () => {
      const conversationId = await seedConversation()
      const agentId = await seedPrincipal()
      const key = 'conversation_1:msg_1:close_conversation:abc'

      // An OLD proposal that already ran its course. Its idempotencyKey
      // column is untouched by decide/execute — the unique index only covers
      // status = 'proposed', so an executed row keeps its key forever.
      const stale = await proposePendingAction({
        conversationId,
        toolName: 'close_conversation',
        args: {},
        summary: 'An earlier turn, already done.',
        idempotencyKey: key,
      })
      await decidePendingAction(stale.id, 'approved', agentId)
      await markPendingActionExecuted(stale.id, { closed: true })

      // A fresh proposal reusing the SAME key: the stale row is no longer
      // `proposed`, so this is a genuinely new row, not a conflict.
      const current = await proposePendingAction({
        conversationId,
        toolName: 'close_conversation',
        args: {},
        summary: 'A later turn, still awaiting approval.',
        idempotencyKey: key,
      })
      expect(current.id).not.toBe(stale.id)

      const found = await getPendingActionByIdempotencyKey(key)
      expect(found?.id).toBe(current.id)
      expect(found?.status).toBe('proposed')
    })
  })

  describe('ticket-scoped pending actions (unified inbox §2.9)', () => {
    it('propose -> approve -> markPendingActionExecuted round-trip, announcing via a real internal ticket message', async () => {
      const ticketId = await seedTicket()
      const agentId = await seedPrincipal()
      // Real Quinn principal (not mocked) so surfacePendingActionNote's
      // ticket branch actually runs `addTicketNote` for real against the
      // rolled-back tx, landing a genuine conversation_messages row.
      const assistant = await ensureAssistantPrincipal(testDb)

      const proposed = await proposePendingAction({
        ticketId,
        toolName: 'create_ticket',
        args: { type: 'customer', title: 'Follow-up' },
        summary: 'Create a customer ticket: "Follow-up"',
      })
      expect(proposed.ticketId).toBe(ticketId)
      expect(proposed.conversationId).toBeNull()

      const approved = await decidePendingAction(proposed.id, 'approved', agentId)
      expect(approved?.status).toBe('approved')

      const executed = await markPendingActionExecuted(proposed.id, { created: true })
      expect(executed?.status).toBe('executed')
      expect(executed?.result).toEqual({ created: true })

      // The announcement landed as a real internal note on the ticket
      // thread (not a conversation message, and never customer-visible).
      const [note] = await testDb
        .select()
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.ticketId, ticketId),
            eq(conversationMessages.isInternal, true)
          )
        )
      expect(note).toBeDefined()
      expect(note.conversationId).toBeNull()
      expect(note.principalId).toBe(assistant.id)
      expect(note.content).toBe('Requested approval: Create a customer ticket: "Follow-up"')
    })

    it('rejects a ticket-scoped proposal the same way as a conversation-scoped one', async () => {
      const ticketId = await seedTicket()
      const agentId = await seedPrincipal()

      const proposed = await proposePendingAction({
        ticketId,
        toolName: 'create_ticket',
        args: {},
        summary: 'x',
      })

      const rejected = await decidePendingAction(proposed.id, 'rejected', agentId)
      expect(rejected?.status).toBe('rejected')
    })

    it('sweep expires a stale ticket-scoped proposal the same way as a conversation-scoped one', async () => {
      const ticketId = await seedTicket()

      const stale = await proposePendingAction({
        ticketId,
        toolName: 'create_ticket',
        args: {},
        summary: 'Nobody decided in time.',
      })
      await testDb
        .update(assistantPendingActions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(assistantPendingActions.id, stale.id))

      const expired = await expireStalePendingActions()
      expect(expired.map((r) => r.id)).toEqual([stale.id])
    })
  })
})
