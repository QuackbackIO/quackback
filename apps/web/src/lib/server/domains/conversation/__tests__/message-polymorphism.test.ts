/**
 * Real-DB coverage for the conversation_messages polymorphic parent (support
 * platform §4.2, migration 0151). Runs inside the db-test-fixture rollback
 * transaction (see server/__tests__/README.md). Asserts the exactly-one-parent
 * CHECK (a message hangs off a conversation XOR a ticket) and that the generated
 * search_vector is populated from content.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import {
  createId,
  type PrincipalId,
  type UserId,
  type ConversationId,
  type TicketId,
  type TicketStatusId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  conversationMessages,
  tickets,
  ticketStatuses,
  principal,
  user,
  eq,
  sql,
} from '@/lib/server/db'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversationMessages.id }).from(conversationMessages).limit(0)
    await db.select({ id: tickets.id }).from(tickets).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Seed one conversation and one ticket to hang messages off. */
async function seedParents() {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `M-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })

  const conversationId = createId('conversation') as ConversationId
  await testDb
    .insert(conversations)
    .values({ id: conversationId, visitorPrincipalId: principalId, channel: 'messenger' })

  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'New', slug: `tp-${suffix()}` })
  const ticketId = createId('ticket') as TicketId
  await testDb.insert(tickets).values({ id: ticketId, title: 'T', statusId })

  return { conversationId, ticketId }
}

function insertMessage(parent: {
  conversationId?: ConversationId | null
  ticketId?: TicketId | null
  content?: string
}) {
  return testDb.insert(conversationMessages).values({
    conversationId: parent.conversationId ?? null,
    ticketId: parent.ticketId ?? null,
    senderType: 'system',
    content: parent.content ?? 'polymorphism probe',
  })
}

/** Assert the insert is rejected by the exactly-one-parent CHECK. Drizzle wraps
 *  the Postgres error, so the constraint name lands on the cause, not message. */
async function expectParentCheckRejection(promise: Promise<unknown>) {
  const err = (await promise.then(
    () => null,
    (e) => e
  )) as { cause?: { constraint_name?: string } } | null
  expect(err?.cause?.constraint_name).toBe('conversation_messages_parent_check')
}

describe.skipIf(!fixture.available)('conversation_messages polymorphic parent (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('accepts a conversation-parented message', async () => {
    const { conversationId } = await seedParents()
    await expect(insertMessage({ conversationId })).resolves.toBeDefined()
  })

  it('accepts a ticket-parented message', async () => {
    const { ticketId } = await seedParents()
    await expect(insertMessage({ ticketId })).resolves.toBeDefined()
  })

  it('rejects a message with no parent', async () => {
    await seedParents()
    await expectParentCheckRejection(insertMessage({}))
  })

  it('rejects a message parented to both a conversation and a ticket', async () => {
    const { conversationId, ticketId } = await seedParents()
    await expectParentCheckRejection(insertMessage({ conversationId, ticketId }))
  })

  it('populates the generated search_vector from content', async () => {
    const { conversationId } = await seedParents()
    await insertMessage({ conversationId, content: 'searchable haystack needle' })
    const [row] = await testDb
      .select({ sv: sql<string>`${conversationMessages.searchVector}::text` })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
    // to_tsvector stems 'needle' to 'needl'.
    expect(row?.sv).toContain('needl')
  })
})
