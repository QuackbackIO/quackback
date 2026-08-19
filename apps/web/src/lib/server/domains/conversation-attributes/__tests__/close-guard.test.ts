/**
 * Real-DB coverage for the required-to-close guard. Called only from the
 * teammate inbox close paths (single + bulk server fns) — API, workflow, and
 * AI closes go straight to the conversation service and bypass it by design.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { ConversationId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversationAttributeDefinitions, conversations, principal } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { assertRequiredAttributesForClose } from '../close-guard'
import {
  createConversationAttribute,
  archiveConversationAttribute,
} from '../conversation-attribute.service'
import { setConversationAttribute } from '../set-attribute.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: conversationAttributeDefinitions.id })
      .from(conversationAttributeDefinitions)
      .limit(0)
  },
})

async function seedConversation(): Promise<ConversationId> {
  const [visitor] = await testDb
    .insert(principal)
    .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
    .returning()
  const [conversation] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: visitor.id, channel: 'messenger' })
    .returning()
  return conversation.id
}

describe.skipIf(!fixture.available)(
  'assertRequiredAttributesForClose (real DB, rolled back)',
  () => {
    beforeEach(fixture.begin)
    afterEach(fixture.rollback)
    afterAll(fixture.close)

    it('blocks a close while a required attribute is unfilled, naming it', async () => {
      await createConversationAttribute({
        key: 'plan',
        label: 'Plan',
        fieldType: 'text',
        requiredToClose: true,
      })
      const conversationId = await seedConversation()

      await expect(assertRequiredAttributesForClose(conversationId)).rejects.toMatchObject({
        code: 'REQUIRED_ATTRIBUTES_MISSING',
        message: expect.stringContaining('Plan'),
      })

      await setConversationAttribute({ conversationId }, 'plan', 'pro', 'teammate')
      await expect(assertRequiredAttributesForClose(conversationId)).resolves.toBeUndefined()
    })

    it('ignores archived and optional definitions', async () => {
      const def = await createConversationAttribute({
        key: 'tier',
        label: 'Tier',
        fieldType: 'text',
        requiredToClose: true,
      })
      await createConversationAttribute({ key: 'note', label: 'Note', fieldType: 'text' })
      await archiveConversationAttribute(def.id)
      const conversationId = await seedConversation()

      await expect(assertRequiredAttributesForClose(conversationId)).resolves.toBeUndefined()
    })
  }
)
