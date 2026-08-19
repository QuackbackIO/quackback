/**
 * Real-DB coverage for the attribute value breakdown aggregate (C2.7 /
 * AI-ATTRIBUTES-PARITY-SPEC.md Phase 4): per-option counts including the
 * unset bucket, multi_select fan-out, envelope + legacy-bare-value handling,
 * and the date-range window filter. Runs inside the db-test-fixture rollback
 * transaction (see server/__tests__/README.md).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type ConversationId, type PrincipalId, type UserId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, principal, user } from '@/lib/server/db'
import { attributeValueBreakdown } from '../attribute-reporting'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedVisitor(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `V-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

describe.skipIf(!fixture.available)('attributeValueBreakdown (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  async function seed(
    customAttributes: Record<string, unknown>,
    createdAt: Date
  ): Promise<ConversationId> {
    const visitor = await seedVisitor()
    const id = createId('conversation') as ConversationId
    await testDb.insert(conversations).values({
      id,
      visitorPrincipalId: visitor,
      channel: 'messenger',
      customAttributes,
      createdAt,
    })
    return id
  }

  const inWindow = new Date('2026-06-15T00:00:00Z')
  const from = new Date('2026-06-01T00:00:00Z')
  const to = new Date('2026-07-01T00:00:00Z')

  it('counts per option id, folding missing/null/empty into unset', async () => {
    await seed(
      { issue_type: { v: 'opt_billing', src: 'ai', at: inWindow.toISOString() } },
      inWindow
    )
    await seed(
      { issue_type: { v: 'opt_billing', src: 'teammate', at: inWindow.toISOString() } },
      inWindow
    )
    await seed({ issue_type: { v: 'opt_bug', src: 'ai', at: inWindow.toISOString() } }, inWindow)
    await seed({}, inWindow) // key entirely absent
    await seed({ issue_type: { v: null, src: 'ai', at: inWindow.toISOString() } }, inWindow)

    const result = await attributeValueBreakdown('issue_type', from, to)
    expect(result.unset).toBe(2)
    expect(result.values).toEqual([
      { value: 'opt_billing', count: 2 },
      { value: 'opt_bug', count: 1 },
    ])
  })

  it('unwraps a bare legacy value the same as an envelope', async () => {
    await seed({ issue_type: 'opt_billing' }, inWindow)

    const result = await attributeValueBreakdown('issue_type', from, to)
    expect(result.values).toEqual([{ value: 'opt_billing', count: 1 }])
  })

  it('fans a multi_select conversation out across every selected option', async () => {
    await seed(
      { tags_topic: { v: ['opt_a', 'opt_b'], src: 'ai', at: inWindow.toISOString() } },
      inWindow
    )
    await seed({ tags_topic: { v: ['opt_b'], src: 'ai', at: inWindow.toISOString() } }, inWindow)
    await seed({ tags_topic: { v: [], src: 'ai', at: inWindow.toISOString() } }, inWindow) // empty = unset

    const result = await attributeValueBreakdown('tags_topic', from, to)
    expect(result.unset).toBe(1)
    expect(result.values).toEqual([
      { value: 'opt_b', count: 2 },
      { value: 'opt_a', count: 1 },
    ])
  })

  it('counts a checkbox/number/text value by its stringified form', async () => {
    await seed({ seats: { v: 12, src: 'teammate', at: inWindow.toISOString() } }, inWindow)
    await seed({ seats: { v: 12, src: 'teammate', at: inWindow.toISOString() } }, inWindow)
    await seed({ seats: { v: 3, src: 'teammate', at: inWindow.toISOString() } }, inWindow)

    const result = await attributeValueBreakdown('seats', from, to)
    expect(result.values).toEqual([
      { value: '12', count: 2 },
      { value: '3', count: 1 },
    ])
  })

  it('excludes conversations created outside the window', async () => {
    const before = new Date('2026-05-01T00:00:00Z')
    const after = new Date('2026-08-01T00:00:00Z')
    await seed(
      { issue_type: { v: 'opt_billing', src: 'ai', at: inWindow.toISOString() } },
      inWindow
    )
    await seed({ issue_type: { v: 'opt_billing', src: 'ai', at: before.toISOString() } }, before)
    await seed({ issue_type: { v: 'opt_billing', src: 'ai', at: after.toISOString() } }, after)

    const result = await attributeValueBreakdown('issue_type', from, to)
    expect(result.values).toEqual([{ value: 'opt_billing', count: 1 }])
  })

  it('returns everything as unset for a key nothing sets', async () => {
    await seed({ other_key: { v: 'x', src: 'ai', at: inWindow.toISOString() } }, inWindow)

    const result = await attributeValueBreakdown('never_used', from, to)
    expect(result.unset).toBe(1)
    expect(result.values).toEqual([])
  })
})
