/**
 * Coverage for the propose-time inbox note and the expiry sweep's customer
 * notice — the two conversation-domain seams `pending-actions.service` calls
 * into. Real DB for the pending-action rows themselves; the conversation
 * domain is mocked at the module boundary so these tests assert the seam
 * (right call, right args, never fails the caller) rather than re-testing
 * message persistence.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { ConversationId, PrincipalId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { assistantPendingActions, conversations, principal, eq } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const mockGetAssistantPrincipal = vi.fn()
vi.mock('../assistant.principal', () => ({
  getAssistantPrincipal: (...args: unknown[]) => mockGetAssistantPrincipal(...args),
}))

const mockAppendNote = vi.fn()
const mockEmitExpired = vi.fn()
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  appendAssistantPendingActionNote: (...args: unknown[]) => mockAppendNote(...args),
  emitAssistantActionExpiredSystemMessage: (...args: unknown[]) => mockEmitExpired(...args),
}))

const mockLoggerWarn = vi.fn()
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ warn: (...args: unknown[]) => mockLoggerWarn(...args) }) },
}))

import {
  proposePendingAction,
  decidePendingAction,
  sweepAndNotifyExpiredPendingActions,
} from '../pending-actions.service'

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

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: assistantPendingActions.id }).from(assistantPendingActions).limit(0)
  },
})

describe.skipIf(!fixture.available)('proposePendingAction: propose-time note', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  // close() is called once, from the last describe block in this file — the
  // fixture (and its `created` guard) is module-global, shared across both.

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces an inbox note carrying the pending action id, tool name, and summary', async () => {
    mockGetAssistantPrincipal.mockResolvedValue({ id: 'principal_quinn', displayName: 'Quinn' })
    const conversationId = await seedConversation()

    const proposed = await proposePendingAction({
      conversationId,
      toolName: 'close_conversation',
      args: { reason: 'resolved' },
      summary: 'Close this conversation as resolved.',
    })

    expect(mockAppendNote).toHaveBeenCalledWith(
      conversationId,
      {
        pendingActionId: proposed.id,
        toolName: 'close_conversation',
        summary: 'Close this conversation as resolved.',
      },
      { principalId: 'principal_quinn', displayName: 'Quinn' }
    )
  })

  it('does not fail the proposal when the note append throws', async () => {
    mockGetAssistantPrincipal.mockResolvedValue({ id: 'principal_quinn', displayName: 'Quinn' })
    mockAppendNote.mockRejectedValue(new Error('publish boom'))
    const conversationId = await seedConversation()

    const proposed = await proposePendingAction({
      conversationId,
      toolName: 'close_conversation',
      args: {},
      summary: 'Close it.',
    })

    expect(proposed.status).toBe('proposed')
    expect(mockLoggerWarn).toHaveBeenCalled()
  })

  it('skips the note when quinn has not been provisioned yet', async () => {
    mockGetAssistantPrincipal.mockResolvedValue(null)
    const conversationId = await seedConversation()

    await proposePendingAction({
      conversationId,
      toolName: 'close_conversation',
      args: {},
      summary: 'x',
    })

    expect(mockAppendNote).not.toHaveBeenCalled()
  })

  it('does not re-announce the note when a retry dedupes onto an already-proposed row (S1)', async () => {
    mockGetAssistantPrincipal.mockResolvedValue({ id: 'principal_quinn', displayName: 'Quinn' })
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

    expect(second.id).toBe(first.id)
    // Only the winning insert announces — a deduped retry must never surface
    // a second note for the same proposal.
    expect(mockAppendNote).toHaveBeenCalledTimes(1)
  })
})

describe.skipIf(!fixture.available)('sweepAndNotifyExpiredPendingActions', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAssistantPrincipal.mockResolvedValue(null) // keep propose-time notes out of the way
  })

  it('emits the expiry system message once per expired conversation', async () => {
    const conversationId = await seedConversation()
    const other = await seedConversation()

    const stale = await proposePendingAction({
      conversationId,
      toolName: 'close_conversation',
      args: {},
      summary: 'Nobody decided in time.',
    })
    const staleOther = await proposePendingAction({
      conversationId: other,
      toolName: 'close_conversation',
      args: {},
      summary: 'Also stale.',
    })
    await testDb
      .update(assistantPendingActions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(assistantPendingActions.id, stale.id))
    await testDb
      .update(assistantPendingActions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(assistantPendingActions.id, staleOther.id))

    const expired = await sweepAndNotifyExpiredPendingActions()

    expect(expired.map((r) => r.id).sort()).toEqual([stale.id, staleOther.id].sort())
    expect(mockEmitExpired).toHaveBeenCalledTimes(2)
    expect(mockEmitExpired).toHaveBeenCalledWith(conversationId)
    expect(mockEmitExpired).toHaveBeenCalledWith(other)
  })

  it('does not notify for a proposal still within its TTL', async () => {
    const conversationId = await seedConversation()
    const agentId = await seedPrincipal()
    const fresh = await proposePendingAction({
      conversationId,
      toolName: 'close_conversation',
      args: {},
      summary: 'Still within TTL.',
    })
    // A decided-but-expired row is no longer `proposed`; it must not notify either.
    const decided = await proposePendingAction({
      conversationId,
      toolName: 'close_conversation',
      args: {},
      summary: 'Already decided.',
    })
    await decidePendingAction(decided.id, 'approved', agentId)
    await testDb
      .update(assistantPendingActions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(assistantPendingActions.id, decided.id))

    const expired = await sweepAndNotifyExpiredPendingActions()

    expect(expired.map((r) => r.id)).not.toContain(fresh.id)
    expect(expired.map((r) => r.id)).not.toContain(decided.id)
    expect(mockEmitExpired).not.toHaveBeenCalled()
  })
})
