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
import { createHmac } from 'node:crypto'
import {
  integrations,
  integrationDestinations,
  integrationSyncOperations,
  eq,
} from '@/lib/server/db'
import { encryptSecrets } from '../encryption'
import { enableStatusSyncFn } from '@/lib/server/functions/status-sync'
import { handleInboundWebhook } from '../inbound-webhook-handler'
import * as registration from '../webhook-registration'

const fixture = await createDbTestFixture()
describe.skipIf(!fixture.available)('webhook setup through the shared provider contract', () => {
  beforeEach(async () => {
    await fixture.begin()
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
  async function seed(provider = 'asana', token = 'fake-token') {
    return (
      await testDb
        .insert(integrations)
        .values({
          integrationType: provider,
          status: 'active',
          config: { channelId: 'project-1' },
          secrets: encryptSecrets({ accessToken: token }),
        })
        .returning()
    )[0]
  }
  it('completes the first Asana handshake and verifies events with the provider-issued secret', async () => {
    const integration = await seed()
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      expect(String(input)).toBe('https://app.asana.com/api/1.0/webhooks')
      expect(init?.method).toBe('POST')
      const target = JSON.parse(String(init?.body)).data.target
      const handshake = await handleInboundWebhook(
        new Request(target, {
          method: 'POST',
          headers: { 'X-Hook-Secret': 'provider-secret' },
          body: '{}',
        }),
        'asana'
      )
      expect(handshake.status).toBe(200)
      expect(handshake.headers.get('X-Hook-Secret')).toBe('provider-secret')
      return Response.json(
        { data: { gid: 'webhook-1' }, 'X-Hook-Secret': 'provider-secret' },
        { status: 201 }
      )
    })
    expect(
      await enableStatusSyncFn({
        data: { integrationId: integration.id, integrationType: 'asana' },
      })
    ).toMatchObject({ success: true, isManual: false })
    const saved = await testDb.query.integrations.findFirst({
      where: eq(integrations.id, integration.id),
    })
    expect(saved?.config).toMatchObject({
      externalWebhookId: 'webhook-1',
      webhookSecret: 'provider-secret',
      statusSyncEnabled: true,
    })
    const body = JSON.stringify({ events: [] })
    const received = await handleInboundWebhook(
      new Request('https://tenant.example/api/integrations/asana/webhook', {
        method: 'POST',
        headers: {
          'X-Hook-Signature': createHmac('sha256', 'provider-secret').update(body).digest('hex'),
        },
        body,
      }),
      'asana'
    )
    expect(received.status).toBe(200)
    expect(
      await testDb.query.integrationSyncOperations.findMany({
        where: eq(integrationSyncOperations.integrationId, integration.id),
      })
    ).toHaveLength(1)
  })
  it('cannot replace a configured secret through an unsolicited handshake', async () => {
    const integration = await seed()
    await testDb
      .update(integrations)
      .set({ config: { webhookSecret: 'saved-secret' } })
      .where(eq(integrations.id, integration.id))
    await handleInboundWebhook(
      new Request('https://tenant.example/api/integrations/asana/webhook', {
        method: 'POST',
        headers: { 'X-Hook-Secret': 'attacker-secret' },
        body: '{}',
      }),
      'asana'
    )
    expect(
      (await testDb.query.integrations.findFirst({ where: eq(integrations.id, integration.id) }))
        ?.config
    ).toEqual({ webhookSecret: 'saved-secret' })
    expect(
      await testDb.query.integrationSyncOperations.findMany({
        where: eq(integrationSyncOperations.integrationId, integration.id),
      })
    ).toHaveLength(0)
  })
  it('does not enable Asana if its authenticated registration response omits the signing secret', async () => {
    const integration = await seed()
    vi.mocked(fetch).mockResolvedValue(Response.json({ data: { gid: 'webhook-1' } }))
    await expect(
      enableStatusSyncFn({ data: { integrationId: integration.id, integrationType: 'asana' } })
    ).rejects.toThrow('signing secret')
    expect(
      (await testDb.query.integrations.findFirst({ where: eq(integrations.id, integration.id) }))
        ?.config
    ).not.toHaveProperty('statusSyncEnabled')
  })
  it('reports manual setup even when the connection has an access token', async () => {
    const integration = await seed('shortcut')
    expect(
      await enableStatusSyncFn({
        data: { integrationId: integration.id, integrationType: 'shortcut' },
      })
    ).toMatchObject({ isManual: true })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not enable automatic registration without credentials', async () => {
    const integration = await seed('asana', '')
    await expect(
      enableStatusSyncFn({ data: { integrationId: integration.id, integrationType: 'asana' } })
    ).rejects.toThrow('Reconnect')
    expect(
      (await testDb.query.integrations.findFirst({ where: eq(integrations.id, integration.id) }))
        ?.config
    ).not.toHaveProperty('statusSyncEnabled')
    expect(fetch).not.toHaveBeenCalled()
  })

  // GitHub gives each repository its own webhook and secret. The delivery
  // names its repository only to pick the secret; nothing is trusted or
  // written until that secret verifies it.
  describe('GitHub repository routing', () => {
    const delivery = (repository: { full_name: string; id?: number }, secret: string) => {
      const body = JSON.stringify({ action: 'opened', issue: { number: 1 }, repository })
      return new Request('https://tenant.example/api/integrations/github/webhook', {
        method: 'POST',
        headers: {
          'X-GitHub-Event': 'issues',
          'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
        },
        body,
      })
    }
    async function seedRepo(
      values: Partial<typeof integrationDestinations.$inferInsert> = {},
      config: Record<string, unknown> = { channelId: 'acme/app' }
    ) {
      const integration = await seed('github')
      await testDb.update(integrations).set({ config }).where(eq(integrations.id, integration.id))
      const [repo] = await testDb
        .insert(integrationDestinations)
        .values({
          integrationId: integration.id,
          kind: 'repo',
          externalId: 'acme/app',
          secrets: encryptSecrets({ webhookSecret: 'repo-secret' }),
          ...values,
        })
        .returning()
      return { integration, repo }
    }
    const reread = async (id: (typeof integrationDestinations.$inferSelect)['id']) =>
      testDb.query.integrationDestinations.findFirst({ where: eq(integrationDestinations.id, id) })
    const receipts = async (integrationId: (typeof integrations.$inferSelect)['id']) =>
      testDb.query.integrationSyncOperations.findMany({
        where: eq(integrationSyncOperations.integrationId, integrationId),
      })

    it("verifies with the repository's own secret and stamps the delivery", async () => {
      const { integration, repo } = await seedRepo()
      const res = await handleInboundWebhook(
        delivery({ full_name: 'acme/app', id: 7 }, 'repo-secret'),
        'github'
      )
      expect(res.status).toBe(200)
      const after = await reread(repo.id)
      expect(after?.lastInboundAt).toBeInstanceOf(Date)
      expect(after?.externalKey).toBe('7')
      expect(await receipts(integration.id)).toHaveLength(1)
    })

    it('refuses a delivery signed with any other secret', async () => {
      const { integration, repo } = await seedRepo(
        {},
        { channelId: 'acme/app', webhookSecret: 'legacy' }
      )
      const res = await handleInboundWebhook(
        delivery({ full_name: 'acme/app', id: 7 }, 'legacy'),
        'github'
      )
      expect(res.status).toBe(401)
      // Nothing learned from an unverified body.
      expect((await reread(repo.id))?.externalKey).toBeNull()
      expect(await receipts(integration.id)).toHaveLength(0)
    })

    it('refuses a repository it does not serve, or one switched off', async () => {
      await seedRepo({ externalId: 'acme/off', enabled: false })
      for (const full_name of ['acme/unknown', 'acme/off']) {
        const res = await handleInboundWebhook(delivery({ full_name }, 'repo-secret'), 'github')
        expect(res.status).toBe(404)
      }
    })

    it('verifies with the legacy connection secret until it moves onto the repository', async () => {
      const { repo } = await seedRepo(
        { secrets: null },
        { channelId: 'acme/app', webhookSecret: 'legacy' }
      )
      const res = await handleInboundWebhook(
        delivery({ full_name: 'acme/app' }, 'legacy'),
        'github'
      )
      expect(res.status).toBe(200)
      expect((await reread(repo.id))?.lastInboundAt).toBeInstanceOf(Date)
    })

    it('verifies the default repository with the legacy secret while it has no row yet', async () => {
      const integration = await seed('github')
      await testDb
        .update(integrations)
        .set({ config: { channelId: 'Acme/App', webhookSecret: 'legacy' } })
        .where(eq(integrations.id, integration.id))
      const res = await handleInboundWebhook(
        delivery({ full_name: 'acme/app' }, 'legacy'),
        'github'
      )
      expect(res.status).toBe(200)
      const other = await handleInboundWebhook(
        delivery({ full_name: 'acme/other' }, 'legacy'),
        'github'
      )
      expect(other.status).toBe(404)
    })

    it('follows a rename by the repository id', async () => {
      const { integration, repo } = await seedRepo({ externalKey: '7' })
      const res = await handleInboundWebhook(
        delivery({ full_name: 'acme/renamed', id: 7 }, 'repo-secret'),
        'github'
      )
      expect(res.status).toBe(200)
      expect((await reread(repo.id))?.externalId).toBe('acme/renamed')
      const saved = await testDb.query.integrations.findFirst({
        where: eq(integrations.id, integration.id),
      })
      expect(saved?.config).toMatchObject({ channelId: 'acme/renamed' })
    })
  })
})
