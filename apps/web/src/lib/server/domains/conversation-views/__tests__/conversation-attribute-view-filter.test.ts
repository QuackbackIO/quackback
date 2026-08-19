/**
 * Real-DB coverage for conversation-view attribute filters (C2.7 /
 * AI-ATTRIBUTES-PARITY-SPEC.md Phase 4): `attributeFilters` on
 * `listConversationsForAgent` translates `{ key, operator, value }` rules into
 * jsonb predicates over `custom_attributes`. Covers envelope unwrapping (the
 * `{ v, src, at }` shape vs a bare legacy value), option-id equality,
 * multi_select array semantics, is_set/is_empty, text contains, and number
 * comparisons. Runs inside the db-test-fixture rollback transaction (see
 * server/__tests__/README.md).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type ConversationId, type PrincipalId, type UserId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, principal, user, type PermissionKey } from '@/lib/server/db'
import { listConversationsForAgent } from '../../conversation/conversation.query'
import type { Actor } from '@/lib/server/policy/types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

// principalType 'service' short-circuits conversationFilter(actor) to `true`
// (see conversation-query.test.ts), so these tests exercise only the
// attribute predicate, not RBAC scoping.
const serviceActor: Actor = {
  principalId: null,
  role: null,
  principalType: 'service',
  segmentIds: new Set(),
  permissions: new Set<PermissionKey>(),
}

async function seedVisitor(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `V-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

const iso = () => new Date().toISOString()

describe.skipIf(!fixture.available)(
  'listConversationsForAgent attribute view filters (real DB, rolled back)',
  () => {
    beforeEach(fixture.begin)
    afterEach(fixture.rollback)
    afterAll(fixture.close)

    async function seed(customAttributes: Record<string, unknown>): Promise<ConversationId> {
      const visitor = await seedVisitor()
      const id = createId('conversation') as ConversationId
      await testDb.insert(conversations).values({
        id,
        visitorPrincipalId: visitor,
        channel: 'messenger',
        customAttributes,
      })
      return id
    }

    it('select eq matches the envelope-stored option id', async () => {
      const billing = await seed({ issue_type: { v: 'opt_billing', src: 'ai', at: iso() } })
      const bug = await seed({ issue_type: { v: 'opt_bug', src: 'teammate', at: iso() } })

      const page = await listConversationsForAgent(
        { attributeFilters: [{ key: 'issue_type', operator: 'eq', value: 'opt_billing' }] },
        serviceActor
      )
      const ids = page.conversations.map((c) => c.id)
      expect(ids).toContain(billing)
      expect(ids).not.toContain(bug)
    })

    it('select eq also matches a bare legacy value (no envelope)', async () => {
      const legacy = await seed({ issue_type: 'opt_billing' })

      const page = await listConversationsForAgent(
        { attributeFilters: [{ key: 'issue_type', operator: 'eq', value: 'opt_billing' }] },
        serviceActor
      )
      expect(page.conversations.map((c) => c.id)).toContain(legacy)
    })

    it('select neq matches both a different value and an unset key', async () => {
      const bug = await seed({ issue_type: { v: 'opt_bug', src: 'teammate', at: iso() } })
      const unset = await seed({})
      const billing = await seed({ issue_type: { v: 'opt_billing', src: 'ai', at: iso() } })

      const page = await listConversationsForAgent(
        { attributeFilters: [{ key: 'issue_type', operator: 'neq', value: 'opt_billing' }] },
        serviceActor
      )
      const ids = page.conversations.map((c) => c.id)
      expect(ids).toContain(bug)
      expect(ids).toContain(unset)
      expect(ids).not.toContain(billing)
    })

    it('is_set / is_empty split on presence, treating [] and "" as empty', async () => {
      const set = await seed({ notes: { v: 'hello', src: 'teammate', at: iso() } })
      const missing = await seed({})
      const emptyString = await seed({ notes: { v: '', src: 'teammate', at: iso() } })
      const emptyArray = await seed({ tags_topic: { v: [], src: 'ai', at: iso() } })

      const isSet = await listConversationsForAgent(
        { attributeFilters: [{ key: 'notes', operator: 'is_set' }] },
        serviceActor
      )
      const setIds = isSet.conversations.map((c) => c.id)
      expect(setIds).toContain(set)
      expect(setIds).not.toContain(missing)
      expect(setIds).not.toContain(emptyString)

      const isEmpty = await listConversationsForAgent(
        { attributeFilters: [{ key: 'notes', operator: 'is_empty' }] },
        serviceActor
      )
      const emptyIds = isEmpty.conversations.map((c) => c.id)
      expect(emptyIds).toContain(missing)
      expect(emptyIds).toContain(emptyString)
      expect(emptyIds).not.toContain(set)

      const isEmptyArray = await listConversationsForAgent(
        { attributeFilters: [{ key: 'tags_topic', operator: 'is_empty' }] },
        serviceActor
      )
      expect(isEmptyArray.conversations.map((c) => c.id)).toContain(emptyArray)
    })

    it('multi_select includes_any / excludes_all over the stored option-id array', async () => {
      const ab = await seed({ tags_topic: { v: ['opt_a', 'opt_b'], src: 'ai', at: iso() } })
      const c = await seed({ tags_topic: { v: ['opt_c'], src: 'ai', at: iso() } })
      const none = await seed({})

      const anyOf = await listConversationsForAgent(
        {
          attributeFilters: [
            { key: 'tags_topic', operator: 'includes_any', value: ['opt_a', 'opt_z'] },
          ],
        },
        serviceActor
      )
      const anyIds = anyOf.conversations.map((x) => x.id)
      expect(anyIds).toContain(ab)
      expect(anyIds).not.toContain(c)
      expect(anyIds).not.toContain(none)

      const excludesAll = await listConversationsForAgent(
        {
          attributeFilters: [
            { key: 'tags_topic', operator: 'excludes_all', value: ['opt_a', 'opt_z'] },
          ],
        },
        serviceActor
      )
      const excludeIds = excludesAll.conversations.map((x) => x.id)
      expect(excludeIds).toContain(c)
      expect(excludeIds).toContain(none) // vacuously excludes-all when unset
      expect(excludeIds).not.toContain(ab)
    })

    it('text contains / not_contains, treating an unset attribute as not-containing', async () => {
      const hit = await seed({ notes: { v: 'has the keyword inside', src: 'teammate', at: iso() } })
      const miss = await seed({ notes: { v: 'nothing relevant', src: 'teammate', at: iso() } })
      const unset = await seed({})

      const contains = await listConversationsForAgent(
        { attributeFilters: [{ key: 'notes', operator: 'contains', value: 'keyword' }] },
        serviceActor
      )
      const containIds = contains.conversations.map((x) => x.id)
      expect(containIds).toContain(hit)
      expect(containIds).not.toContain(miss)
      expect(containIds).not.toContain(unset)

      const notContains = await listConversationsForAgent(
        { attributeFilters: [{ key: 'notes', operator: 'not_contains', value: 'keyword' }] },
        serviceActor
      )
      const notContainIds = notContains.conversations.map((x) => x.id)
      expect(notContainIds).toContain(miss)
      expect(notContainIds).toContain(unset)
      expect(notContainIds).not.toContain(hit)
    })

    it('number comparisons over the stored numeric value', async () => {
      const small = await seed({ seats: { v: 3, src: 'teammate', at: iso() } })
      const big = await seed({ seats: { v: 25, src: 'teammate', at: iso() } })
      const unset = await seed({})

      const page = await listConversationsForAgent(
        { attributeFilters: [{ key: 'seats', operator: 'gte', value: 10 }] },
        serviceActor
      )
      const ids = page.conversations.map((x) => x.id)
      expect(ids).toContain(big)
      expect(ids).not.toContain(small)
      expect(ids).not.toContain(unset)
    })

    it('checkbox eq over a boolean value', async () => {
      const vip = await seed({ is_vip: { v: true, src: 'teammate', at: iso() } })
      const notVip = await seed({ is_vip: { v: false, src: 'teammate', at: iso() } })

      const page = await listConversationsForAgent(
        { attributeFilters: [{ key: 'is_vip', operator: 'eq', value: true }] },
        serviceActor
      )
      const ids = page.conversations.map((x) => x.id)
      expect(ids).toContain(vip)
      expect(ids).not.toContain(notVip)
    })

    it('ANDs multiple attribute rules together', async () => {
      const both = await seed({
        issue_type: { v: 'opt_billing', src: 'ai', at: iso() },
        is_vip: { v: true, src: 'teammate', at: iso() },
      })
      const onlyOne = await seed({
        issue_type: { v: 'opt_billing', src: 'ai', at: iso() },
        is_vip: { v: false, src: 'teammate', at: iso() },
      })

      const page = await listConversationsForAgent(
        {
          attributeFilters: [
            { key: 'issue_type', operator: 'eq', value: 'opt_billing' },
            { key: 'is_vip', operator: 'eq', value: true },
          ],
        },
        serviceActor
      )
      const ids = page.conversations.map((x) => x.id)
      expect(ids).toContain(both)
      expect(ids).not.toContain(onlyOne)
    })
  }
)
