/**
 * Real-DB coverage for the resolved_confirmed CSAT trigger: a positive rating
 * while Quinn's active involvement already answered counts as the customer's
 * explicit affirmation (§ recordOutcome, otherwise unreachable pre-CSAT).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { vi } from 'vitest'
import type { AssistantInvolvementId, ConversationId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { assistantInvolvements, conversations, principal, eq } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { confirmResolutionFromCsat } from '@/lib/server/domains/assistant/assistant.involvement'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: assistantInvolvements.id }).from(assistantInvolvements).limit(0)
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

async function seedInvolvement(conversationId: ConversationId, lastAssistantAnswerAt: Date | null) {
  const [row] = await testDb
    .insert(assistantInvolvements)
    .values({ conversationId, triggeredBy: 'first_touch', lastAssistantAnswerAt })
    .returning()
  return row
}

async function statusOf(involvementId: AssistantInvolvementId) {
  const [row] = await testDb
    .select({ status: assistantInvolvements.status })
    .from(assistantInvolvements)
    .where(eq(assistantInvolvements.id, involvementId))
  return row.status
}

describe.skipIf(!fixture.available)('confirmResolutionFromCsat (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('resolves confirmed on a positive rating while Quinn already answered', async () => {
    const conversationId = await seedConversation()
    const involvement = await seedInvolvement(conversationId, new Date())

    await confirmResolutionFromCsat(conversationId, 5)

    expect(await statusOf(involvement.id)).toBe('resolved_confirmed')
  })

  it('leaves the involvement active on a middling rating', async () => {
    const conversationId = await seedConversation()
    const involvement = await seedInvolvement(conversationId, new Date())

    await confirmResolutionFromCsat(conversationId, 2)

    expect(await statusOf(involvement.id)).toBe('active')
  })

  it('leaves the involvement active when Quinn has not yet answered', async () => {
    const conversationId = await seedConversation()
    const involvement = await seedInvolvement(conversationId, null)

    await confirmResolutionFromCsat(conversationId, 5)

    expect(await statusOf(involvement.id)).toBe('active')
  })

  it('no-ops without an involvement on the conversation', async () => {
    const conversationId = await seedConversation()

    await expect(confirmResolutionFromCsat(conversationId, 5)).resolves.toBeUndefined()
  })
})
