/**
 * Real-DB coverage for the Quinn CSAT slice of the performance report: only
 * rated conversations that Quinn was actually involved in count — a rated
 * conversation with no assistant involvement is excluded, and unrated
 * Quinn-handled conversations don't drag the average down.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { assistantInvolvements, conversations, principal } from '@/lib/server/db'
import type { ConversationId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { getQuinnPerformance } from '../quinn-performance'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db.select({ id: assistantInvolvements.id }).from(assistantInvolvements).limit(0)
  },
})

const FROM = new Date('2026-06-01T00:00:00Z')
const TO = new Date('2026-07-01T00:00:00Z')

async function seedConversation(opts: {
  csatRating?: number
  csatSubmittedAt?: Date
  createdAt?: Date
}): Promise<ConversationId> {
  const [visitor] = await testDb
    .insert(principal)
    .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
    .returning()
  const [conversation] = await testDb
    .insert(conversations)
    .values({
      visitorPrincipalId: visitor.id,
      channel: 'messenger',
      createdAt: opts.createdAt ?? new Date('2026-06-10T10:00:00Z'),
      ...(opts.csatRating !== undefined && { csatRating: opts.csatRating }),
      ...(opts.csatSubmittedAt !== undefined && { csatSubmittedAt: opts.csatSubmittedAt }),
    })
    .returning()
  return conversation.id
}

async function seedInvolvement(conversationId: ConversationId): Promise<void> {
  await testDb.insert(assistantInvolvements).values({
    conversationId,
    triggeredBy: 'first_touch',
    status: 'resolved_confirmed',
    createdAt: new Date('2026-06-10T10:05:00Z'),
  })
}

describe.skipIf(!fixture.available)('getQuinnPerformance csat (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('averages ratings only over Quinn-handled conversations', async () => {
    const quinnRated = await seedConversation({
      csatRating: 5,
      csatSubmittedAt: new Date('2026-06-12T09:00:00Z'),
    })
    await seedInvolvement(quinnRated)
    const quinnRatedLow = await seedConversation({
      csatRating: 3,
      csatSubmittedAt: new Date('2026-06-13T09:00:00Z'),
    })
    await seedInvolvement(quinnRatedLow)
    // Rated, but Quinn never touched it: must not enter the Quinn average.
    await seedConversation({ csatRating: 1, csatSubmittedAt: new Date('2026-06-12T10:00:00Z') })

    const report = await getQuinnPerformance(FROM, TO)
    expect(report.csat.responseCount).toBe(2)
    expect(report.csat.avgRating).toBe(4)
  })

  it('ignores unrated Quinn-handled conversations and out-of-range ratings', async () => {
    const unrated = await seedConversation({})
    await seedInvolvement(unrated)
    const stale = await seedConversation({
      csatRating: 2,
      csatSubmittedAt: new Date('2026-05-01T09:00:00Z'),
    })
    await seedInvolvement(stale)

    const report = await getQuinnPerformance(FROM, TO)
    expect(report.csat.responseCount).toBe(0)
    expect(report.csat.avgRating).toBe(0)
  })

  it('counts a conversation once even when Quinn was involved more than once', async () => {
    const rated = await seedConversation({
      csatRating: 4,
      csatSubmittedAt: new Date('2026-06-12T09:00:00Z'),
    })
    await seedInvolvement(rated)
    await seedInvolvement(rated)

    const report = await getQuinnPerformance(FROM, TO)
    expect(report.csat.responseCount).toBe(1)
  })
})
