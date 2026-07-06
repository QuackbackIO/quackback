/**
 * Real-DB coverage for the conversation_message_translations retention sweep
 * (P2-D.1 finding: TRANSLATION-CACHE RETENTION), mirroring tool-audit.test.ts's
 * cleanupExpiredToolCalls suite. Runs inside the db-test-fixture rollback
 * transaction.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { ConversationMessageId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversationMessageTranslations,
  conversationMessages,
  conversations,
  principal,
  eq,
  inArray,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  cleanupExpiredMessageTranslations,
  CONVERSATION_MESSAGE_TRANSLATIONS_RETENTION_DAYS,
} from '../conversation-translation.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: conversationMessageTranslations.id })
      .from(conversationMessageTranslations)
      .limit(0)
  },
})

async function seedMessage(): Promise<ConversationMessageId> {
  const [visitor] = await testDb
    .insert(principal)
    .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
    .returning()
  const [conversation] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: visitor.id, channel: 'messenger' })
    .returning()
  const [message] = await testDb
    .insert(conversationMessages)
    .values({
      conversationId: conversation.id,
      principalId: visitor.id,
      senderType: 'visitor',
      content: 'Bonjour',
    })
    .returning()
  return message.id
}

async function seedTranslationAt(createdAt: Date, locale = 'en') {
  const messageId = await seedMessage()
  const [row] = await testDb
    .insert(conversationMessageTranslations)
    .values({ conversationMessageId: messageId, locale, content: 'Hello', createdAt })
    .returning()
  return row.id
}

describe.skipIf(!fixture.available)(
  'cleanupExpiredMessageTranslations (real DB, rolled back)',
  () => {
    beforeEach(fixture.begin)
    afterEach(fixture.rollback)
    afterAll(fixture.close)

    it('deletes only rows older than the retention window', async () => {
      const dayMs = 24 * 60 * 60 * 1000
      const staleId = await seedTranslationAt(
        new Date(Date.now() - (CONVERSATION_MESSAGE_TRANSLATIONS_RETENTION_DAYS + 1) * dayMs)
      )
      const freshId = await seedTranslationAt(
        new Date(Date.now() - (CONVERSATION_MESSAGE_TRANSLATIONS_RETENTION_DAYS - 1) * dayMs)
      )

      const { deleted } = await cleanupExpiredMessageTranslations()
      expect(deleted).toBeGreaterThanOrEqual(1)

      const rows = await testDb
        .select({ id: conversationMessageTranslations.id })
        .from(conversationMessageTranslations)
        .where(inArray(conversationMessageTranslations.id, [staleId, freshId]))
      expect(rows.map((r) => r.id)).toEqual([freshId])
    })

    it('leaves a row within the retention window untouched', async () => {
      const freshId = await seedTranslationAt(new Date())
      await cleanupExpiredMessageTranslations()
      const [row] = await testDb
        .select({ id: conversationMessageTranslations.id })
        .from(conversationMessageTranslations)
        .where(eq(conversationMessageTranslations.id, freshId))
      expect(row?.id).toBe(freshId)
    })
  }
)
