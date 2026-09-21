import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest'
import { randomUUID, createHmac } from 'node:crypto'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/secret-key', () => ({
  activeSecretKey: () => 'integration-sync-review-key-32-characters-only',
}))
// A test-only registry entry exercises the same contract as a newly added provider.
vi.mock('@/lib/server/integrations/index', async (original) => {
  const actual = await original<typeof import('@/lib/server/integrations/index')>()
  const { templateIntegration } = await import('@/integrations/_template/server')
  return {
    ...actual,
    getIntegration: (type: string) =>
      type === 'template' ? templateIntegration : actual.getIntegration(type),
  }
})
import {
  user,
  principal,
  boards,
  posts,
  integrations,
  integrationPlatformCredentials,
  integrationEventMappings,
  postExternalLinks,
  integrationSyncOperations as operations,
  eq,
} from '@/lib/server/db'
import {
  encryptSecrets,
  encryptPlatformCredentials,
  decryptSecrets,
} from '@/lib/server/integrations/encryption'
import { queueHookSync } from '@/lib/server/integrations/sync/hooks'
import { queueInboundStatus } from '@/lib/server/integrations/sync/inbound'
import { runIntegrationSync } from '@/lib/server/integrations/sync/worker'
import { syncTestJob } from '@/lib/server/integrations/sync/__tests__/job'
import { inspectSyncOperation } from '@/lib/server/integrations/sync/history'
import { handleInboundWebhook } from '@/lib/server/integrations/inbound-webhook-handler'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'
const fixture = await createDbTestFixture()
describe.skipIf(!fixture.available)('provider capability flows', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: [] }))
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fixture.rollback()
  })
  afterAll(fixture.close)
  async function platformCredentials(provider: string) {
    const secrets = encryptPlatformCredentials({
      clientId: 'test-client',
      clientSecret: 'test-secret',
    })
    await testDb
      .insert(integrationPlatformCredentials)
      .values({ integrationType: provider, secrets })
      .onConflictDoUpdate({
        target: integrationPlatformCredentials.integrationType,
        set: { secrets },
      })
  }
  async function seed(provider: string) {
    const [person] = await testDb
      .insert(user)
      .values({ name: 'Review author', email: randomUUID() + '@example.test' })
      .returning()
    const [actor] = await testDb
      .insert(principal)
      .values({
        userId: person.id,
        type: 'user',
        role: 'admin',
        displayName: 'Review author',
        createdAt: new Date(),
      })
      .returning()
    const [board] = await testDb
      .insert(boards)
      .values({ name: 'Review', slug: randomUUID() })
      .returning()
    const [post] = await testDb
      .insert(posts)
      .values({
        boardId: board.id,
        principalId: actor.id,
        title: 'Review post',
        content: 'Content',
      })
      .returning()
    const [integration] = await testDb
      .insert(integrations)
      .values({
        integrationType: provider,
        status: 'active',
        secrets: encryptSecrets({ accessToken: 'fake-review-token' }),
        principalId: actor.id,
        config: {
          channelId: 'target',
          subdomain: 'test',
          instanceUrl: 'https://example.test',
          statusSyncEnabled: true,
          webhookSecret: 'review-signing-secret',
        },
      })
      .returning()
    await testDb.insert(integrationEventMappings).values({
      integrationId: integration.id,
      eventType: 'post.created',
      actionType: 'send_message',
      actionConfig: { channelId: 'target' },
      enabled: true,
    })
    const event = {
      id: createId('event'),
      type: 'post.created' as const,
      timestamp: new Date().toISOString(),
      actor: {
        type: 'user' as const,
        principalId: actor.id,
        userId: person.id,
        email: person.email!,
      },
      data: {
        post: {
          id: post.id,
          boardId: board.id,
          boardSlug: board.slug,
          title: post.title,
          content: post.content,
          voteCount: 0,
          authorEmail: person.email!,
        },
      },
    }
    return { person, actor, post, integration, event }
  }
  it.each(['stripe', 'freshdesk', 'salesforce'])(
    '%s provides customer context with normal configuration and no event mapping',
    async (provider) => {
      const { person, integration } = await seed(provider)
      await testDb
        .delete(integrationEventMappings)
        .where(eq(integrationEventMappings.integrationId, integration.id))
      await testDb
        .update(integrations)
        .set({ config: { subdomain: 'test', instanceUrl: 'https://example.my.salesforce.com' } })
        .where(eq(integrations.id, integration.id))
      vi.mocked(fetch).mockImplementation(async (input) => {
        const url = new URL(String(input))
        if (provider === 'stripe') {
          expect(url.searchParams.get('email')).toBe(person.email)
          return Response.json({ data: [{ id: 'cus_123', name: 'Customer' }] })
        }
        if (provider === 'freshdesk') {
          expect(url.searchParams.get('email')).toBe(person.email)
          return Response.json([{ id: 123, name: 'Customer' }])
        }
        expect(url.searchParams.get('q')).toContain(person.email)
        return Response.json({
          records: [{ Id: 'contact123', Name: 'Customer', Account: { Name: 'Acme' } }],
        })
      })
      const { fetchCustomerContext } = await import('@/lib/server/integrations/context')
      const cards = await fetchCustomerContext(person.email!)
      expect(cards).toEqual([
        expect.objectContaining({
          provider,
          name: 'Customer',
          url: expect.stringContaining(
            provider === 'stripe' ? 'cus_123' : provider === 'freshdesk' ? '123' : 'contact123'
          ),
        }),
      ])
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(
        await testDb.query.integrationSyncOperations.findMany({
          where: eq(operations.integrationId, integration.id),
        })
      ).toHaveLength(0)
    }
  )
  it.each(['jira', 'gitlab', 'asana', 'clickup', 'trello', 'shortcut', 'azure_devops'])(
    '%s inbound review includes the received status and item identity',
    async (provider) => {
      const { integration, actor, post } = await seed(provider)
      const queued = (await queueInboundStatus(
        integration,
        {
          externalId: 'REMOTE-123',
          externalStatus: 'Done',
          eventType: 'item.updated',
          destinationId: 'target',
          occurredAt: new Date().toISOString(),
        },
        randomUUID()
      ))!
      const op = (await testDb.query.integrationSyncOperations.findFirst({
        where: eq(operations.id, queued.id),
      }))!
      await testDb.insert(postExternalLinks).values({
        postId: post.id,
        integrationId: integration.id,
        integrationType: provider,
        externalId: 'REMOTE-123',
        externalUrl: 'https://example.test/items/REMOTE-123',
        syncScope: `${op.installation}:${op.destinationKey}`,
      })
      await runIntegrationSync(syncTestJob(op.id))
      const child = (
        await testDb.query.integrationSyncOperations.findMany({
          where: eq(operations.integrationId, integration.id),
        })
      ).find((row) => row.kind === 'status')
      expect(child).toBeDefined()
      const detail = await inspectSyncOperation(child!.id, {
        principalId: actor.id,
        role: 'admin',
        principalType: 'user',
        permissions: new Set(Object.values(PERMISSIONS)),
        segmentIds: new Set(),
      })
      expect(detail.preview?.content).toContain('Done')
      expect(detail.item).toMatchObject({
        state: 'conflict',
        sourceId: post.id,
        sourceTitle: post.title,
        remoteDisplayId: 'REMOTE-123',
        remoteUrl: 'https://example.test/items/REMOTE-123',
      })
    }
  )
  it('Asana keeps a signed compact event durable when its lookup fails', async () => {
    await seed('asana')
    vi.mocked(fetch).mockResolvedValue(new Response('Unavailable', { status: 503 }))
    const body = JSON.stringify({
      events: [{ resource: { resource_type: 'task', gid: 'task-1' }, action: 'changed' }],
    })
    const response = await handleInboundWebhook(
      new Request('https://quackback.test/api/integrations/asana/webhook', {
        method: 'POST',
        headers: {
          'X-Hook-Signature': createHmac('sha256', 'review-signing-secret')
            .update(body)
            .digest('hex'),
        },
        body,
      }),
      'asana'
    )
    const records = await testDb.query.integrationSyncOperations.findMany({
      where: eq(operations.provider, 'asana'),
    })
    expect(response.status >= 500 || records.length > 0).toBe(true)
    expect(response.status).toBe(200)
    expect(fetch).not.toHaveBeenCalled()
    expect(records).toHaveLength(1)
    await expect(runIntegrationSync(syncTestJob(records[0].id))).rejects.toThrow(
      'waiting for a retry'
    )
    expect(
      await testDb.query.integrationSyncOperations.findFirst({
        where: eq(operations.id, records[0].id),
      })
    ).toMatchObject({ state: 'retry_wait', dispatchedAt: null, payload: expect.any(String) })
  })
  it('Asana persists every task in a batch and deduplicates redelivery', async () => {
    await seed('asana')
    const body = JSON.stringify({
      events: ['task-1', 'task-2'].map((gid) => ({
        resource: { resource_type: 'task', gid },
        action: 'changed',
      })),
    })
    const receive = () =>
      handleInboundWebhook(
        new Request('https://quackback.test/api/integrations/asana/webhook', {
          method: 'POST',
          headers: {
            'X-Hook-Signature': createHmac('sha256', 'review-signing-secret')
              .update(body)
              .digest('hex'),
          },
          body,
        }),
        'asana'
      )
    expect((await receive()).status).toBe(200)
    expect((await receive()).status).toBe(200)
    let records = await testDb.query.integrationSyncOperations.findMany({
      where: eq(operations.provider, 'asana'),
    })
    expect(records).toHaveLength(1)
    vi.mocked(fetch).mockImplementation(async (input) => {
      expect(String(input)).toMatch(/\/tasks\/task-[12]\?/)
      return Response.json({
        data: {
          memberships: [
            { project: { gid: 'unrelated' }, section: { name: 'Wrong' } },
            { project: { gid: 'target' }, section: { name: 'Done' } },
          ],
        },
      })
    })
    await runIntegrationSync(syncTestJob(records[0].id))
    records = await testDb.query.integrationSyncOperations.findMany({
      where: eq(operations.provider, 'asana'),
    })
    const { readSyncPayload } = await import('@/lib/server/integrations/sync/ledger')
    expect(
      records
        .filter((row) => row.kind === 'receive-status')
        .map((row) => readSyncPayload(row).data.result)
    ).toEqual(
      expect.arrayContaining(
        ['task-1', 'task-2'].map((externalId) =>
          expect.objectContaining({ externalId, externalStatus: 'Done', destinationId: 'target' })
        )
      )
    )
    expect(records).toHaveLength(3)
    expect(records.find((row) => row.kind === 'receive-webhook')).toMatchObject({
      state: 'succeeded',
      payload: null,
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('Discord rejects a notification target outside the connected guild', async () => {
    const { event, integration } = await seed('discord')
    await testDb
      .update(integrations)
      .set({ config: { channelId: 'target', guildId: 'connected-guild' } })
      .where(eq(integrations.id, integration.id))
    const calls: { url: string; method: string }[] = []
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ url, method })
      if (method === 'GET')
        return Response.json({ id: 'target', guild_id: 'another-guild', type: 0 })
      return Response.json({ id: 'fake-message-id' })
    })
    const op = (await queueHookSync({
      hookType: 'discord',
      event,
      target: { channelId: 'target' },
      config: { integrationId: integration.id },
    }))!
    await runIntegrationSync(syncTestJob(op.id))
    const stored = await testDb.query.integrationSyncOperations.findFirst({
      where: eq(operations.id, op.id),
    })
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0)
    expect(stored).toMatchObject({ state: 'failed', dispatchedAt: null })
  })
  it('Discord validates saved destinations and delivers to the connected guild', async () => {
    const { event, integration } = await seed('discord')
    await testDb
      .update(integrations)
      .set({ config: { channelId: 'target', guildId: 'connected-guild' } })
      .where(eq(integrations.id, integration.id))
    const { validateIntegrationDestination } = await import('@/lib/server/integrations/destination')
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ id: 'target', guild_id: 'another-guild', type: 0 })
    )
    await expect(
      validateIntegrationDestination(integration.id, { channelId: 'target' })
    ).rejects.toThrow('connected account')
    vi.mocked(fetch).mockImplementation(async (_input, init) =>
      Response.json(
        init?.method === 'POST'
          ? { id: 'sent' }
          : { id: 'target', guild_id: 'connected-guild', type: 0 }
      )
    )
    await expect(
      validateIntegrationDestination(integration.id, { channelId: 'target' })
    ).resolves.toBeUndefined()
    const op = (await queueHookSync({
      hookType: 'discord',
      event,
      target: { channelId: 'target' },
      config: { integrationId: integration.id },
    }))!
    await runIntegrationSync(syncTestJob(op.id))
    expect(
      await testDb.query.integrationSyncOperations.findFirst({ where: eq(operations.id, op.id) })
    ).toMatchObject({ state: 'succeeded', result: { externalId: 'sent' } })
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(
      1
    )
  })
  it('Discord safely retries a failed ownership lookup without dispatching a message', async () => {
    const { event, integration } = await seed('discord')
    await testDb
      .update(integrations)
      .set({ config: { channelId: 'target', guildId: 'connected-guild' } })
      .where(eq(integrations.id, integration.id))
    vi.mocked(fetch).mockResolvedValue(new Response('Unavailable', { status: 503 }))
    const op = (await queueHookSync({
      hookType: 'discord',
      event,
      target: { channelId: 'target' },
      config: { integrationId: integration.id },
    }))!
    await expect(runIntegrationSync(syncTestJob(op.id))).rejects.toThrow('waiting for a retry')
    expect(
      await testDb.query.integrationSyncOperations.findFirst({ where: eq(operations.id, op.id) })
    ).toMatchObject({ state: 'retry_wait', dispatchedAt: null, payload: expect.any(String) })
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(
      0
    )
  })
  it('HubSpot context refreshes an expired token through the shared resolver', async () => {
    const { integration, person } = await seed('hubspot')
    await platformCredentials('hubspot')
    await testDb
      .update(integrations)
      .set({
        secrets: encryptSecrets({ accessToken: 'expired', refreshToken: 'refresh' }),
        config: { tokenExpiresAt: '2000-01-01T00:00:00.000Z' },
      })
      .where(eq(integrations.id, integration.id))
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/oauth/v1/token'))
        return Response.json({ access_token: 'fresh', refresh_token: 'rotated', expires_in: 3600 })
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fresh')
      if (url.endsWith('/contacts/search'))
        return Response.json({
          results: [{ id: '123', properties: { email: person.email, firstname: 'Customer' } }],
        })
      return Response.json({ results: [] })
    })
    const { fetchCustomerContext } = await import('@/lib/server/integrations/context')
    expect(await fetchCustomerContext(person.email!)).toEqual([
      expect.objectContaining({ provider: 'hubspot', name: 'Customer' }),
    ])
    expect(fetch).toHaveBeenCalledTimes(3)
    const saved = await testDb.query.integrations.findFirst({
      where: eq(integrations.id, integration.id),
    })
    expect(decryptSecrets(saved!.secrets!)).toMatchObject({
      accessToken: 'fresh',
      refreshToken: 'rotated',
    })
  })
  it('Salesforce refreshes a rejected read once and uses the refreshed instance', async () => {
    const { integration, person } = await seed('salesforce')
    await platformCredentials('salesforce')
    await testDb
      .update(integrations)
      .set({
        secrets: encryptSecrets({ accessToken: 'expired', refreshToken: 'refresh' }),
        config: { instanceUrl: 'https://old.my.salesforce.com' },
      })
      .where(eq(integrations.id, integration.id))
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/services/oauth2/token')) {
        expect(String(init?.body)).toContain('grant_type=refresh_token')
        return Response.json({
          access_token: 'fresh',
          instance_url: 'https://new.my.salesforce.com',
        })
      }
      if (new Headers(init?.headers).get('Authorization') === 'Bearer expired')
        return new Response('', { status: 401 })
      expect(url).toContain('https://new.my.salesforce.com/')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fresh')
      return Response.json({ records: [{ Id: '123', Name: 'Customer' }] })
    })
    const { fetchCustomerContext } = await import('@/lib/server/integrations/context')
    expect(await fetchCustomerContext(person.email!)).toEqual([
      expect.objectContaining({
        provider: 'salesforce',
        url: 'https://new.my.salesforce.com/lightning/r/Contact/123/view',
      }),
    ])
    expect(fetch).toHaveBeenCalledTimes(3)
    const saved = await testDb.query.integrations.findFirst({
      where: eq(integrations.id, integration.id),
    })
    expect(decryptSecrets(saved!.secrets!)).toMatchObject({
      accessToken: 'fresh',
      refreshToken: 'refresh',
    })
  })
  it('a new provider creates, links, displays and reviews through shared capabilities', async () => {
    const { integration, event, post, actor } = await seed('template')
    await testDb
      .update(integrations)
      .set({ config: { channelId: 'target', accountKey: 'account-A', statusSyncEnabled: true } })
      .where(eq(integrations.id, integration.id))
    const op = (await queueHookSync({
      hookType: 'template',
      event,
      target: { channelId: 'target' },
      config: { integrationId: integration.id },
    }))!
    await testDb.update(posts).set({ title: 'Current title' }).where(eq(posts.id, post.id))
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      expect(String(input)).toBe('https://api.example.invalid/items')
      expect(JSON.parse(String(init?.body))).toMatchObject({
        title: 'Current title',
        destination: 'target',
      })
      return Response.json({ id: 'EX-1', url: 'https://example.invalid/items/EX-1' })
    })
    await runIntegrationSync(syncTestJob(op.id))
    await runIntegrationSync(syncTestJob(op.id))
    expect(fetch).toHaveBeenCalledTimes(1)
    const links = await testDb.query.postExternalLinks.findMany({
      where: eq(postExternalLinks.integrationId, integration.id),
    })
    expect(links).toHaveLength(1)
    expect(links[0].externalId).toBe('EX-1')
    const permissions: Actor = {
      principalId: actor.id,
      role: 'admin' as const,
      principalType: 'user' as const,
      permissions: new Set(Object.values(PERMISSIONS)),
      segmentIds: new Set(),
    }
    const detail = await inspectSyncOperation(op.id, permissions)
    expect(detail.item).toMatchObject({
      state: 'succeeded',
      destinationLabel: 'target',
      remoteUrl: 'https://example.invalid/items/EX-1',
    })
    const current = (await testDb.query.integrations.findFirst({
      where: eq(integrations.id, integration.id),
    }))!
    const receipt = (await queueInboundStatus(
      current,
      {
        externalId: 'EX-1',
        externalStatus: 'Done',
        eventType: 'item.updated',
        destinationId: 'target',
      },
      randomUUID()
    ))!
    await runIntegrationSync(syncTestJob(receipt.id))
    const review = (
      await testDb.query.integrationSyncOperations.findMany({
        where: eq(operations.integrationId, integration.id),
      })
    ).find((row) => row.kind === 'status')!
    expect((await inspectSyncOperation(review.id, permissions)).preview).toEqual({
      title: 'Platform status',
      content: 'Done',
    })
    await testDb.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, post.id))
    await expect(inspectSyncOperation(review.id, permissions)).rejects.toThrow('unavailable')
  })
  it('a new provider retries a confirmed rejection without replaying other destinations', async () => {
    const { integration, event, actor } = await seed('template')
    vi.mocked(fetch).mockImplementation(async () => new Response('', { status: 400 }))
    const op = (await queueHookSync({
      hookType: 'template',
      event,
      target: { channelId: 'target' },
      config: { integrationId: integration.id },
    }))!
    await runIntegrationSync(syncTestJob(op.id))
    const failed = (await testDb.query.integrationSyncOperations.findFirst({
      where: eq(operations.id, op.id),
    }))!
    expect(failed.state).toBe('failed')
    const { actOnSync } = await import('@/lib/server/integrations/sync/history')
    await actOnSync(
      { id: op.id, version: failed.version, actionId: randomUUID(), action: 'retry' },
      {
        principalId: actor.id,
        role: 'admin',
        principalType: 'user',
        permissions: new Set(Object.values(PERMISSIONS)),
        segmentIds: new Set(),
      }
    )
    vi.mocked(fetch).mockImplementation(async () =>
      Response.json({ id: 'EX-2', url: 'https://example.invalid/items/EX-2' })
    )
    await runIntegrationSync(syncTestJob(op.id))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(
      await testDb.query.integrationSyncOperations.findMany({
        where: eq(operations.integrationId, integration.id),
      })
    ).toMatchObject([{ id: op.id, state: 'succeeded' }])
  })

  it('a provider-defined account scope fences a queued operation before dispatch', async () => {
    const { integration, event } = await seed('template')
    const config = { channelId: 'target', accountKey: 'account-A' }
    await testDb.update(integrations).set({ config }).where(eq(integrations.id, integration.id))
    const op = (await queueHookSync({
      hookType: 'template',
      event,
      target: { channelId: 'target' },
      config: { integrationId: integration.id },
    }))!
    await testDb
      .update(integrations)
      .set({ config: { ...config, accountKey: 'account-B' } })
      .where(eq(integrations.id, integration.id))
    await runIntegrationSync(syncTestJob(op.id))
    expect(fetch).not.toHaveBeenCalled()
    expect(
      await testDb.query.integrationSyncOperations.findFirst({ where: eq(operations.id, op.id) })
    ).toMatchObject({ state: 'cancelled', dispatchedAt: null })
  })

  it('an inbound event without verified destination only offers a review of the current link', async () => {
    const { integration, event, post, actor } = await seed('template')
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ id: 'EX-3', url: 'https://example.invalid/items/EX-3' })
    )
    const op = (await queueHookSync({
      hookType: 'template',
      event,
      target: { channelId: 'target' },
      config: { integrationId: integration.id },
    }))!
    await runIntegrationSync(syncTestJob(op.id))
    const receipt = (await queueInboundStatus(
      integration,
      { externalId: 'EX-3', externalStatus: 'Done', eventType: 'item.updated' },
      randomUUID()
    ))!
    await runIntegrationSync(syncTestJob(receipt.id))
    const review = (
      await testDb.query.integrationSyncOperations.findMany({
        where: eq(operations.integrationId, integration.id),
      })
    ).find((row) => row.kind === 'status')!
    const detail = await inspectSyncOperation(review.id, {
      principalId: actor.id,
      role: 'admin',
      principalType: 'user',
      permissions: new Set(Object.values(PERMISSIONS)),
      segmentIds: new Set(),
    })
    expect(detail.item).toMatchObject({
      state: 'conflict',
      sourceId: post.id,
      remoteDisplayId: 'EX-3',
    })
    expect(detail.preview).toEqual({ title: 'Platform status', content: 'Done' })
    expect(await testDb.query.posts.findFirst({ where: eq(posts.id, post.id) })).toMatchObject({
      statusId: post.statusId,
    })
    expect(fetch).toHaveBeenCalledTimes(1)

    const unlinked = (await queueInboundStatus(
      integration,
      { externalId: 'unlinked', externalStatus: 'Done', eventType: 'item.updated' },
      randomUUID()
    ))!
    await runIntegrationSync(syncTestJob(unlinked.id))
    expect(
      (
        await testDb.query.integrationSyncOperations.findMany({
          where: eq(operations.integrationId, integration.id),
        })
      ).filter((row) => row.kind === 'status')
    ).toHaveLength(1)
  })

  it('history rejects a secret-bearing destination label even when a provider returns one', async () => {
    const { integration, event, actor } = await seed('template')
    const { templateIntegration } = await import('@/integrations/_template/server')
    vi.spyOn(templateIntegration.destination!, 'label').mockReturnValue(
      'https://example.test/private-secret'
    )
    const op = (await queueHookSync({
      hookType: 'template',
      event,
      target: { channelId: 'target' },
      config: { integrationId: integration.id },
    }))!
    const detail = await inspectSyncOperation(op.id, {
      principalId: actor.id,
      role: 'admin',
      principalType: 'user',
      permissions: new Set(Object.values(PERMISSIONS)),
      segmentIds: new Set(),
    })
    expect(detail.item.destinationLabel).toBeNull()
  })
  it('remote inspection rejects a reconnect between scope validation and credential resolution', async () => {
    const { integration, event } = await seed('github')
    const op = (await queueHookSync({
      hookType: 'github',
      event,
      target: { channelId: 'org/repo' },
      config: { integrationId: integration.id },
    }))!
    const stored = (await testDb.query.integrationSyncOperations.findFirst({
      where: eq(operations.id, op.id),
    }))!
    const auth = await import('@/lib/server/integrations/token-refresh')
    const original = auth.getIntegrationAuth
    vi.spyOn(auth, 'getIntegrationAuth').mockImplementationOnce(async (id) => {
      await testDb
        .update(integrations)
        .set({
          connectedAt: new Date(),
          secrets: encryptSecrets({ accessToken: 'new-account-token' }),
        })
        .where(eq(integrations.id, id))
      return original(id)
    })
    const { inspectSyncRemote } = await import('@/lib/server/integrations/sync/remote')
    await expect(inspectSyncRemote(stored, '42')).rejects.toThrow('connection changed')
    expect(fetch).not.toHaveBeenCalled()
  })
})
