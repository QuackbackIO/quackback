/**
 * Real-DB coverage for the MANDATORY customer-scoping predicate in
 * conversation-summary-retrieval.ts — the safety-critical part of P2-A.4.
 * The mock-based suite (conversation-summary-retrieval.test.ts) pins the
 * ranking paths and the shape of the query; only Postgres can prove the
 * scope actually holds end to end: a customer's past summary must surface
 * within another of their own conversations, must never surface in a
 * different customer's conversation, and a turn must never ground on its own
 * in-progress summary.
 *
 * Every test runs inside the db-test-fixture rollback transaction, so
 * quackback_test stays clean. The keyword (no-embedding) ranking path is used
 * throughout — this suite is about the scope predicate, not the ranking
 * algorithm, so a mocked `generateEmbedding` avoids a real network call.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type ConversationId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversationSummaries, conversations, principal, user, eq } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(null),
}))

import { retrieveConversationSummaries } from '../conversation-summary-retrieval'

const fixture = await createDbTestFixture({
  // Schema-currency probe over the columns this suite depends on — a stale
  // test DB (migration 0171 not yet applied) skips the suite instead of
  // failing it mid-test.
  probe: async (db) => {
    await db
      .select({
        id: conversationSummaries.id,
        conversationId: conversationSummaries.conversationId,
        visitorPrincipalId: conversationSummaries.visitorPrincipalId,
      })
      .from(conversationSummaries)
      .limit(0)
  },
})

const runSuffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedCustomer(name: string): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name, email: `${runSuffix()}@example.com` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: name,
    createdAt: new Date(),
  })
  return principalId
}

async function seedConversation(visitorPrincipalId: PrincipalId): Promise<ConversationId> {
  const id = createId('conversation') as ConversationId
  await testDb.insert(conversations).values({ id, visitorPrincipalId, channel: 'messenger' })
  return id
}

async function seedSummary(
  conversationId: ConversationId,
  visitorPrincipalId: PrincipalId,
  summary: string
): Promise<void> {
  await testDb.insert(conversationSummaries).values({
    id: createId('conversation_summary'),
    conversationId,
    visitorPrincipalId,
    summary,
  })
}

const BILLING_SUMMARY = 'Billing dispute about a duplicate invoice charge, refunded in full.'

describe.skipIf(!fixture.available)(
  'conversation-summary-retrieval: real-DB customer scoping',
  () => {
    beforeEach(fixture.begin)
    afterEach(fixture.rollback)
    afterAll(fixture.close)

    it("retrieves customer A's past summary when grounding in another of customer A's conversations", async () => {
      const customerA = await seedCustomer('Customer A')
      const conversationA1 = await seedConversation(customerA)
      const conversationA2 = await seedConversation(customerA)
      await seedSummary(conversationA1, customerA, BILLING_SUMMARY)

      const items = await retrieveConversationSummaries('billing dispute', 'team', {
        customerPrincipalId: customerA,
        conversationId: conversationA2,
      })

      expect(items.map((i) => i.conversationId)).toEqual([conversationA1])
    })

    it("never surfaces customer A's summary when grounding in customer B's conversation", async () => {
      const customerA = await seedCustomer('Customer A')
      const customerB = await seedCustomer('Customer B')
      const conversationA1 = await seedConversation(customerA)
      const conversationB1 = await seedConversation(customerB)
      await seedSummary(conversationA1, customerA, BILLING_SUMMARY)

      const items = await retrieveConversationSummaries('billing dispute', 'team', {
        customerPrincipalId: customerB,
        conversationId: conversationB1,
      })

      expect(items).toEqual([])
    })

    it('excludes the current conversation own in-progress summary', async () => {
      const customerA = await seedCustomer('Customer A')
      const conversationA1 = await seedConversation(customerA)
      await seedSummary(conversationA1, customerA, BILLING_SUMMARY)

      const items = await retrieveConversationSummaries('billing dispute', 'team', {
        customerPrincipalId: customerA,
        conversationId: conversationA1,
      })

      expect(items).toEqual([])
    })

    it('returns [] with no customerPrincipalId even though a matching row exists for that customer', async () => {
      const customerA = await seedCustomer('Customer A')
      const conversationA1 = await seedConversation(customerA)
      const conversationA2 = await seedConversation(customerA)
      await seedSummary(conversationA1, customerA, BILLING_SUMMARY)

      const items = await retrieveConversationSummaries('billing dispute', 'team', {
        conversationId: conversationA2,
      })

      expect(items).toEqual([])
    })

    it('never surfaces a summary older than the recency window', async () => {
      const customerA = await seedCustomer('Customer A')
      const conversationA1 = await seedConversation(customerA)
      const conversationA2 = await seedConversation(customerA)
      await seedSummary(conversationA1, customerA, BILLING_SUMMARY)
      await testDb
        .update(conversationSummaries)
        .set({ createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000) })
        .where(eq(conversationSummaries.conversationId, conversationA1))

      const items = await retrieveConversationSummaries('billing dispute', 'team', {
        customerPrincipalId: customerA,
        conversationId: conversationA2,
      })

      expect(items).toEqual([])
    })
  }
)
