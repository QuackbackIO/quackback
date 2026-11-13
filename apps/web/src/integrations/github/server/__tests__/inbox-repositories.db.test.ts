/**
 * Bringing GitHub issues into the inbox per repository, against a real
 * database with GitHub's API stubbed: a repository's hook subscribes to
 * comments only while it brings its issues into a live inbox, toggling one
 * repository resubscribes only its hook, turning the channel on opts the
 * default repository in when none is, and the first repository added to a
 * live inbox brings its issues in while later ones start off.
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
import type { TeamId, UserId } from '@quackback/ids'
import {
  integrations,
  integrationDestinations,
  channelAccounts,
  teams,
  user,
  eq,
} from '@/lib/server/db'
import { encryptSecrets } from '@/lib/server/integrations/encryption'
import * as registration from '@/lib/server/integrations/webhook-registration'
import { addIntegrationDestinationFn } from '@/lib/server/functions/integration-destinations'
import { setGitHubInboxEnabledFn, setGitHubRepositoryInboxFn } from '../functions'

type IntegrationRow = typeof integrations.$inferSelect

const ADMIN_USER_ID = 'user_01h455vb4pex5vsknk084sn02q' as UserId

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: integrationDestinations.id }).from(integrationDestinations).limit(0)
  },
})

describe.skipIf(!fixture.available)('GitHub inbox per repository', () => {
  let calls: { call: string; body: unknown }[]

  /** Answer GitHub API calls by `METHOD /path`; anything unexpected fails the test. */
  function github(routes: Record<string, () => Response>) {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const call = `${init?.method ?? 'GET'} ${String(input).replace('https://api.github.com', '')}`
      calls.push({ call, body: init?.body ? JSON.parse(String(init.body)) : null })
      const route = routes[call]
      if (!route) throw new Error(`unexpected GitHub call: ${call}`)
      return route()
    })
  }

  beforeEach(async () => {
    await fixture.begin()
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

  async function seedGitHub(config: Record<string, unknown> = { channelId: 'acme/app' }) {
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

  async function seedRepo(
    integration: IntegrationRow,
    externalId: string,
    values: Partial<typeof integrationDestinations.$inferInsert> = {}
  ) {
    const [row] = await testDb
      .insert(integrationDestinations)
      .values({ integrationId: integration.id, kind: 'repo', externalId, ...values })
      .returning()
    return row
  }

  /** The default team the channel connection belongs to, optionally with the connection live. */
  async function seedTeam(live: boolean) {
    const [team] = await testDb
      .insert(teams)
      .values({ name: 'Support', isDefault: true })
      .returning()
    if (live)
      await testDb.insert(channelAccounts).values({
        owningTeamId: team.id as TeamId,
        channel: 'github',
        role: 'connection',
        config: {},
      })
  }

  const reread = async (id: string) =>
    (await testDb.query.integrationDestinations.findFirst({
      where: eq(integrationDestinations.id, id as never),
    }))!

  const hookPatch = () => () => new Response('')

  it('resubscribes only the toggled repository, adding comments to its hook', async () => {
    const integration = await seedGitHub()
    await seedTeam(true)
    const app = await seedRepo(integration, 'acme/app', { externalWebhookId: '1' })
    const api = await seedRepo(integration, 'acme/api', { externalWebhookId: '2' })
    github({ 'PATCH /repos/acme/api/hooks/2': hookPatch() })

    await setGitHubRepositoryInboxFn({ data: { destinationId: api.id, enabled: true } })

    expect(calls.map((c) => c.call)).toEqual(['PATCH /repos/acme/api/hooks/2'])
    expect((calls[0].body as { events: string[] }).events).toEqual(['issues', 'issue_comment'])
    const after = await reread(api.id)
    expect(after.config).toEqual({ inboundMode: 'conversations' })
    expect(after.webhookEvents).toEqual(['issues', 'issue_comment'])
    expect((await reread(app.id)).config).toEqual({})

    calls = []
    github({ 'PATCH /repos/acme/api/hooks/2': hookPatch() })
    await setGitHubRepositoryInboxFn({ data: { destinationId: api.id, enabled: false } })
    expect((calls[0].body as { events: string[] }).events).toEqual(['issues'])
    expect((await reread(api.id)).webhookEvents).toEqual(['issues'])
  })

  it('registers a hook for a repository that newly brings its issues in', async () => {
    const integration = await seedGitHub()
    await seedTeam(true)
    const api = await seedRepo(integration, 'acme/api')
    github({ 'POST /repos/acme/api/hooks': () => Response.json({ id: 9 }, { status: 201 }) })

    await setGitHubRepositoryInboxFn({ data: { destinationId: api.id, enabled: true } })

    expect((calls[0].body as { events: string[] }).events).toEqual(['issues', 'issue_comment'])
    expect(await reread(api.id)).toMatchObject({
      externalWebhookId: '9',
      webhookEvents: ['issues', 'issue_comment'],
    })
  })

  it('opts the default repository in when the channel turns on with none opted in', async () => {
    const integration = await seedGitHub()
    await seedTeam(false)
    const app = await seedRepo(integration, 'acme/app', { externalWebhookId: '1' })
    const api = await seedRepo(integration, 'acme/api', { externalWebhookId: '2' })
    github({
      'PATCH /repos/acme/app/hooks/1': hookPatch(),
      'PATCH /repos/acme/api/hooks/2': hookPatch(),
    })

    await setGitHubInboxEnabledFn({ data: { enabled: true } })

    expect((await reread(app.id)).config).toEqual({ inboundMode: 'conversations' })
    expect((await reread(api.id)).config).toEqual({})
    const events = Object.fromEntries(
      calls.map((c) => [c.call, (c.body as { events: string[] }).events])
    )
    expect(events).toEqual({
      'PATCH /repos/acme/app/hooks/1': ['issues', 'issue_comment'],
      'PATCH /repos/acme/api/hooks/2': ['issues'],
    })
  })

  it('keeps an existing choice when the channel turns on', async () => {
    const integration = await seedGitHub()
    await seedTeam(false)
    const app = await seedRepo(integration, 'acme/app')
    const api = await seedRepo(integration, 'acme/api', {
      config: { inboundMode: 'conversations' },
    })
    github({ 'POST /repos/acme/api/hooks': () => Response.json({ id: 3 }, { status: 201 }) })

    await setGitHubInboxEnabledFn({ data: { enabled: true } })

    expect((await reread(app.id)).config).toEqual({})
    expect((await reread(api.id)).config).toEqual({ inboundMode: 'conversations' })
    // Nothing listens to the default repository, so it gets no hook.
    expect(calls.map((c) => c.call)).toEqual(['POST /repos/acme/api/hooks'])
  })

  it('brings the first repository added to a live inbox in, and later ones not', async () => {
    await seedGitHub({})
    await seedTeam(true)
    github({
      'GET /user/repos?sort=updated&per_page=100': () =>
        Response.json([
          { id: 1, full_name: 'acme/app', private: false },
          { id: 2, full_name: 'acme/api', private: false },
        ]),
      'POST /repos/acme/app/hooks': () => Response.json({ id: 7 }, { status: 201 }),
    })

    const first = await addIntegrationDestinationFn({
      data: { integrationType: 'github', kind: 'repo', externalId: 'acme/app' },
    })
    const second = await addIntegrationDestinationFn({
      data: { integrationType: 'github', kind: 'repo', externalId: 'acme/api' },
    })

    expect(await reread(first.id)).toMatchObject({
      config: { inboundMode: 'conversations' },
      externalWebhookId: '7',
      webhookEvents: ['issues', 'issue_comment'],
    })
    // Off, and with status sync off nothing listens to its hook.
    expect(await reread(second.id)).toMatchObject({
      config: { inboundMode: 'off' },
      externalWebhookId: null,
    })
    expect(calls.filter((c) => c.call.startsWith('POST')).map((c) => c.call)).toEqual([
      'POST /repos/acme/app/hooks',
    ])
  })

  it('refuses a repository of another provider', async () => {
    const [linear] = await testDb
      .insert(integrations)
      .values({ integrationType: 'linear', status: 'active', config: {} })
      .returning()
    const team = await seedRepo(linear as IntegrationRow, 'team-1', { kind: 'team' })
    await expect(
      setGitHubRepositoryInboxFn({ data: { destinationId: team.id, enabled: true } })
    ).rejects.toThrow('Repository not found')
  })
})
