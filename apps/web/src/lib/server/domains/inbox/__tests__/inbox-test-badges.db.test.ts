/**
 * Inbox nav badges count real work. A teammate's test thread (its visitor is a
 * test customer) adds nothing to the Quinn buckets or the tag counts, while a
 * real thread carrying a legacy client `test` attribute still counts.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  assistantInvolvements,
  conversations,
  conversationTagAssignments,
  conversationTags,
  principal,
  user,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { countAssistantInboxBuckets } from '@/lib/server/domains/assistant/assistant.involvement'
import { listConversationTagsWithCounts } from '@/lib/server/domains/conversation/conversation-tag.service'

const fixture = await createDbTestFixture()
let customer: PrincipalId, visitor: PrincipalId

describe.skipIf(!fixture.available)('inbox badges ignore test threads (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    const owner = createId('principal') as PrincipalId
    customer = createId('principal') as PrincipalId
    visitor = createId('principal') as PrincipalId
    const uid = createId('user') as UserId
    await testDb.insert(user).values({ id: uid, name: 'Acme' })
    await testDb.insert(principal).values([
      { id: owner, userId: uid, role: 'admin', type: 'user', createdAt: new Date() },
      { id: visitor, role: 'user', type: 'anonymous', createdAt: new Date() },
    ])
    await testDb.insert(principal).values({
      id: customer,
      role: 'user',
      type: 'anonymous',
      testOwnerPrincipalId: owner,
      createdAt: new Date(),
    })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  async function thread(by: PrincipalId, attrs: Record<string, unknown> = {}) {
    const [row] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: by, channel: 'messenger', customAttributes: attrs })
      .returning({ id: conversations.id })
    return row.id
  }

  it('keeps test threads out of the Quinn activity buckets', async () => {
    const before = await countAssistantInboxBuckets()
    await testDb.insert(assistantInvolvements).values([
      { conversationId: await thread(customer), triggeredBy: 'first_touch', status: 'active' },
      {
        conversationId: await thread(visitor, { test: true }),
        triggeredBy: 'first_touch',
        status: 'active',
      },
    ])
    const after = await countAssistantInboxBuckets()
    expect(after.pending).toBe(before.pending + 1)
  })

  it('keeps test threads out of open tag counts', async () => {
    const [tag] = await testDb
      .insert(conversationTags)
      .values({ name: `Acme ${createId('conversation_tag')}` })
      .returning()
    await testDb.insert(conversationTagAssignments).values([
      { conversationId: await thread(customer), conversationTagId: tag.id },
      { conversationId: await thread(visitor, { test: 'true' }), conversationTagId: tag.id },
    ])
    const counted = (await listConversationTagsWithCounts()).find((row) => row.id === tag.id)
    expect(counted?.count).toBe(1)
  })
})
