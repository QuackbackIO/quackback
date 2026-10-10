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
import { integrations, integrationSyncOperations, eq } from '@/lib/server/db'
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
})
