/**
 * Each GitHub repository's webhook through its lifecycle, against a real
 * database with GitHub's API stubbed: choosing a repository moves the webhook
 * with it, the inbox's event sync and status sync act per repository, and a
 * disconnect removes every repository's webhook before revoking the token.
 */
import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/secret-key', () => ({
  activeSecretKey: () => 'integration-sync-review-key-32-characters-only',
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const builder = { validator: () => builder, handler: (handler: unknown) => handler }
    return builder
  },
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: vi.fn(async () => ({})) }))
vi.mock('@/lib/server/cache', () => ({
  cacheDel: vi.fn(async () => {}),
  CACHE_KEYS: { INTEGRATION_MAPPINGS: 'mappings' },
}))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getPlatformCredentials: vi.fn(async () => ({ clientId: 'cid', clientSecret: 'csecret' })),
}))
// Fleet install routing is a control-plane concern, not under test here.
vi.mock('@/lib/server/integrations/install-registry', () => ({
  unregisterInstall: vi.fn(async () => {}),
}))
import { integrations, integrationDestinations, eq } from '@/lib/server/db'
import { encryptSecrets } from '@/lib/server/integrations/encryption'
import { readDestinationSecret } from '@/lib/server/integrations/destinations'
import * as registration from '@/lib/server/integrations/webhook-registration'
import { syncGitHubWebhookEvents } from '@/lib/server/domains/channel-accounts/github-connection'
import { enableStatusSyncFn, disableStatusSyncFn } from '@/lib/server/functions/status-sync'
import { deleteIntegrationFn } from '@/lib/server/functions/integrations'
import { setGitHubRepositoryFn } from '../functions'

type IntegrationRow = typeof integrations.$inferSelect

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: integrationDestinations.id }).from(integrationDestinations).limit(0)
  },
})

describe.skipIf(!fixture.available)('GitHub repository webhooks', () => {
  /** `METHOD /path` of every GitHub API call, in order. */
  let calls: string[]

  /** Answer GitHub API calls by `METHOD /path`; anything unexpected fails the test. */
  function github(routes: Record<string, () => Response>) {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const call = `${init?.method ?? 'GET'} ${String(input).replace('https://api.github.com', '')}`
      calls.push(call)
      const route = routes[call]
      if (!route) throw new Error(`unexpected GitHub call: ${call}`)
      return route()
    })
  }

  beforeEach(async () => {
    await fixture.begin()
    calls = []
    vi.spyOn(globalThis, 'fetch')
    vi.spyOn(registration, 'buildWebhookCallbackUrl').mockImplementation(
      (provider) => `https://tenant.example/api/integrations/${provider}/webhook`
    )
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  async function seedGitHub(config: Record<string, unknown>) {
    const [row] = await testDb
      .insert(integrations)
      .values({
        integrationType: 'github',
        status: 'active',
        config,
        secrets: encryptSecrets({ accessToken: 'tok' }),
      })
      .returning()
    return row
  }

  async function addRepo(
    integration: IntegrationRow,
    values: Partial<typeof integrationDestinations.$inferInsert>
  ) {
    const [row] = await testDb
      .insert(integrationDestinations)
      .values({ integrationId: integration.id, kind: 'repo', externalId: 'acme/old', ...values })
      .returning()
    return row
  }

  const repos = (integration: IntegrationRow) =>
    testDb.query.integrationDestinations.findMany({
      where: eq(integrationDestinations.integrationId, integration.id),
      orderBy: (d, { asc }) => [asc(d.externalId)],
    })
  const configOf = async (integration: IntegrationRow) =>
    (await testDb.query.integrations.findFirst({ where: eq(integrations.id, integration.id) }))
      ?.config as Record<string, unknown>

  const listed = () =>
    Response.json([
      { id: 1, full_name: 'acme/old', private: false },
      { id: 2, full_name: 'acme/new', private: true },
    ])

  it('moves the webhook when the repository changes', async () => {
    const integration = await seedGitHub({ channelId: 'acme/old', statusSyncEnabled: true })
    await addRepo(integration, {
      externalWebhookId: '11',
      secrets: encryptSecrets({ webhookSecret: 'old-secret' }),
      config: { inboundMode: 'off' },
    })
    github({
      'GET /user/repos?sort=updated&per_page=100': listed,
      'DELETE /repos/acme/old/hooks/11': () => new Response(null, { status: 204 }),
      'POST /repos/acme/new/hooks': () => Response.json({ id: 22 }, { status: 201 }),
    })

    await setGitHubRepositoryFn({ data: { repository: 'ACME/new' } })

    expect(calls).toEqual([
      'GET /user/repos?sort=updated&per_page=100',
      'DELETE /repos/acme/old/hooks/11',
      'POST /repos/acme/new/hooks',
    ])
    const [repo] = await repos(integration)
    expect(repo).toMatchObject({
      externalId: 'acme/new',
      externalKey: '2',
      externalWebhookId: '22',
      webhookEvents: ['issues'],
      config: { inboundMode: 'off' },
    })
    const secret = readDestinationSecret(repo)
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    expect(secret).not.toBe('old-secret')
    expect(await configOf(integration)).toMatchObject({ channelId: 'acme/new' })
  })

  it('switches without a webhook when nothing listens for one', async () => {
    const integration = await seedGitHub({ channelId: 'acme/old' })
    await addRepo(integration, {})
    github({ 'GET /user/repos?sort=updated&per_page=100': listed })

    await setGitHubRepositoryFn({ data: { repository: 'acme/new' } })

    const [repo] = await repos(integration)
    expect(repo).toMatchObject({ externalId: 'acme/new', externalWebhookId: null })
  })

  it('refuses a repository the connection cannot see', async () => {
    const integration = await seedGitHub({ channelId: 'acme/old' })
    await addRepo(integration, {})
    github({ 'GET /user/repos?sort=updated&per_page=100': listed })

    await expect(setGitHubRepositoryFn({ data: { repository: 'evil/repo' } })).rejects.toThrow(
      'Choose a repository'
    )
    expect((await repos(integration)).map((r) => r.externalId)).toEqual(['acme/old'])
    expect(await configOf(integration)).toEqual({ channelId: 'acme/old' })
  })

  it('syncs webhook events per repository and records the one that fails', async () => {
    const integration = await seedGitHub({ channelId: 'acme/a', statusSyncEnabled: true })
    await addRepo(integration, {
      externalId: 'acme/a',
      externalWebhookId: '1',
      secrets: encryptSecrets({ webhookSecret: 'a-secret' }),
    })
    await addRepo(integration, { externalId: 'acme/b' })
    await addRepo(integration, { externalId: 'acme/c' })
    await addRepo(integration, { externalId: 'acme/off', enabled: false })
    github({
      'PATCH /repos/acme/a/hooks/1': () => new Response(''),
      'POST /repos/acme/b/hooks': () => new Response('Must have admin rights', { status: 403 }),
      'POST /repos/acme/c/hooks': () => Response.json({ id: 3 }, { status: 201 }),
    })

    await expect(syncGitHubWebhookEvents()).rejects.toThrow('acme/b')

    expect(calls).not.toContain('POST /repos/acme/off/hooks')
    const [a, b, c, off] = await repos(integration)
    expect(a).toMatchObject({ externalWebhookId: '1', webhookEvents: ['issues'], lastError: null })
    expect(readDestinationSecret(a)).toBe('a-secret')
    expect(b.lastError).toContain('Must have admin rights')
    expect(c).toMatchObject({ externalWebhookId: '3', lastError: null })
    expect(off.externalWebhookId).toBeNull()
    const saved = await testDb.query.integrations.findFirst({
      where: eq(integrations.id, integration.id),
    })
    expect(saved?.lastError).toContain('acme/b')
  })

  it('turns status sync on and off one repository webhook at a time', async () => {
    const integration = await seedGitHub({ channelId: 'acme/a' })
    await addRepo(integration, { externalId: 'acme/a' })
    await addRepo(integration, { externalId: 'acme/b' })
    github({
      'POST /repos/acme/a/hooks': () => Response.json({ id: 1 }, { status: 201 }),
      'POST /repos/acme/b/hooks': () => Response.json({ id: 2 }, { status: 201 }),
      'DELETE /repos/acme/a/hooks/1': () => new Response(null, { status: 204 }),
      'DELETE /repos/acme/b/hooks/2': () => new Response(null, { status: 204 }),
    })

    await enableStatusSyncFn({ data: { integrationId: integration.id, integrationType: 'github' } })
    // The switch lives on the connection; secrets live on the repositories.
    expect(await configOf(integration)).toEqual({ channelId: 'acme/a', statusSyncEnabled: true })
    expect((await repos(integration)).map((r) => r.externalWebhookId)).toEqual(['1', '2'])

    await disableStatusSyncFn({
      data: { integrationId: integration.id, integrationType: 'github' },
    })
    expect(calls.filter((c) => c.startsWith('DELETE'))).toEqual([
      'DELETE /repos/acme/a/hooks/1',
      'DELETE /repos/acme/b/hooks/2',
    ])
    expect(await configOf(integration)).toEqual({ channelId: 'acme/a' })
    for (const repo of await repos(integration))
      expect(repo).toMatchObject({ externalWebhookId: null, secrets: null })
  })

  it('removes every repository webhook before revoking the token on disconnect', async () => {
    const integration = await seedGitHub({ channelId: 'acme/a', statusSyncEnabled: true })
    await addRepo(integration, { externalId: 'acme/a', externalWebhookId: '1' })
    await addRepo(integration, { externalId: 'acme/b', externalWebhookId: '2' })
    github({
      'DELETE /repos/acme/a/hooks/1': () => new Response(null, { status: 204 }),
      // A failure on one repository neither stops the others nor the disconnect.
      'DELETE /repos/acme/b/hooks/2': () => {
        throw new Error('network down')
      },
      'DELETE /applications/cid/token': () => new Response(null, { status: 204 }),
    })

    await deleteIntegrationFn({ data: { id: integration.id } })

    expect(calls).toEqual([
      'DELETE /repos/acme/a/hooks/1',
      'DELETE /repos/acme/b/hooks/2',
      'DELETE /applications/cid/token',
    ])
    expect(await repos(integration)).toEqual([])
  })
})
