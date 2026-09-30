/**
 * Real-DB coverage for the resolved_confirmed CSAT trigger: a positive rating
 * while Quinn's active involvement already answered counts as the customer's
 * explicit affirmation (§ recordOutcome, otherwise unreachable pre-CSAT). The
 * confirm runs from a queued reaction, possibly late, so it acts only on the
 * involvement the rating was given about: the one open when it was submitted.
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

async function seedInvolvement(
  conversationId: ConversationId,
  lastAssistantAnswerAt: Date | null,
  opened: { createdAt?: Date; status?: 'active' | 'handed_off' } = {}
) {
  const [row] = await testDb
    .insert(assistantInvolvements)
    .values({ conversationId, triggeredBy: 'first_touch', lastAssistantAnswerAt, ...opened })
    .returning()
  return row
}

/** 2026-01-05 at the given UTC time. */
const at = (hhmm: string) => new Date(`2026-01-05T${hhmm}:00.000Z`)

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

    await confirmResolutionFromCsat(conversationId, 5, new Date())

    expect(await statusOf(involvement.id)).toBe('resolved_confirmed')
  })

  it('leaves the involvement active on a middling rating', async () => {
    const conversationId = await seedConversation()
    const involvement = await seedInvolvement(conversationId, new Date())

    await confirmResolutionFromCsat(conversationId, 2, new Date())

    expect(await statusOf(involvement.id)).toBe('active')
  })

  it('leaves the involvement active when Quinn has not yet answered', async () => {
    const conversationId = await seedConversation()
    const involvement = await seedInvolvement(conversationId, null)

    await confirmResolutionFromCsat(conversationId, 5, new Date())

    expect(await statusOf(involvement.id)).toBe('active')
  })

  it('no-ops without an involvement on the conversation', async () => {
    const conversationId = await seedConversation()

    await expect(confirmResolutionFromCsat(conversationId, 5, new Date())).resolves.toBeUndefined()
  })

  it('a late confirm never confirms an involvement opened after the rating', async () => {
    const conversationId = await seedConversation()
    // The rating (10:20) was about the first involvement, which has since
    // handed off; Quinn engaged again at 10:40 and has answered.
    const rated = await seedInvolvement(conversationId, at('10:10'), {
      createdAt: at('10:00'),
      status: 'handed_off',
    })
    const later = await seedInvolvement(conversationId, at('10:45'), { createdAt: at('10:40') })

    await confirmResolutionFromCsat(conversationId, 5, at('10:20'))

    expect(await statusOf(rated.id)).toBe('handed_off')
    expect(await statusOf(later.id)).toBe('active')
  })

  it('a late confirm skips when no involvement was open at the rating', async () => {
    const conversationId = await seedConversation()
    const later = await seedInvolvement(conversationId, at('10:45'), { createdAt: at('10:40') })

    await confirmResolutionFromCsat(conversationId, 5, at('10:20'))

    expect(await statusOf(later.id)).toBe('active')
  })

  it('a late confirm still confirms the rated involvement while it is active', async () => {
    const conversationId = await seedConversation()
    const rated = await seedInvolvement(conversationId, at('10:10'), { createdAt: at('10:00') })

    await confirmResolutionFromCsat(conversationId, 5, at('10:20'))

    expect(await statusOf(rated.id)).toBe('resolved_confirmed')
  })
})
