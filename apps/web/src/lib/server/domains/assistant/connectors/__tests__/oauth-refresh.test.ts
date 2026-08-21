process.env.SECRET_KEY ||= 'test-secret-key-for-connector-oauth-abcdefgh'

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { connectors } from '@/lib/server/db'
import { createId } from '@quackback/ids'
import { encrypt } from '@/lib/server/encryption'
import { CONNECTOR_SECRETS_PURPOSE } from '../connectors.service'

vi.mock('@/lib/server/content/ssrf-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/content/ssrf-guard')>()
  return { ...actual, safePinnedFetch: vi.fn() }
})

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/config')>()
  return {
    ...actual,
    config: new Proxy(
      {},
      {
        get: (_t, prop) =>
          prop === 'secretKey'
            ? 'test-secret-key-for-connector-oauth-abcdefgh'
            : (actual.config as unknown as Record<string | symbol, unknown>)[prop],
      }
    ),
  }
})

import { safePinnedFetch } from '@/lib/server/content/ssrf-guard'
import { getValidConnectorAccessToken } from '../oauth-provider'
import type { ConnectorRow } from '../connectors.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: connectors.id }).from(connectors).limit(0)
  },
})

function row(overrides: Partial<ConnectorRow> = {}): ConnectorRow {
  const expiresAt = new Date(Date.now() + 60_000).toISOString()
  return {
    id: createId('connector'),
    name: 'Acme',
    slug: 'acme',
    url: 'https://example.test/mcp',
    authMode: 'oauth',
    secrets: encrypt(
      JSON.stringify({
        oauth: {
          accessToken: 'old-token',
          refreshToken: 'refresh-me',
          expiresAt,
          tokenEndpoint: 'https://example.test/oauth/token',
        },
      }),
      CONNECTOR_SECRETS_PURPOSE
    ),
    status: 'connected',
    tools: [],
    toolPolicies: { groupDefaults: { read: 'always', write: 'approval' }, tools: {} },
    assignments: { agent: false, copilot: false },
    enabled: true,
    lastSyncedAt: null,
    lastCallAt: null,
    lastError: null,
    lastErrorAt: null,
    errorCount: 0,
    createdByPrincipalId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe.skipIf(!fixture.available)('getValidConnectorAccessToken', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('returns the stored token when it is still inside the buffer', async () => {
    const token = await getValidConnectorAccessToken(
      row({
        secrets: encrypt(
          JSON.stringify({
            oauth: {
              accessToken: 'fresh',
              refreshToken: 'r',
              expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
              tokenEndpoint: 'https://example.test/oauth/token',
            },
          }),
          CONNECTOR_SECRETS_PURPOSE
        ),
      }),
      testDb
    )
    expect(token).toBe('fresh')
    expect(safePinnedFetch).not.toHaveBeenCalled()
  })

  it('marks the connector as needing attention when refresh fails', async () => {
    vi.mocked(safePinnedFetch).mockResolvedValue(new Response('nope', { status: 401 }))
    const existing = row()
    await testDb.insert(connectors).values({
      ...existing,
    })
    const token = await getValidConnectorAccessToken(existing, testDb)
    expect(token).toBe('old-token')
    const [updated] = await testDb.select().from(connectors)
    expect(updated.status).toBe('error')
    expect(updated.lastError).toBe('Authorization expired')
  })
})
