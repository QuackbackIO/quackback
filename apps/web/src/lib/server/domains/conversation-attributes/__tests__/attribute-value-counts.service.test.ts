/**
 * Real-DB coverage for the monitoring aggregate (AI-ATTRIBUTES-PARITY-SPEC.md
 * Phase 3): per-option counts over a rolling window, incl. the "not set"
 * bucket (absent key AND explicit null both fold in), and the select-only
 * field-type guard. Mirrors conversation-attribute.service.test.ts's
 * real-DB fixture idiom.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { ConversationId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversationAttributeDefinitions, conversations, principal } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { attributeValueCounts } from '../attribute-value-counts.service'
import { createConversationAttribute } from '../conversation-attribute.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: conversationAttributeDefinitions.id })
      .from(conversationAttributeDefinitions)
      .limit(0)
  },
})

async function seedConversation(
  customAttributes: Record<string, unknown>,
  createdAt: Date = new Date()
): Promise<ConversationId> {
  const [visitor] = await testDb
    .insert(principal)
    .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
    .returning()
  const [conversation] = await testDb
    .insert(conversations)
    .values({
      visitorPrincipalId: visitor.id,
      channel: 'messenger',
      customAttributes,
      createdAt,
    })
    .returning()
  return conversation.id
}

function envelope(v: unknown) {
  return { v, src: 'ai', at: new Date().toISOString() }
}

describe.skipIf(!fixture.available)('attributeValueCounts (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('throws NOT_FOUND for an unknown key', async () => {
    await expect(attributeValueCounts({ key: 'nonexistent_key' })).rejects.toMatchObject({
      code: 'ATTRIBUTE_NOT_FOUND',
    })
  })

  it('rejects a non-select attribute', async () => {
    await createConversationAttribute({ key: 'ticket_count', label: 'Count', fieldType: 'number' })
    await expect(attributeValueCounts({ key: 'ticket_count' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })

  it('counts conversations per option, incl. a null bucket for unset conversations', async () => {
    const attr = await createConversationAttribute({
      key: 'issue_type_counts',
      label: 'Issue type',
      fieldType: 'select',
      options: [{ label: 'Billing' }, { label: 'Bug' }],
      aiDetect: true,
    })
    const [billing, bug] = attr.options!

    await seedConversation({ issue_type_counts: envelope(billing.id) })
    await seedConversation({ issue_type_counts: envelope(billing.id) })
    await seedConversation({ issue_type_counts: envelope(bug.id) })
    await seedConversation({}) // key entirely absent
    await seedConversation({ issue_type_counts: envelope(null) }) // explicit null value

    const counts = await attributeValueCounts({ key: 'issue_type_counts' })
    const byLabel = Object.fromEntries(counts.map((c) => [c.label, c.count]))
    expect(byLabel['Billing']).toBe(2)
    expect(byLabel['Bug']).toBe(1)
    expect(byLabel['Not set']).toBe(2)
    expect(counts.find((c) => c.label === 'Billing')?.optionId).toBe(billing.id)
    expect(counts.find((c) => c.label === 'Not set')?.optionId).toBeNull()
  })

  it('only counts conversations created within the sinceDays window', async () => {
    const attr = await createConversationAttribute({
      key: 'issue_type_window',
      label: 'Issue type',
      fieldType: 'select',
      options: [{ label: 'Billing' }],
      aiDetect: true,
    })
    const [billing] = attr.options!

    const now = new Date()
    const old = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000) // 60 days ago
    await seedConversation({ issue_type_window: envelope(billing.id) }, now)
    await seedConversation({ issue_type_window: envelope(billing.id) }, old)

    const counts30 = await attributeValueCounts({ key: 'issue_type_window', sinceDays: 30 })
    expect(counts30.find((c) => c.label === 'Billing')?.count).toBe(1)

    const counts90 = await attributeValueCounts({ key: 'issue_type_window', sinceDays: 90 })
    expect(counts90.find((c) => c.label === 'Billing')?.count).toBe(2)
  })

  it('defaults to a 30-day window when sinceDays is omitted', async () => {
    const attr = await createConversationAttribute({
      key: 'issue_type_default_window',
      label: 'Issue type',
      fieldType: 'select',
      options: [{ label: 'Billing' }],
      aiDetect: true,
    })
    const [billing] = attr.options!
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    await seedConversation({ issue_type_default_window: envelope(billing.id) }, old)

    const counts = await attributeValueCounts({ key: 'issue_type_default_window' })
    expect(counts.find((c) => c.label === 'Billing')?.count).toBe(0)
    expect(counts.find((c) => c.label === 'Not set')?.count).toBe(0)
  })
})
