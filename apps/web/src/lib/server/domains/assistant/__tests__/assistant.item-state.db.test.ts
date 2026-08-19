/**
 * Real-DB coverage for `loadAssistantItemState` (assistant.thread.ts): the
 * suggest route's targeted pre-turn read. Two facts ride one round of
 * targeted selects — the item's closed state (conversation `status` /
 * ticket status `category`) and its latest customer-authored message id —
 * and only Postgres can prove the filter semantics actually hold: latest by
 * (createdAt, id) among `senderType: 'visitor'` rows that are neither
 * internal notes nor soft-deleted, scoped to exactly the requested item.
 * Those semantics are pinned here because they must stay identical to the
 * orchestrator's in-memory fold over its already-loaded thread rows (see the
 * pairing notes at both sites).
 *
 * Every test runs inside the db-test-fixture rollback transaction, so
 * quackback_test stays clean.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type ConversationId,
  type ConversationMessageId,
  type PrincipalId,
  type TicketId,
  type TicketStatusId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  conversationMessages,
  tickets,
  ticketStatuses,
  principal,
  user,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { loadAssistantItemState } from '../assistant.thread'

const fixture = await createDbTestFixture({
  // Schema-currency probe over the columns this suite depends on.
  probe: async (db) => {
    await db
      .select({
        id: conversationMessages.id,
        conversationId: conversationMessages.conversationId,
        ticketId: conversationMessages.ticketId,
        isInternal: conversationMessages.isInternal,
        deletedAt: conversationMessages.deletedAt,
      })
      .from(conversationMessages)
      .limit(0)
    await db.select({ status: conversations.status }).from(conversations).limit(0)
    await db.select({ category: ticketStatuses.category }).from(ticketStatuses).limit(0)
  },
})

const runSuffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedCustomer(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: 'Customer', email: `${runSuffix()}@example.com` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: 'Customer',
    createdAt: new Date(),
  })
  return principalId
}

async function seedConversation(
  visitorPrincipalId: PrincipalId,
  status: 'open' | 'snoozed' | 'closed' = 'open'
): Promise<ConversationId> {
  const id = createId('conversation') as ConversationId
  await testDb
    .insert(conversations)
    .values({ id, visitorPrincipalId, channel: 'messenger', status })
  return id
}

async function seedTicket(category: 'open' | 'pending' | 'closed'): Promise<TicketId> {
  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({
    id: statusId,
    name: `Status ${category}`,
    slug: `status-${category}-${runSuffix()}`,
    category,
  })
  const id = createId('ticket') as TicketId
  await testDb.insert(tickets).values({ id, title: 'Ticket', statusId })
  return id
}

let messageClock = 0

/** Insert one message row; each call is one second newer than the last. */
async function seedMessage(
  parent: { conversationId: ConversationId } | { ticketId: TicketId },
  opts: { senderType?: 'visitor' | 'agent'; isInternal?: boolean; deleted?: boolean } = {}
): Promise<ConversationMessageId> {
  const id = createId('conversation_message')
  messageClock += 1
  await testDb.insert(conversationMessages).values({
    id,
    ...parent,
    senderType: opts.senderType ?? 'visitor',
    content: 'message body',
    isInternal: opts.isInternal ?? false,
    deletedAt: opts.deleted ? new Date() : null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, messageClock)),
  })
  return id
}

describe.skipIf(!fixture.available)('loadAssistantItemState: real-DB targeted read', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('returns the newest visitor message id, skipping agent replies, internal notes, and soft-deleted rows after it', async () => {
    const customer = await seedCustomer()
    const conversationId = await seedConversation(customer)
    await seedMessage({ conversationId }) // older visitor message
    const latestVisitor = await seedMessage({ conversationId })
    await seedMessage({ conversationId }, { senderType: 'agent' })
    await seedMessage({ conversationId }, { senderType: 'agent', isInternal: true })
    await seedMessage({ conversationId }, { deleted: true }) // newer visitor row, but deleted

    const state = await loadAssistantItemState(conversationId, null)

    expect(state).toEqual({ closed: false, latestCustomerMessageId: latestVisitor })
  })

  it('scopes the message read to the requested conversation, never a sibling one', async () => {
    const customer = await seedCustomer()
    const conversationA = await seedConversation(customer)
    const conversationB = await seedConversation(customer)
    const visitorInA = await seedMessage({ conversationId: conversationA })
    await seedMessage({ conversationId: conversationB }) // newer, but the wrong item

    const state = await loadAssistantItemState(conversationA, null)

    expect(state?.latestCustomerMessageId).toBe(visitorInA)
  })

  it('reports null latestCustomerMessageId for a conversation with no visitor messages', async () => {
    const customer = await seedCustomer()
    const conversationId = await seedConversation(customer)
    await seedMessage({ conversationId }, { senderType: 'agent' })

    const state = await loadAssistantItemState(conversationId, null)

    expect(state).toEqual({ closed: false, latestCustomerMessageId: null })
  })

  it("reports closed: true for a closed conversation (and false for a snoozed one — only 'closed' refuses)", async () => {
    const customer = await seedCustomer()
    const closedConversation = await seedConversation(customer, 'closed')
    const snoozedConversation = await seedConversation(customer, 'snoozed')

    expect((await loadAssistantItemState(closedConversation, null))?.closed).toBe(true)
    expect((await loadAssistantItemState(snoozedConversation, null))?.closed).toBe(false)
  })

  it('returns null for a conversation that does not exist', async () => {
    const state = await loadAssistantItemState(createId('conversation') as ConversationId, null)
    expect(state).toBeNull()
  })

  it("resolves a ticket's latest visitor message and its status category's closed state", async () => {
    const openTicket = await seedTicket('open')
    await seedMessage({ ticketId: openTicket })
    const latestVisitor = await seedMessage({ ticketId: openTicket })
    await seedMessage({ ticketId: openTicket }, { senderType: 'agent' })

    const state = await loadAssistantItemState(null, openTicket)

    expect(state).toEqual({ closed: false, latestCustomerMessageId: latestVisitor })
  })

  it("reports closed: true for a ticket whose status rolls up to the 'closed' category (and false for 'pending')", async () => {
    const closedTicket = await seedTicket('closed')
    const pendingTicket = await seedTicket('pending')

    expect((await loadAssistantItemState(null, closedTicket))?.closed).toBe(true)
    expect((await loadAssistantItemState(null, pendingTicket))?.closed).toBe(false)
  })

  it('returns null for a ticket that does not exist', async () => {
    const state = await loadAssistantItemState(null, createId('ticket') as TicketId)
    expect(state).toBeNull()
  })
})
