/**
 * Every stored `oauth_client.scopes` list keeps covering the live MCP scope
 * catalogue on real Postgres, rolled back after each test.
 *
 * A client registered before a scope joined the catalogue must still pass
 * authorize, which asks for the whole catalogue. NULL means "fall back to the
 * server-wide list" to the plugin and stays NULL.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { sql } from 'drizzle-orm'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { oauthClient } from '@/lib/server/db'
import { reconcileMcpOauthClientScopes } from '@/lib/server/auth/reconcile-mcp-oauth-client-scopes'
import { MCP_AS_SCOPES } from '@/lib/server/domains/api-keys/api-key-scopes'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ scopes: oauthClient.scopes }).from(oauthClient).limit(0)
  },
})

/** The catalogue as a client registered before the settings scopes would hold it. */
const OLDER_CLIENT_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'read:feedback',
  'write:feedback',
  'write:changelog',
  'read:article',
  'write:article',
  'read:chat',
  'write:chat',
]

const silentLog = () => ({ warn: vi.fn() })

async function seedClient(scopes: string[] | null): Promise<string> {
  const clientId = `client-${createId('app')}`
  await testDb.insert(oauthClient).values({
    id: createId('app'),
    clientId,
    redirectUris: ['http://127.0.0.1:4000/callback'],
    scopes,
  })
  return clientId
}

async function clientRow(clientId: string) {
  const rows = (await testDb.execute(
    sql`select scopes, ctid::text as ctid from oauth_client where client_id = ${clientId}`
  )) as unknown as Array<{ scopes: string[] | null; ctid: string }>
  return rows[0]
}

describe.skipIf(!fixture.available)('oauth_client.scopes (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('gains every catalogue scope it lacks and keeps what it had, without duplicates', async () => {
    const clientId = await seedClient([...OLDER_CLIENT_SCOPES, 'custom:kept'])
    const log = silentLog()

    await reconcileMcpOauthClientScopes({ db: testDb, log })

    const row = await clientRow(clientId)
    expect(log.warn).not.toHaveBeenCalled()
    for (const scope of MCP_AS_SCOPES) expect(row.scopes).toContain(scope)
    expect(row.scopes).toContain('custom:kept')
    expect(row.scopes?.slice(0, OLDER_CLIENT_SCOPES.length + 1)).toEqual([
      ...OLDER_CLIENT_SCOPES,
      'custom:kept',
    ])
    expect(new Set(row.scopes).size).toBe(row.scopes?.length)
  })

  it('leaves a row that already covers the catalogue untouched', async () => {
    const clientId = await seedClient(OLDER_CLIENT_SCOPES)
    await reconcileMcpOauthClientScopes({ db: testDb, log: silentLog() })
    const first = await clientRow(clientId)

    await reconcileMcpOauthClientScopes({ db: testDb, log: silentLog() })

    const second = await clientRow(clientId)
    expect(second.ctid).toBe(first.ctid)
    expect(second.scopes).toEqual(first.scopes)
  })

  it('keeps NULL scopes NULL', async () => {
    const clientId = await seedClient(null)
    await reconcileMcpOauthClientScopes({ db: testDb, log: silentLog() })
    expect((await clientRow(clientId)).scopes).toBeNull()
  })
})
