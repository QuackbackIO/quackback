/**
 * The wait an address over the anonymous vote limit is told: until enough of
 * the anonymous sessions it minted in the last hour leave the window to bring
 * it back under the limit. Real Postgres in a rolled-back transaction.
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

  it('waits until enough sessions age out to fall under the limit of 50', async () => {
    // 80 sessions in the window, one every 30 seconds from 50 minutes ago.
    // Voting opens again once only 49 are left, so 31 must age out: the 31st
    // oldest was made 50 min - 30 x 30 s = 35 minutes ago, leaving 25 minutes.
    for (let i = 0; i < 80; i++) await anonymousSession(ip, 50 - i * 0.5)
    // Older than the window: not counted, so it does not decide the wait.
    await anonymousSession(ip, 90)

    const seconds = await anonVoteRetryAfter(ip)
    expect(seconds).toBeGreaterThan(24 * 60)
    expect(seconds).toBeLessThanOrEqual(25 * 60 + 1)
  })

  it('waits for the oldest when the address is exactly at the limit', async () => {
    for (let i = 0; i < 50; i++) await anonymousSession(ip, 40 - i * 0.5)

    const seconds = await anonVoteRetryAfter(ip)
    expect(seconds).toBeGreaterThan(19 * 60)
    expect(seconds).toBeLessThanOrEqual(20 * 60 + 1)
  })

  it('falls back to the whole window when the address has no counted session', async () => {
    expect(await anonVoteRetryAfter('192.0.2.77')).toBe(60 * 60)
  })
})
