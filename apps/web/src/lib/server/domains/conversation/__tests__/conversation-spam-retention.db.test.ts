/**
 * Real-Postgres proof of the daily spam-retention job (JOB-28): machine-filed
 * spam closed more than 30 days ago is deleted with its messages, spam a
 * teammate ended by hand is kept, so is younger filed spam, and the same job
 * then removes test-customer threads older than 7 days.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type ConversationId, type PrincipalId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const publishInboxRemovals = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/realtime/inbox-publish', () => ({ publishInboxRemovals }))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, conversationMessages, principal, inArray } from '@/lib/server/db'
import { runSpamRetention } from '../spam-retention-queue'

const fixture = await createDbTestFixture()
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000)

let visitor: PrincipalId
let testCustomer: PrincipalId

async function conversation(values: Partial<typeof conversations.$inferInsert>) {
  const [row] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: visitor, channel: 'email', ...values })
    .returning()
  await testDb.insert(conversationMessages).values({
    conversationId: row.id,
    senderType: 'visitor',
    principalId: values.visitorPrincipalId ?? visitor,
    content: 'Buy cheap watches',
  })
  return row.id as ConversationId
}

async function remaining(ids: ConversationId[]): Promise<ConversationId[]> {
  const rows = await testDb
    .select({ id: conversations.id })
    .from(conversations)
    .where(inArray(conversations.id, ids))
  return rows.map((r) => r.id as ConversationId)
}

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  publishInboxRemovals.mockClear()
  visitor = createId('principal')
  const owner = createId('principal')
  testCustomer = createId('principal')
  await testDb.insert(principal).values([
    { id: visitor, type: 'anonymous', role: 'user', createdAt: new Date() },
    { id: owner, type: 'anonymous', role: 'user', createdAt: new Date() },
  ])
  await testDb.insert(principal).values({
    id: testCustomer,
    type: 'anonymous',
    role: 'user',
    testOwnerPrincipalId: owner,
    createdAt: new Date(),
  })
})
afterEach(fixture.rollback)
afterAll(fixture.close)

const filedSpam = (closedDaysAgo: number, spamReason = 'ai') => ({
  status: 'closed' as const,
  endReason: 'spam',
  spamReason,
  resolvedAt: daysAgo(closedDaysAgo),
})

describe('spam retention', () => {
  it('deletes filed spam older than 30 days with its messages, and keeps manual or younger spam', async () => {
    const old = await conversation(filedSpam(31))
    const young = await conversation(filedSpam(29))
    const manual = await conversation(filedSpam(45, 'manual'))
    const openThread = await conversation({ status: 'open' })

    await runSpamRetention()

    expect((await remaining([old, young, manual, openThread])).sort()).toEqual(
      [young, manual, openThread].sort()
    )
    const orphanMessages = await testDb
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(inArray(conversationMessages.conversationId, [old]))
    expect(orphanMessages).toHaveLength(0)
    // An inbox open on the Spam view drops the deleted row.
    expect(publishInboxRemovals).toHaveBeenCalledWith(
      'conversation',
      expect.arrayContaining([expect.objectContaining({ id: old })])
    )
  })

  it('the same job removes test-customer threads older than 7 days and keeps newer ones', async () => {
    const stale = await conversation({ visitorPrincipalId: testCustomer, createdAt: daysAgo(8) })
    const fresh = await conversation({ visitorPrincipalId: testCustomer, createdAt: daysAgo(2) })
    const real = await conversation({ createdAt: daysAgo(60) })

    await runSpamRetention()

    expect((await remaining([stale, fresh, real])).sort()).toEqual([fresh, real].sort())
  })
})
