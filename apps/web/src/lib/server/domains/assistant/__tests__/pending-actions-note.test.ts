/**
 * Coverage for the propose-time inbox note and the expiry sweep's customer
 * notice — the two conversation-domain seams `pending-actions.service` calls
 * into. Real DB for the pending-action rows themselves; the conversation
 * domain is mocked at the module boundary so these tests assert the seam
 * (right call, right args, never fails the caller) rather than re-testing
 * message persistence.
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
  principal,
  eq,
} from '@/lib/server/db'

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

// Ticket-scoped announcement seam (unified inbox §2.9): mocked at the module
// boundary like the conversation seam above, so these tests assert the call
// (right actor, right ticket, right content) rather than re-testing ticket
// message persistence (covered in ticket-message.service.test.ts).
const mockAddTicketNote = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket-message.service', () => ({
  addTicketNote: (...args: unknown[]) => mockAddTicketNote(...args),
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

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedTicket(): Promise<TicketId> {
  const statusId = createId('ticket_status') as TicketStatusId
  await testDb
    .insert(ticketStatuses)
    .values({ id: statusId, name: 'Open', slug: `pan-${suffix()}` })
  const [ticket] = await testDb.insert(tickets).values({ title: 'A ticket', statusId }).returning()
  return ticket.id
}

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: assistantPendingActions.id, originRole: assistantPendingActions.originRole })
      .from(assistantPendingActions)
      .limit(0)
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

  it('surfaces a plain internal ticket note (not the conversation card note) for a ticket-scoped proposal (unified inbox §2.9)', async () => {
    mockGetAssistantPrincipal.mockResolvedValue({ id: 'principal_quinn', displayName: 'Quinn' })
    const ticketId = await seedTicket()

    const proposed = await proposePendingAction({
      ticketId,
      toolName: 'create_ticket',
      args: { type: 'customer', title: 'x' },
      summary: 'Create a customer ticket: "x"',
    })

    expect(proposed.ticketId).toBe(ticketId)
    expect(proposed.conversationId).toBeNull()
    expect(mockAddTicketNote).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: 'principal_quinn' }),
      { ticketId, content: 'Requested approval: Create a customer ticket: "x"' }
    )
    expect(mockAppendNote).not.toHaveBeenCalled()
  })

  it('does not fail the proposal when the ticket note append throws', async () => {
    mockGetAssistantPrincipal.mockResolvedValue({ id: 'principal_quinn', displayName: 'Quinn' })
    mockAddTicketNote.mockRejectedValue(new Error('publish boom'))
    const ticketId = await seedTicket()

    const proposed = await proposePendingAction({
      ticketId,
      toolName: 'create_ticket',
      args: {},
      summary: 'x',
    })

    expect(proposed.status).toBe('proposed')
    expect(mockLoggerWarn).toHaveBeenCalled()
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

  it('emits the expiry system message once per expired customer-support conversation', async () => {
    const conversationId = await seedConversation()
    const other = await seedConversation()

    const stale = await proposePendingAction({
      conversationId,
      toolName: 'close_conversation',
      args: {},
      summary: 'Nobody decided in time.',
      originRole: 'customer_support',
    })
    const staleOther = await proposePendingAction({
      conversationId: other,
      toolName: 'close_conversation',
      args: {},
      summary: 'Also stale.',
      originRole: 'customer_support',
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

  it('expires a copilot proposal without sending a customer system message', async () => {
    const conversationId = await seedConversation()
    const stale = await proposePendingAction({
      conversationId,
      toolName: 'close_conversation',
      args: {},
      summary: 'Copilot proposal nobody reviewed.',
      originRole: 'copilot_qa',
    })
    await testDb
      .update(assistantPendingActions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(assistantPendingActions.id, stale.id))

    const expired = await sweepAndNotifyExpiredPendingActions()

    expect(expired.map((row) => row.id)).toEqual([stale.id])
    expect(expired[0]?.originRole).toBe('copilot_qa')
    expect(mockEmitExpired).not.toHaveBeenCalled()
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

  it('posts an internal ticket note (not a customer-visible system message) for an expired ticket-scoped proposal', async () => {
    mockGetAssistantPrincipal.mockResolvedValue({ id: 'principal_quinn', displayName: 'Quinn' })
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

    const expired = await sweepAndNotifyExpiredPendingActions()

    expect(expired.map((r) => r.id)).toEqual([stale.id])
    expect(mockEmitExpired).not.toHaveBeenCalled()
    expect(mockAddTicketNote).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: 'principal_quinn' }),
      { ticketId, content: 'This request timed out before a teammate could review it.' }
    )
  })

  it('never queries for the assistant principal when nothing ticket-scoped expired (conversation-only batch)', async () => {
    const conversationId = await seedConversation()
    const stale = await proposePendingAction({
      conversationId,
      toolName: 'close_conversation',
      args: {},
      summary: 'Nobody decided in time.',
    })
    await testDb
      .update(assistantPendingActions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(assistantPendingActions.id, stale.id))
    // Reset the propose-time call above so the assertion below is scoped to
    // what the SWEEP itself does, not the unrelated propose-time note lookup.
    mockGetAssistantPrincipal.mockClear()

    await sweepAndNotifyExpiredPendingActions()

    expect(mockGetAssistantPrincipal).not.toHaveBeenCalled()
    expect(mockAddTicketNote).not.toHaveBeenCalled()
  })
})
