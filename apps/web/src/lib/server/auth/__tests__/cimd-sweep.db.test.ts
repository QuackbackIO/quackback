/**
 * The CIMD client sweep deletes only client rows a metadata document created
 * that nobody consented to, holds a live token for, or might be consenting to
 * right now; DCR clients are never touched.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type UserId } from '@quackback/ids'
import { inArray } from 'drizzle-orm'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  user,
} from '@/lib/server/db'
import { sweepUnconsentedCimdClients } from '../cimd-sweep'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: oauthClient.id, discovery: oauthClient.clientDiscoveryId })
      .from(oauthClient)
      .limit(0)
  },
})

const DAY = 24 * 60 * 60 * 1000
const ago = (ms: number) => new Date(Date.now() - ms)

let userId: UserId

async function client(
  name: string,
  opts: { discovery?: string | null; createdAgo?: number; updatedAgo?: number } = {}
): Promise<string> {
  const clientId = `https://${name}.example.com/oauth/client.json`
  await testDb.insert(oauthClient).values({
    id: `client_${crypto.randomUUID()}`,
    clientId,
    redirectUris: [`https://${name}.example.com/callback`],
    clientDiscoveryId: opts.discovery === undefined ? 'cimd' : opts.discovery,
    createdAt: ago(opts.createdAgo ?? 3 * DAY),
    updatedAt: ago(opts.updatedAgo ?? opts.createdAgo ?? 3 * DAY),
  })
  return clientId
}

async function remaining(clientIds: string[]): Promise<string[]> {
  const rows = await testDb
    .select({ clientId: oauthClient.clientId })
    .from(oauthClient)
    .where(inArray(oauthClient.clientId, clientIds))
  return rows.map((r) => r.clientId).sort()
}

describe.skipIf(!fixture.available)('sweepUnconsentedCimdClients', () => {
  beforeEach(async () => {
    await fixture.begin()
    userId = createId('user') as UserId
    await testDb.insert(user).values({
      id: userId,
      name: 'Dana',
      email: `dana-${Math.random().toString(36).slice(2, 8)}@example.com`,
      emailVerified: true,
    })
  })
  afterEach(() => fixture.rollback())
  afterAll(fixture.close)

  it('deletes an old CIMD client nobody consented to and keeps the ones in use', async () => {
    const abandoned = await client('abandoned')
    const consented = await client('consented')
    await testDb.insert(oauthConsent).values({
      id: `consent_${crypto.randomUUID()}`,
      clientId: consented,
      userId,
      scopes: ['read:feedback'],
    })
    // Consent forgotten after a redirect change, but the token still works.
    const tokenHolder = await client('token-holder')
    await testDb.insert(oauthAccessToken).values({
      id: `at_${crypto.randomUUID()}`,
      token: `at-${Math.random()}`,
      clientId: tokenHolder,
      userId,
      scopes: ['read:feedback'],
      expiresAt: new Date(Date.now() + DAY),
    })
    const refreshHolder = await client('refresh-holder')
    await testDb.insert(oauthRefreshToken).values({
      id: `rt_${crypto.randomUUID()}`,
      token: `rt-${Math.random()}`,
      clientId: refreshHolder,
      userId,
      scopes: ['read:feedback'],
      expiresAt: new Date(Date.now() + 30 * DAY),
    })
    // Someone may be on the consent screen for these.
    const recent = await client('recent', { createdAgo: 60_000 })
    const refreshed = await client('refreshed', { createdAgo: 3 * DAY, updatedAgo: 60_000 })
    // Not CIMD: dynamic registration and admin-created clients.
    const registered = await client('registered', { discovery: null })

    const all = [abandoned, consented, tokenHolder, refreshHolder, recent, refreshed, registered]
    expect(await sweepUnconsentedCimdClients()).toEqual({ deleted: 1 })
    expect(await remaining(all)).toEqual(all.filter((id) => id !== abandoned).sort())
  })

  it('deletes a client whose only tokens are expired or revoked', async () => {
    const stale = await client('stale')
    await testDb.insert(oauthAccessToken).values([
      {
        id: `at_${crypto.randomUUID()}`,
        token: `at-${Math.random()}`,
        clientId: stale,
        userId,
        scopes: ['read:feedback'],
        expiresAt: ago(DAY),
      },
      {
        id: `at_${crypto.randomUUID()}`,
        token: `at-${Math.random()}`,
        clientId: stale,
        userId,
        scopes: ['read:feedback'],
        expiresAt: new Date(Date.now() + DAY),
        revoked: ago(60_000),
      },
    ])
    expect(await sweepUnconsentedCimdClients()).toEqual({ deleted: 1 })
    expect(await remaining([stale])).toEqual([])
  })

  it('deletes at most one batch per run', async () => {
    const ids = await Promise.all(['a', 'b', 'c'].map((n) => client(`batch-${n}`)))
    expect(await sweepUnconsentedCimdClients({ batchSize: 2 })).toEqual({ deleted: 2 })
    expect(await remaining(ids)).toHaveLength(1)
  })
})
