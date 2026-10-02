import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from './db-test-fixture'
import { user, eq } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('./db-test-fixture')).testDb,
}))

import { markOnboardingProgress, readOnboardingProgress } from '../onboarding-progress'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ metadata: user.metadata }).from(user).limit(0)
  },
})
describe('per-user onboarding progress', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('writes once, preserves profile metadata and does not mark another user', async () => {
    const id = createId('user'),
      other = createId('user')
    await testDb.insert(user).values([
      {
        id,
        name: 'Acme',
        email: 'you@example.com',
        metadata: JSON.stringify({ custom: 'keep', onboarding: { extra: 'keep too' } }),
      },
      { id: other, name: 'Acme', email: 'other@example.com' },
    ])
    expect(await markOnboardingProgress(id, 'tourSeenAt')).toBe(true)
    const first = await testDb.query.user.findFirst({
      where: eq(user.id, id),
      columns: { metadata: true },
    })
    expect(JSON.parse(first!.metadata!)).toMatchObject({
      custom: 'keep',
      onboarding: { extra: 'keep too' },
    })
    expect(readOnboardingProgress(first!.metadata).tourSeenAt).toBeTruthy()
    expect(await markOnboardingProgress(id, 'tourSeenAt')).toBe(false)
    expect(await markOnboardingProgress(id, 'firstWinShownAt')).toBe(true)
    const next = await testDb.query.user.findFirst({
      where: eq(user.id, id),
      columns: { metadata: true },
    })
    expect(readOnboardingProgress(next!.metadata).tourSeenAt).toBe(
      readOnboardingProgress(first!.metadata).tourSeenAt
    )
    expect(readOnboardingProgress(next!.metadata).firstWinShownAt).toBeTruthy()
    expect(
      (await testDb.query.user.findFirst({
        where: eq(user.id, other),
        columns: { metadata: true },
      }))!.metadata
    ).toBeNull()
  })
})
