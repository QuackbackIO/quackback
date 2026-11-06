import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type IntegrationId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/secret-key', () => ({
  activeSecretKey: () => 'jira-webhook-refresh-test-key-32-characters',
}))
vi.mock('@/lib/server/integrations/webhook-registration', async (original) => ({
  ...(await original<typeof import('@/lib/server/integrations/webhook-registration')>()),
  buildWebhookCallbackUrl: (provider: string) =>
    `https://tenant.example/api/integrations/${provider}/webhook`,
}))
import { integrations, eq, sql } from '@/lib/server/db'
import { encryptSecrets } from '../encryption'
import {
  isJiraWebhookRefreshDue,
  jiraWebhookRefreshDueAt,
  refreshDueJiraWebhooks,
  runJiraWebhookRefresh,
  type JiraStatusSyncRow,
} from '../jira-webhook-refresh-queue'

const DAY_MS = 86_400_000
const ERROR_PREFIX = 'Webhook refresh failed: '

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('jiraWebhookRefreshDueAt', () => {
  const now = Date.now()

  it('is null while status sync is off, so the webhook is not watched at all', () => {
    expect(
      jiraWebhookRefreshDueAt({
        statusSyncEnabled: false,
        externalWebhookId: '42',
        externalWebhookExpiresAt: new Date(now + 5 * DAY_MS).toISOString(),
      })
    ).toBeNull()
  })

  it('falls due ten days before Jira expires the webhook', () => {
    const expiresAt = now + 25 * DAY_MS
    const due = jiraWebhookRefreshDueAt({
      statusSyncEnabled: true,
      externalWebhookId: '42',
      externalWebhookExpiresAt: new Date(expiresAt).toISOString(),
    })
    expect(due?.getTime()).toBe(expiresAt - 10 * DAY_MS)
  })

  it('is due immediately when the expiry has never been read back from Jira', () => {
    const due = jiraWebhookRefreshDueAt({ statusSyncEnabled: true, externalWebhookId: '42' })
    expect(due?.getTime()).toBe(0)
  })

  it('is due immediately when there is no webhook id to refresh', () => {
    const due = jiraWebhookRefreshDueAt({ statusSyncEnabled: true })
    expect(due?.getTime()).toBe(0)
  })

  it('holds a failing webhook back until its retry time, even when its expiry is near', () => {
    const retryAt = now + 60 * 60_000
    const due = jiraWebhookRefreshDueAt({
      statusSyncEnabled: true,
      externalWebhookId: '42',
      externalWebhookExpiresAt: new Date(now + 2 * DAY_MS).toISOString(),
      externalWebhookRetryAt: new Date(retryAt).toISOString(),
    })
    expect(due?.getTime()).toBe(retryAt)
  })
})

const fixture = await createDbTestFixture()

describe.skipIf(!fixture.available)('Jira webhook refresh job', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.spyOn(globalThis, 'fetch')
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  /** Keys set to null or undefined are left out, as a config written without them would be. */
  async function seedJira(overrides: Record<string, unknown> = {}) {
    const config: Record<string, unknown> = {
      cloudId: 'cloud-1',
      channelId: '10000:10004',
      statusSyncEnabled: true,
      externalWebhookId: '42',
      ...overrides,
    }
    for (const key of Object.keys(config)) {
      if (config[key] === null || config[key] === undefined) delete config[key]
    }
    const [row] = await testDb
      .insert(integrations)
      .values({
        integrationType: 'jira',
        status: 'active',
        config,
        secrets: encryptSecrets({ accessToken: 'tok' }),
      })
      .returning()
    return row
  }

  async function storedConfig(id: IntegrationId): Promise<Record<string, unknown>> {
    const [row] = await testDb
      .select({ config: integrations.config })
      .from(integrations)
      .where(eq(integrations.id, id))
    return row.config as Record<string, unknown>
  }

  /**
   * Records every Jira call and answers the refresh, list and create endpoints with
   * the given bodies. Jira ignores an unknown id on refresh, so the list is what says
   * whether the webhook is still there; by default it lists webhook 42.
   */
  function stubJira(
    refresh: () => Response | Promise<Response> = () =>
      jsonResponse({ expirationDate: Date.now() + 30 * DAY_MS, invalidWebhooks: [] }),
    create: () => Response = () =>
      jsonResponse({ webhookRegistrationResult: [{ createdWebhookId: 99 }] }),
    list: () => Response = () => jsonResponse({ values: [{ id: 42 }], isLast: true })
  ) {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      calls.push({ url, init: init ?? {} })
      if (url.endsWith('/rest/api/3/webhook/refresh')) return refresh()
      if (url.includes('/rest/api/3/webhook?')) return list()
      if (url.endsWith('/rest/api/3/webhook')) return create()
      throw new Error(`unexpected Jira call: ${url}`)
    })
    return calls
  }

  it('extends a webhook that is inside the window and stores the expiry Jira returns', async () => {
    const row = await seedJira({
      externalWebhookExpiresAt: new Date(Date.now() + 2 * DAY_MS).toISOString(),
      externalWebhookRetryAt: new Date(Date.now() - DAY_MS).toISOString(),
    })
    const expiresAt = Date.now() + 30 * DAY_MS
    const calls = stubJira(() => jsonResponse({ expirationDate: expiresAt, invalidWebhooks: [] }))

    await runJiraWebhookRefresh()

    expect(calls).toHaveLength(2)
    expect(calls[0].url).toBe(
      'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/webhook/refresh'
    )
    expect(calls[0].init.method).toBe('PUT')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ webhookIds: [42] })
    expect(calls[1].url).toContain('/rest/api/3/webhook?')
    const config = await storedConfig(row.id)
    expect(config.externalWebhookId).toBe('42')
    expect(config.externalWebhookExpiresAt).toBe(new Date(expiresAt).toISOString())
    expect(config).not.toHaveProperty('externalWebhookRetryAt')
  })

  it('leaves a webhook alone while its expiry is more than ten days away', async () => {
    await seedJira({ externalWebhookExpiresAt: new Date(Date.now() + 25 * DAY_MS).toISOString() })
    const calls = stubJira()

    await runJiraWebhookRefresh()

    expect(calls).toHaveLength(0)
    expect(await isJiraWebhookRefreshDue()).toBe(false)
  })

  it('opens the gate once a webhook is inside the ten-day window', async () => {
    const row = await seedJira({
      externalWebhookExpiresAt: new Date(Date.now() + 11 * DAY_MS).toISOString(),
    })
    expect(await isJiraWebhookRefreshDue()).toBe(false)

    await testDb
      .update(integrations)
      .set({
        config: {
          ...(await storedConfig(row.id)),
          externalWebhookExpiresAt: new Date(Date.now() + 9 * DAY_MS).toISOString(),
        },
      })
      .where(eq(integrations.id, row.id))

    expect(await isJiraWebhookRefreshDue()).toBe(true)
  })

  it('keeps the gate shut for a workspace with no Jira status sync', async () => {
    expect(await isJiraWebhookRefreshDue()).toBe(false)
    await seedJira({ statusSyncEnabled: false })
    expect(await isJiraWebhookRefreshDue()).toBe(false)
  })

  it('registers a replacement when Jira reports the webhook gone', async () => {
    const row = await seedJira({ externalWebhookExpiresAt: null })
    const calls = stubJira(() =>
      jsonResponse({ expirationDate: Date.now(), invalidWebhooks: [42] })
    )

    await runJiraWebhookRefresh()

    const create = calls.find((call) => call.url.endsWith('/rest/api/3/webhook'))
    expect(create).toBeDefined()
    expect(JSON.parse(String(create?.init.body)).webhooks[0].jqlFilter).toBe('project = 10000')
    const config = await storedConfig(row.id)
    expect(config.externalWebhookId).toBe('99')
    expect(new Date(String(config.externalWebhookExpiresAt)).getTime()).toBeGreaterThan(
      Date.now() + 29 * DAY_MS
    )
    expect(config.statusSyncEnabled).toBe(true)
  })

  it('records the refreshed expiry when Jira still lists the webhook', async () => {
    const row = await seedJira({ externalWebhookExpiresAt: null })
    const expiresAt = Date.now() + 30 * DAY_MS
    const calls = stubJira(
      () => jsonResponse({ expirationDate: expiresAt, invalidWebhooks: [] }),
      undefined,
      () => jsonResponse({ values: [{ id: 7 }, { id: 42 }], isLast: true })
    )

    await runJiraWebhookRefresh()

    expect(calls.some((call) => call.url.endsWith('/rest/api/3/webhook'))).toBe(false)
    const config = await storedConfig(row.id)
    expect(config.externalWebhookId).toBe('42')
    expect(config.externalWebhookExpiresAt).toBe(new Date(expiresAt).toISOString())
  })

  it('registers a replacement when Jira silently ignored the refresh and no longer lists the webhook', async () => {
    const row = await seedJira({ externalWebhookExpiresAt: null })
    // Jira answers 200 with no invalid ids for an id it does not know.
    const calls = stubJira(
      () => jsonResponse({ expirationDate: Date.now() + 30 * DAY_MS, invalidWebhooks: [] }),
      undefined,
      () => jsonResponse({ values: [{ id: 7 }], isLast: true })
    )

    await runJiraWebhookRefresh()

    expect(calls.some((call) => call.url.endsWith('/rest/api/3/webhook'))).toBe(true)
    const config = await storedConfig(row.id)
    expect(config.externalWebhookId).toBe('99')
    expect(config.statusSyncEnabled).toBe(true)
    expect(new Date(String(config.externalWebhookExpiresAt)).getTime()).toBeGreaterThan(
      Date.now() + 29 * DAY_MS
    )
  })

  it('records a retry and no expiry when the webhook list cannot be read', async () => {
    const row = await seedJira({ externalWebhookExpiresAt: null })
    const calls = stubJira(
      () => jsonResponse({ expirationDate: Date.now() + 30 * DAY_MS, invalidWebhooks: [] }),
      undefined,
      () => jsonResponse({ message: 'boom' }, 500)
    )

    await runJiraWebhookRefresh()

    expect(calls.some((call) => call.url.endsWith('/rest/api/3/webhook'))).toBe(false)
    const config = await storedConfig(row.id)
    expect(config.externalWebhookId).toBe('42')
    expect(config).not.toHaveProperty('externalWebhookExpiresAt')
    expect(new Date(String(config.externalWebhookRetryAt)).getTime()).toBeGreaterThan(
      Date.now() + 50 * 60_000
    )
    const [integration] = await testDb
      .select({ lastError: integrations.lastError })
      .from(integrations)
      .where(eq(integrations.id, row.id))
    expect(integration.lastError).toContain(`${ERROR_PREFIX}Jira API error 500`)
  })

  it('does not believe a reported expiry that is not in the future', async () => {
    const row = await seedJira({ externalWebhookExpiresAt: null })
    stubJira(() => jsonResponse({ expirationDate: 1000, invalidWebhooks: [] }))

    await runJiraWebhookRefresh()

    const config = await storedConfig(row.id)
    expect(new Date(String(config.externalWebhookExpiresAt)).getTime()).toBeGreaterThan(
      Date.now() + 29 * DAY_MS
    )
    expect(await isJiraWebhookRefreshDue()).toBe(false)
  })

  it('treats a 404 from the refresh endpoint as a missing webhook', async () => {
    const row = await seedJira({ externalWebhookExpiresAt: null })
    stubJira(() => jsonResponse({ errorMessages: [] }, 404))

    await runJiraWebhookRefresh()

    expect((await storedConfig(row.id)).externalWebhookId).toBe('99')
  })

  it('registers a webhook for an integration that has status sync on but no webhook id', async () => {
    const row = await seedJira({ externalWebhookId: undefined })
    const calls = stubJira()

    await runJiraWebhookRefresh()

    expect(calls.map((call) => call.url)).toEqual([
      'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/webhook',
    ])
    expect((await storedConfig(row.id)).externalWebhookId).toBe('99')
  })

  it('records a failure, backs off, and does not throw out of the job', async () => {
    const row = await seedJira({ externalWebhookExpiresAt: null })
    stubJira(() => jsonResponse({ message: 'boom' }, 500))

    await expect(runJiraWebhookRefresh()).resolves.toBeUndefined()

    const [integration] = await testDb
      .select({ lastError: integrations.lastError })
      .from(integrations)
      .where(eq(integrations.id, row.id))
    expect(integration.lastError).toContain(`${ERROR_PREFIX}Jira API error 500`)
    const retryAt = new Date(String((await storedConfig(row.id)).externalWebhookRetryAt)).getTime()
    expect(retryAt).toBeGreaterThan(Date.now() + 50 * 60_000)
    expect(await isJiraWebhookRefreshDue()).toBe(false)
  })

  it('clears its own earlier error after a successful refresh and keeps other errors', async () => {
    const row = await seedJira({ externalWebhookExpiresAt: null })
    await testDb
      .update(integrations)
      .set({ lastError: `${ERROR_PREFIX}old`, lastErrorAt: new Date() })
      .where(eq(integrations.id, row.id))
    stubJira()

    await runJiraWebhookRefresh()

    const [cleared] = await testDb
      .select({ lastError: integrations.lastError })
      .from(integrations)
      .where(eq(integrations.id, row.id))
    expect(cleared.lastError).toBeNull()

    await testDb
      .update(integrations)
      .set({ lastError: 'Failed to register webhook: other', lastErrorAt: new Date() })
      .where(eq(integrations.id, row.id))
    await testDb
      .update(integrations)
      .set({ config: { ...(await storedConfig(row.id)), externalWebhookExpiresAt: null } })
      .where(eq(integrations.id, row.id))

    await runJiraWebhookRefresh()

    const [kept] = await testDb
      .select({ lastError: integrations.lastError })
      .from(integrations)
      .where(eq(integrations.id, row.id))
    expect(kept.lastError).toBe('Failed to register webhook: other')
  })

  it('keeps an error another write records while the refresh is out on the network', async () => {
    const row = await seedJira({ externalWebhookExpiresAt: null })
    await testDb
      .update(integrations)
      .set({ lastError: `${ERROR_PREFIX}old`, lastErrorAt: new Date() })
      .where(eq(integrations.id, row.id))
    stubJira(async () => {
      await testDb
        .update(integrations)
        .set({ lastError: 'Failed to register webhook: newer', lastErrorAt: new Date() })
        .where(eq(integrations.id, row.id))
      return jsonResponse({ expirationDate: Date.now() + 30 * DAY_MS, invalidWebhooks: [] })
    })

    await runJiraWebhookRefresh()

    const [kept] = await testDb
      .select({ lastError: integrations.lastError })
      .from(integrations)
      .where(eq(integrations.id, row.id))
    expect(kept.lastError).toBe('Failed to register webhook: newer')
  })

  it('clears its own error even when the row it was read from showed none', async () => {
    const row = await seedJira({ externalWebhookExpiresAt: null })
    await testDb
      .update(integrations)
      .set({ lastError: `${ERROR_PREFIX}recorded since the read`, lastErrorAt: new Date() })
      .where(eq(integrations.id, row.id))
    const rows: JiraStatusSyncRow[] = [
      { id: row.id, config: row.config as Record<string, unknown>, connectedAt: row.connectedAt },
    ]

    stubJira()

    await refreshDueJiraWebhooks(rows, new Date())

    const [cleared] = await testDb
      .select({ lastError: integrations.lastError })
      .from(integrations)
      .where(eq(integrations.id, row.id))
    expect(cleared.lastError).toBeNull()
  })

  it('does not let one failing integration stop the others in the same pass', async () => {
    const failing = await seedJira({ externalWebhookExpiresAt: null })
    const healthyId = createId('integration') as IntegrationId
    const refreshed: string[] = []
    const rows: JiraStatusSyncRow[] = [
      { id: failing.id, config: failing.config as Record<string, unknown>, connectedAt: null },
      {
        id: healthyId,
        config: { statusSyncEnabled: true, externalWebhookId: '7' },
        connectedAt: null,
      },
    ]

    const summary = await refreshDueJiraWebhooks(rows, new Date(), async (row) => {
      if (row.id === failing.id) throw new Error('token revoked')
      refreshed.push(String(row.config.externalWebhookId))
      return 'refreshed'
    })

    expect(refreshed).toEqual(['7'])
    expect(summary).toEqual({ due: 2, refreshed: 1, reregistered: 0, superseded: 0, failed: 1 })
    expect((await storedConfig(failing.id)).externalWebhookRetryAt).toBeDefined()
  })

  it('deletes the replacement it created when saving it fails, and records a retry', async () => {
    const row = await seedJira({ externalWebhookExpiresAt: null })
    const calls = stubJira(() =>
      jsonResponse({ expirationDate: Date.now(), invalidWebhooks: [42] })
    )
    // Saving the replacement fails the way a dropped connection would; the trigger lives
    // inside the test transaction and is rolled back with it.
    await testDb.execute(sql`
      CREATE FUNCTION pg_temp.reject_replacement() RETURNS trigger AS $$
      BEGIN
        IF NEW.config->>'externalWebhookId' = '99' THEN RAISE EXCEPTION 'connection reset'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`)
    await testDb.execute(sql`
      CREATE TRIGGER reject_replacement BEFORE UPDATE ON integrations
      FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_replacement()`)

    await runJiraWebhookRefresh()

    const remove = calls.find(
      (call) => call.url.endsWith('/rest/api/3/webhook') && call.init.method === 'DELETE'
    )
    expect(JSON.parse(String(remove?.init.body))).toEqual({ webhookIds: [99] })
    const config = await storedConfig(row.id)
    expect(config.externalWebhookId).toBe('42')
    expect(config).toHaveProperty('externalWebhookRetryAt')
  })

  it('stores the new expiry and clears its old error together, or neither', async () => {
    const row = await seedJira({ externalWebhookExpiresAt: null })
    await testDb
      .update(integrations)
      .set({ lastError: `${ERROR_PREFIX}old`, lastErrorAt: new Date() })
      .where(eq(integrations.id, row.id))
    stubJira()
    // Clearing the error fails the way a dropped connection would; the trigger lives
    // inside the test transaction and is rolled back with it.
    await testDb.execute(sql`
      CREATE FUNCTION pg_temp.reject_clear() RETURNS trigger AS $$
      BEGIN
        IF OLD.last_error IS NOT NULL AND NEW.last_error IS NULL THEN
          RAISE EXCEPTION 'connection reset';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`)
    await testDb.execute(sql`
      CREATE TRIGGER reject_clear BEFORE UPDATE ON integrations
      FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_clear()`)

    await runJiraWebhookRefresh()

    const config = await storedConfig(row.id)
    expect(config).not.toHaveProperty('externalWebhookExpiresAt')
    expect(config).toHaveProperty('externalWebhookRetryAt')
  })

  it('does not store a refreshed expiry when the integration moved to another Jira site', async () => {
    const row = await seedJira({ externalWebhookExpiresAt: null })
    stubJira(async () => {
      await testDb
        .update(integrations)
        .set({ config: { ...(await storedConfig(row.id)), cloudId: 'cloud-2' } })
        .where(eq(integrations.id, row.id))
      return jsonResponse({ expirationDate: Date.now() + 30 * DAY_MS, invalidWebhooks: [] })
    })

    await runJiraWebhookRefresh()

    const config = await storedConfig(row.id)
    expect(config.cloudId).toBe('cloud-2')
    expect(config).not.toHaveProperty('externalWebhookExpiresAt')
  })

  it('deletes a replacement registered on a Jira site the integration has since left', async () => {
    const row = await seedJira({ externalWebhookExpiresAt: null })
    const calls = stubJira(async () => {
      await testDb
        .update(integrations)
        .set({ config: { ...(await storedConfig(row.id)), cloudId: 'cloud-2' } })
        .where(eq(integrations.id, row.id))
      return jsonResponse({ expirationDate: Date.now(), invalidWebhooks: [42] })
    })

    await runJiraWebhookRefresh()

    const remove = calls.find(
      (call) => call.url.endsWith('/rest/api/3/webhook') && call.init.method === 'DELETE'
    )
    expect(remove?.url).toContain('/ex/jira/cloud-1/')
    const config = await storedConfig(row.id)
    expect(config.externalWebhookId).toBe('42')
    expect(config).not.toHaveProperty('externalWebhookExpiresAt')
  })

  it('does not apply work done with the old grant after a reconnect to the same site', async () => {
    const row = await seedJira({ externalWebhookExpiresAt: null })
    stubJira(async () => {
      await testDb
        .update(integrations)
        .set({ connectedAt: new Date(Date.now() + 1000) })
        .where(eq(integrations.id, row.id))
      return jsonResponse({ expirationDate: Date.now() + 30 * DAY_MS, invalidWebhooks: [] })
    })

    await runJiraWebhookRefresh()

    expect(await storedConfig(row.id)).not.toHaveProperty('externalWebhookExpiresAt')
  })

  it('deletes a replacement registered for a Jira project the integration has since left', async () => {
    const row = await seedJira({ externalWebhookExpiresAt: null })
    const calls = stubJira(async () => {
      await testDb
        .update(integrations)
        .set({ config: { ...(await storedConfig(row.id)), channelId: '20000:20004' } })
        .where(eq(integrations.id, row.id))
      return jsonResponse({ expirationDate: Date.now(), invalidWebhooks: [42] })
    })

    await runJiraWebhookRefresh()

    expect(
      calls.some(
        (call) => call.url.endsWith('/rest/api/3/webhook') && call.init.method === 'DELETE'
      )
    ).toBe(true)
    const config = await storedConfig(row.id)
    expect(config.externalWebhookId).toBe('42')
    expect(config).not.toHaveProperty('externalWebhookExpiresAt')
  })

  it('does not apply a webhook change when the webhook was replaced during the refresh', async () => {
    const row = await seedJira({ externalWebhookExpiresAt: null })
    stubJira(async () => {
      await testDb
        .update(integrations)
        .set({ config: { ...(await storedConfig(row.id)), externalWebhookId: '77' } })
        .where(eq(integrations.id, row.id))
      return jsonResponse({ expirationDate: Date.now() + 30 * DAY_MS, invalidWebhooks: [] })
    })

    await runJiraWebhookRefresh()

    const config = await storedConfig(row.id)
    expect(config.externalWebhookId).toBe('77')
    expect(config).not.toHaveProperty('externalWebhookExpiresAt')
  })
})
