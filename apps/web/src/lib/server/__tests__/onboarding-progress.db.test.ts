import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from './db-test-fixture'
import { user, eq } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('./db-test-fixture')).testDb,
}))

import { markOnboardingProgress, readOnboardingProgress } from '../onboarding-progress'

const statements: string[] = []
const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ metadata: user.metadata }).from(user).limit(0)
  },
  logger: { logQuery: (query) => statements.push(query) },
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
      _onboarding: { tourSeenAt: expect.any(String) },
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

  it('claims a marker under a row lock and moves markers saved under the old key', async () => {
    const id = createId('user')
    await testDb.insert(user).values({
      id,
      name: 'Acme',
      email: 'you@example.com',
      metadata: JSON.stringify({ onboarding: { tourSeenAt: '2026-10-01T10:00:00.000Z' } }),
    })
    statements.length = 0
    expect(await markOnboardingProgress(id, 'tourSeenAt')).toBe(false)
    expect(await markOnboardingProgress(id, 'tourDismissedAt')).toBe(true)
    const claims = statements.filter((sql) => /select .*metadata.* from "user"/i.test(sql))
    expect(claims.length).toBeGreaterThanOrEqual(2)
    for (const sql of claims) expect(sql).toMatch(/for update/i)
    const row = await testDb.query.user.findFirst({
      where: eq(user.id, id),
      columns: { metadata: true },
    })
    expect(JSON.parse(row!.metadata!)).toEqual({
      _onboarding: {
        tourSeenAt: '2026-10-01T10:00:00.000Z',
        tourDismissedAt: expect.any(String),
      },
    })
  })
})
