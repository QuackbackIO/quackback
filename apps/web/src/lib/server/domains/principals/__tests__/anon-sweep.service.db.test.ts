/**
 * Real-Postgres proof of the anonymous-principal sweep (JOB-29): a month-old
 * anonymous identity that never wrote anything is deleted, while a widget
 * visitor who opened a conversation, or only wrote a message, is kept.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, conversationMessages, principal, user, inArray } from '@/lib/server/db'
import { sweepAnonymousPrincipals } from '../anon-sweep.service'

const fixture = await createDbTestFixture()
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000)

/** An anonymous identity (user row + principal) created `age` days ago. */
async function anonymous(age: number): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  await testDb.insert(user).values({
    id: userId,
    name: 'Anonymous',
    email: `temp-${userId}@anon.quackback.io`,
    createdAt: daysAgo(age),
  })
  await testDb
    .insert(principal)
    .values({ id, userId, type: 'anonymous', role: 'user', createdAt: daysAgo(age) })
  return id
}

async function present(ids: PrincipalId[]): Promise<PrincipalId[]> {
  const rows = await testDb
    .select({ id: principal.id })
    .from(principal)
    .where(inArray(principal.id, ids))
  return rows.map((r) => r.id as PrincipalId)
}

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
})
afterEach(fixture.rollback)
afterAll(fixture.close)

describe('anonymous principal sweep', () => {
  it('JOB-29 deletes an empty month-old anonymous identity and spares support visitors', async () => {
    const empty = await anonymous(31)
    const recent = await anonymous(5)
    const withConversation = await anonymous(31)
    const withMessageOnly = await anonymous(31)

    const [thread] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: withConversation, channel: 'messenger' })
      .returning()
    // A message in someone else's thread (for example after a merge).
    await testDb.insert(conversationMessages).values({
      conversationId: thread.id,
      senderType: 'visitor',
      principalId: withMessageOnly,
      content: 'Hello?',
    })

    const result = await sweepAnonymousPrincipals({ batchSize: 100_000 })
    expect(result.deleted).toBeGreaterThanOrEqual(1)

    expect((await present([empty, recent, withConversation, withMessageOnly])).sort()).toEqual(
      [recent, withConversation, withMessageOnly].sort()
    )
  })
})
