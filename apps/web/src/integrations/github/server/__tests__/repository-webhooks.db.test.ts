/**
 * Each GitHub repository's webhook through its lifecycle, against a real
 * database with GitHub's API stubbed: adding a repository registers its own
 * webhook (and audits it), removing one takes its webhook, links and mappings
 * with it and moves the default, the inbox's event sync and status sync act
 * per repository, and a disconnect removes every repository's webhook before
 * revoking the token.
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
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: vi.fn(async () => ({
    user: { id: 'user_01h455vb4pex5vsknk084sn02q', email: 'admin@example.test' },
    principal: { role: 'admin', type: 'user' },
  })),
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => new Headers() }))
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
import {
  integrations,
  integrationDestinations,
  integrationEventMappings,
  auditLog,
  posts,
  boards,
  postExternalLinks,
  user,
  eq,
} from '@/lib/server/db'
import { createId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { encryptSecrets } from '@/lib/server/integrations/encryption'
import { readDestinationSecret } from '@/lib/server/integrations/destinations'
import * as registration from '@/lib/server/integrations/webhook-registration'
import { syncGitHubWebhookEvents } from '@/lib/server/domains/channel-accounts/github-connection'
import { enableStatusSyncFn, disableStatusSyncFn } from '@/lib/server/functions/status-sync'
import { deleteIntegrationFn } from '@/lib/server/functions/integrations'
import {
  addIntegrationDestinationFn,
  removeIntegrationDestinationFn,
} from '@/lib/server/functions/integration-destinations'
import { getIntegration } from '@/lib/server/integrations'
import { syncScopeFor } from '@/lib/server/integrations/sync/identity'

type IntegrationRow = typeof integrations.$inferSelect

const ADMIN_USER_ID = 'user_01h455vb4pex5vsknk084sn02q' as UserId

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
    // The admin requireAuth answers with; audit rows reference their user.
    await testDb.insert(user).values({ id: ADMIN_USER_ID, name: 'Admin' })
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

  const audits = async (event: string) =>
    testDb.query.auditLog.findMany({ where: eq(auditLog.eventType, event) })

  it('adds a repository with its own webhook when something listens', async () => {
    const integration = await seedGitHub({ channelId: 'acme/old', statusSyncEnabled: true })
    await addRepo(integration, { externalWebhookId: '11' })
    github({
      'GET /user/repos?sort=updated&per_page=100': listed,
      'POST /repos/acme/new/hooks': () => Response.json({ id: 22 }, { status: 201 }),
    })

    const added = await addIntegrationDestinationFn({
      data: { integrationType: 'github', kind: 'repo', externalId: 'ACME/new' },
    })

    expect(calls).toEqual([
      'GET /user/repos?sort=updated&per_page=100',
      'POST /repos/acme/new/hooks',
    ])
    const repo = (await repos(integration)).find((r) => r.id === added.id)!
    expect(repo).toMatchObject({
      externalId: 'acme/new',
      externalKey: '2',
      externalWebhookId: '22',
      webhookEvents: ['issues'],
    })
    expect(readDestinationSecret(repo)).toMatch(/^[0-9a-f]{64}$/)
    // The default repository is unchanged.
    expect(await configOf(integration)).toMatchObject({ channelId: 'acme/old' })
    expect(await audits('integration.destination.added')).toMatchObject([
      { targetType: 'integration_destination', targetId: added.id, actorRole: 'admin' },
    ])
  })

  it('adds the first repository as the default, without a webhook when nothing listens', async () => {
    const integration = await seedGitHub({})
    github({ 'GET /user/repos?sort=updated&per_page=100': listed })

    await addIntegrationDestinationFn({
      data: { integrationType: 'github', kind: 'repo', externalId: 'acme/new' },
    })

    const [repo] = await repos(integration)
    expect(repo).toMatchObject({ externalId: 'acme/new', externalWebhookId: null })
    expect(await configOf(integration)).toEqual({ channelId: 'acme/new' })
  })

  it('refuses a repository the connection cannot see, or one already synced', async () => {
    const integration = await seedGitHub({ channelId: 'acme/old' })
    await addRepo(integration, {})
    github({ 'GET /user/repos?sort=updated&per_page=100': listed })

    await expect(
      addIntegrationDestinationFn({
        data: { integrationType: 'github', kind: 'repo', externalId: 'evil/repo' },
      })
    ).rejects.toThrow('Choose a repository')
    await expect(
      addIntegrationDestinationFn({
        data: { integrationType: 'github', kind: 'repo', externalId: 'Acme/Old' },
      })
    ).rejects.toThrow('acme/old is already synced')
    expect((await repos(integration)).map((r) => r.externalId)).toEqual(['acme/old'])
    expect(await audits('integration.destination.added')).toEqual([])
  })

  it('mirrors the feedback-to-issue mapping only when the connection has it on', async () => {
    const integration = await seedGitHub({ channelId: 'acme/old' })
    await addRepo(integration, {})
    github({ 'GET /user/repos?sort=updated&per_page=100': listed })
    const mappings = () =>
      testDb.query.integrationEventMappings.findMany({
        where: eq(integrationEventMappings.integrationId, integration.id),
      })

    await addIntegrationDestinationFn({
      data: { integrationType: 'github', kind: 'repo', externalId: 'acme/new' },
    })
    expect(await mappings()).toEqual([])

    await testDb
      .delete(integrationDestinations)
      .where(eq(integrationDestinations.externalId, 'acme/new'))
    await testDb.insert(integrationEventMappings).values({
      integrationId: integration.id,
      eventType: 'post.created',
      actionType: 'send_message',
      enabled: true,
    })
    const added = await addIntegrationDestinationFn({
      data: { integrationType: 'github', kind: 'repo', externalId: 'acme/new' },
    })
    expect(
      (await mappings()).map((m) => ({ targetKey: m.targetKey, actionConfig: m.actionConfig }))
    ).toEqual(
      expect.arrayContaining([
        { targetKey: 'default', actionConfig: {} },
        { targetKey: added.id, actionConfig: { channelId: 'acme/new' } },
      ])
    )
  })

  it('removes a repository: its webhook, links and mappings go, and the default moves', async () => {
    const integration = await seedGitHub({ channelId: 'acme/old', statusSyncEnabled: true })
    const old = await addRepo(integration, { externalWebhookId: '11' })
    const next = await addRepo(integration, { externalId: 'acme/next' })
    await testDb.insert(integrationEventMappings).values({
      integrationId: integration.id,
      eventType: 'post.created',
      actionType: 'send_message',
      targetKey: old.id,
      actionConfig: { channelId: 'acme/old' },
      enabled: true,
    })
    const principalId = createId('principal') as PrincipalId
    const { principal } = await import('@/lib/server/db')
    await testDb
      .insert(principal)
      .values({ id: principalId, role: 'user', type: 'user', createdAt: new Date() })
    const [board] = await testDb.insert(boards).values({ slug: 'b-remove', name: 'B' }).returning()
    const [post] = await testDb
      .insert(posts)
      .values({ boardId: board.id, title: 'P', content: 'c', principalId })
      .returning()
    const scope = (repository: string) =>
      syncScopeFor(integration, { channelId: repository }, getIntegration('github'))
    await testDb.insert(postExternalLinks).values([
      {
        postId: post.id as PostId,
        integrationId: integration.id,
        integrationType: 'github',
        externalId: '1',
        syncScope: scope('acme/old'),
      },
      {
        postId: post.id as PostId,
        integrationId: integration.id,
        integrationType: 'github',
        externalId: '2',
        syncScope: scope('acme/next'),
      },
    ])
    github({ 'DELETE /repos/acme/old/hooks/11': () => new Response(null, { status: 204 }) })

    expect(await removeIntegrationDestinationFn({ data: { destinationId: old.id } })).toEqual({
      unlinkedTickets: 0,
      unlinkedPosts: 1,
    })

    expect(calls).toEqual(['DELETE /repos/acme/old/hooks/11'])
    expect((await repos(integration)).map((r) => r.id)).toEqual([next.id])
    expect(await configOf(integration)).toMatchObject({ channelId: 'acme/next' })
    expect(
      (
        await testDb.query.postExternalLinks.findMany({
          where: eq(postExternalLinks.postId, post.id),
        })
      ).map((l) => l.externalId)
    ).toEqual(['2'])
    expect(
      await testDb.query.integrationEventMappings.findMany({
        where: eq(integrationEventMappings.integrationId, integration.id),
      })
    ).toEqual([])
    expect(await audits('integration.destination.removed')).toMatchObject([
      { targetId: old.id, beforeValue: { kind: 'repo', externalId: 'acme/old' } },
    ])
  })

  it('removes a repository even when GitHub refuses to drop its webhook', async () => {
    const integration = await seedGitHub({ channelId: 'acme/old' })
    const old = await addRepo(integration, { externalWebhookId: '11' })
    github({
      'DELETE /repos/acme/old/hooks/11': () => {
        throw new Error('network down')
      },
    })

    await removeIntegrationDestinationFn({ data: { destinationId: old.id } })

    expect(await repos(integration)).toEqual([])
    expect(await configOf(integration)).toEqual({})
    const saved = await testDb.query.integrations.findFirst({
      where: eq(integrations.id, integration.id),
    })
    expect(saved?.lastError).toContain('Could not remove the webhook from acme/old')
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
