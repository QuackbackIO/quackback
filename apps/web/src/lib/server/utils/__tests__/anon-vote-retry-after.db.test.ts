/**
 * The wait an address over the anonymous vote limit is told: until the oldest
 * anonymous session it minted in the last hour leaves the window. Real
 * Postgres in a rolled-back transaction.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, session, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { anonVoteRetryAfter } = await import('../anon-rate-limit')

const fixture = await createDbTestFixture()
const MINUTE = 60_000

async function anonymousSession(ip: string, minutesAgo: number) {
  const userId = createId('user') as UserId
  await testDb.insert(user).values({ id: userId, name: 'Ghost', email: `${userId}@anon.example` })
  await testDb.insert(principal).values({
    id: createId('principal') as PrincipalId,
    userId,
    role: 'user',
    type: 'anonymous',
    createdAt: new Date(),
  })
  const createdAt = new Date(Date.now() - minutesAgo * MINUTE)
  await testDb.insert(session).values({
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    userId,
    ipAddress: ip,
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(Date.now() + 60 * MINUTE),
  })
}

describe.skipIf(!fixture.available)('anonymous vote retry-after (real DB)', () => {
  const ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`

  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('waits until the oldest session of the last hour ages out', async () => {
    await anonymousSession(ip, 40)
    await anonymousSession(ip, 10)
    // Older than the window: not counted, so it does not decide the wait.
    await anonymousSession(ip, 90)

    const seconds = await anonVoteRetryAfter(ip)
    expect(seconds).toBeGreaterThan(19 * 60)
    expect(seconds).toBeLessThanOrEqual(20 * 60 + 1)
  })

  it('falls back to the whole window when the address has no counted session', async () => {
    expect(await anonVoteRetryAfter('192.0.2.77')).toBe(60 * 60)
  })
})
