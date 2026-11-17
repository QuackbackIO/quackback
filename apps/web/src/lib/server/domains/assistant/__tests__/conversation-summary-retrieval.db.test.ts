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
 * quackback_test stays clean. A mocked `generateEmbedding` avoids a real
 * network call: it returns null (the keyword path) unless a test sets a
 * vector, which the teammate-scoping block does to cover the semantic path too.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import {
  createId,
  type ConversationId,
  type PrincipalId,
  type TeamId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversationSummaries,
  conversations,
  principal,
  teamMembers,
  teams,
  user,
  eq,
  sql,
} from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// Null selects the keyword path; a vector selects the semantic path.
let queryEmbedding: number[] | null = null
vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generateEmbedding: async () => queryEmbedding,
}))

import { retrieveConversationSummaries } from '../conversation-summary-retrieval'
import { quinnActor } from '../assistant.actor'

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

async function seedConversation(
  visitorPrincipalId: PrincipalId,
  assignedTeamId: TeamId | null = null
): Promise<ConversationId> {
  const id = createId('conversation') as ConversationId
  await testDb
    .insert(conversations)
    .values({ id, visitorPrincipalId, channel: 'messenger', assignedTeamId })
  return id
}

async function seedTeammate(role: 'admin' | 'member'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: 'Teammate', email: `${runSuffix()}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

/** A workspace admin: the role's own permissions, which include conversation.view_all. */
function adminActor(principalId: PrincipalId): Actor {
  return { principalId, principalType: 'user', role: 'admin', segmentIds: new Set() }
}

/** A teammate who sees only conversations assigned to them or their teams. */
function scopedActor(principalId: PrincipalId): Actor {
  return {
    principalId,
    principalType: 'user',
    role: 'member',
    segmentIds: new Set(),
    permissions: new Set([PERMISSIONS.CONVERSATION_VIEW]),
  }
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
    embedding: sql`${`[${VECTOR.join(',')}]`}::vector`,
    embeddingModel: 'test',
  })
}

/** A unit vector along one axis: the query and every seeded summary share it,
 *  so the semantic path scores each seeded row at cosine 1. */
const VECTOR = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0))

const BILLING_SUMMARY = 'Billing dispute about a duplicate invoice charge, refunded in full.'

describe.skipIf(!fixture.available)(
  'conversation-summary-retrieval: real-DB customer scoping',
  () => {
    beforeEach(fixture.begin)
    afterEach(fixture.rollback)
    afterAll(fixture.close)

    // Customer scoping is the subject here, so the viewer is a workspace-wide
    // admin who can see every conversation.
    let viewer: Actor
    beforeEach(async () => {
      queryEmbedding = null
      viewer = adminActor(await seedTeammate('admin'))
    })

    it("retrieves customer A's past summary when grounding in another of customer A's conversations", async () => {
      const customerA = await seedCustomer('Customer A')
      const conversationA1 = await seedConversation(customerA)
      const conversationA2 = await seedConversation(customerA)
      await seedSummary(conversationA1, customerA, BILLING_SUMMARY)

      const items = await retrieveConversationSummaries('billing dispute', 'team', {
        customerPrincipalId: customerA,
        conversationId: conversationA2,
        viewer,
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
        viewer,
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
        viewer,
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
        viewer,
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
        viewer,
      })

      expect(items).toEqual([])
    })

    it('matches LIKE wildcards in the keyword query literally', async () => {
      const customerA = await seedCustomer('Customer A')
      const conversationA1 = await seedConversation(customerA)
      const conversationA2 = await seedConversation(customerA)
      await seedSummary(conversationA1, customerA, BILLING_SUMMARY)
      const opts = { customerPrincipalId: customerA, conversationId: conversationA2, viewer }

      // Unescaped, `_` matches any one character and `%` any run, so this
      // term would match the seeded summary.
      expect(await retrieveConversationSummaries('billing_dispute%charge', 'team', opts)).toEqual(
        []
      )
      expect(
        (await retrieveConversationSummaries('billing dispute', 'team', opts)).map(
          (i) => i.conversationId
        )
      ).toEqual([conversationA1])
    })

    describe('teammate scoping', () => {
      // One customer with a closed conversation on team X and another on team Y,
      // grounding from a third conversation on team X (the one the copilot is open on).
      let scoped: Actor
      let admin: Actor
      let customer: PrincipalId
      let teamXPast: ConversationId
      let teamYPast: ConversationId
      let current: ConversationId

      beforeEach(async () => {
        const scopedId = await seedTeammate('member')
        scoped = scopedActor(scopedId)
        admin = adminActor(await seedTeammate('admin'))

        const teamX = createId('team') as TeamId
        const teamY = createId('team') as TeamId
        await testDb.insert(teams).values([
          { id: teamX, name: `X-${teamX}` },
          { id: teamY, name: `Y-${teamY}` },
        ])
        await testDb.insert(teamMembers).values({ teamId: teamX, principalId: scopedId })

        customer = await seedCustomer('Customer')
        teamXPast = await seedConversation(customer, teamX)
        teamYPast = await seedConversation(customer, teamY)
        current = await seedConversation(customer, teamX)
        await seedSummary(teamXPast, customer, BILLING_SUMMARY)
        await seedSummary(teamYPast, customer, BILLING_SUMMARY)
      })

      async function ids(asker: Actor | undefined): Promise<string[]> {
        const items = await retrieveConversationSummaries('billing dispute', 'team', {
          customerPrincipalId: customer,
          conversationId: current,
          viewer: asker,
        })
        return items.map((i) => i.conversationId).sort()
      }

      describe.each([
        ['keyword', null],
        ['semantic', VECTOR],
      ])('%s path', (_path, embedding) => {
        beforeEach(() => {
          queryEmbedding = embedding
        })

        it("gives a scoped teammate the summary from their own team's conversation and not another team's", async () => {
          expect(await ids(scoped)).toEqual([teamXPast])
        })

        it('gives a workspace admin every summary for the customer', async () => {
          expect(await ids(admin)).toEqual([teamXPast, teamYPast].sort())
        })

        it("never widens to Quinn's own service actor or a missing viewer", async () => {
          expect(await ids(quinnActor(scoped.principalId!))).toEqual([])
          expect(await ids(undefined)).toEqual([])
        })
      })
    })
  }
)
