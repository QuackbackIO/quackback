/**
 * Integration destinations against a real database: the legacy single-repo
 * repair (row created, plaintext secret moved in encrypted), the per-
 * destination config provider code sees, lookup by name and by immutable
 * key, the uniqueness the indexes enforce, and a verified delivery following
 * a repository rename.
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
vi.mock('@/lib/server/cache', () => ({
  cacheDel: vi.fn(async () => {}),
  CACHE_KEYS: { INTEGRATION_MAPPINGS: 'mappings' },
}))
import { integrations, integrationDestinations, eq } from '@/lib/server/db'
import { encryptSecrets } from '../encryption'
import {
  destinationConfig,
  destinationServes,
  ensureDestinations,
  findDestination,
  findInboundDestination,
  listDestinations,
  markDestinationInbound,
  readDestinationSecret,
} from '../destinations'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: integrationDestinations.id }).from(integrationDestinations).limit(0)
  },
})

describe.skipIf(!fixture.available)('integration destinations', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
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
    integrationId: (typeof integrations.$inferSelect)['id'],
    values: Partial<typeof integrationDestinations.$inferInsert> = {}
  ) {
    const [row] = await testDb
      .insert(integrationDestinations)
      .values({ integrationId, kind: 'repo', externalId: 'acme/app', ...values })
      .returning()
    return row
  }

  async function configOf(id: (typeof integrations.$inferSelect)['id']) {
    const row = await testDb.query.integrations.findFirst({ where: eq(integrations.id, id) })
    return row?.config as Record<string, unknown>
  }

  it('repairs a legacy connection: creates the repository row and moves the secret in, encrypted', async () => {
    const integration = await seedGitHub({
      channelId: 'acme/app',
      webhookSecret: 'legacy-secret',
      externalWebhookId: '41',
      statusSyncEnabled: true,
    })

    await ensureDestinations(integration)

    const [repo] = await listDestinations(integration.id, 'repo')
    expect(repo).toMatchObject({ externalId: 'acme/app', externalWebhookId: '41', enabled: true })
    expect(repo.secrets).not.toContain('legacy-secret')
    expect(readDestinationSecret(repo)).toBe('legacy-secret')
    // The default repository stays; the moved keys leave the connection config.
    expect(await configOf(integration.id)).toEqual({
      channelId: 'acme/app',
      statusSyncEnabled: true,
    })

    // A second repair finds nothing to do.
    await ensureDestinations({ ...integration, config: await configOf(integration.id) })
    expect(await listDestinations(integration.id)).toHaveLength(1)
  })

  it('moves the legacy secret onto the backfilled row the migration created', async () => {
    const integration = await seedGitHub({ channelId: 'Acme/App', webhookSecret: 'legacy' })
    await addRepo(integration.id, { externalWebhookId: '41' })

    await ensureDestinations(integration)

    const [repo] = await listDestinations(integration.id)
    expect(repo.externalId).toBe('acme/app')
    expect(readDestinationSecret(repo)).toBe('legacy')
  })

  it('leaves providers without per-destination webhooks alone', async () => {
    const [asana] = await testDb
      .insert(integrations)
      .values({ integrationType: 'asana', status: 'active', config: { channelId: 'p/1' } })
      .returning()
    await ensureDestinations(asana)
    expect(await listDestinations(asana.id)).toEqual([])
  })

  it('gives provider code the connection config scoped to one destination', () => {
    const config = destinationConfig(
      {
        config: {
          channelId: 'acme/default',
          organizationName: 'acme',
          webhookSecret: 'legacy',
          externalWebhookId: '41',
        },
      },
      { externalId: 'acme/other', config: { inboundMode: 'off' } }
    )
    expect(config).toEqual({
      channelId: 'acme/other',
      organizationName: 'acme',
      inboundMode: 'off',
    })
  })

  it('finds a repository by name in any case, and by key before name', async () => {
    const integration = await seedGitHub({ channelId: 'acme/app' })
    const repo = await addRepo(integration.id, { externalId: 'Acme/App', externalKey: '7' })

    expect((await findDestination(integration.id, 'repo', { externalId: 'acme/app' }))?.id).toBe(
      repo.id
    )
    expect((await findDestination(integration.id, 'repo', { externalKey: '7' }))?.id).toBe(repo.id)
    expect(await findDestination(integration.id, 'team', { externalId: 'acme/app' })).toBeNull()

    // Renamed on GitHub: the key still finds it.
    expect(
      (
        await findInboundDestination(integration.id, 'repo', {
          externalId: 'acme/new',
          externalKey: '7',
        })
      )?.id
    ).toBe(repo.id)
    // The old name now belongs to a different repository: not this destination.
    expect(
      await findInboundDestination(integration.id, 'repo', {
        externalId: 'acme/app',
        externalKey: '8',
      })
    ).toBeNull()
  })

  it('holds one row per repository name, case-insensitively, and per key', async () => {
    const integration = await seedGitHub({})
    await addRepo(integration.id, { externalId: 'acme/app', externalKey: '7' })

    await expect(
      testDb.transaction((tx) =>
        tx
          .insert(integrationDestinations)
          .values({ integrationId: integration.id, kind: 'repo', externalId: 'ACME/APP' })
      )
    ).rejects.toThrow()
    await expect(
      testDb.transaction((tx) =>
        tx.insert(integrationDestinations).values({
          integrationId: integration.id,
          kind: 'repo',
          externalId: 'acme/other',
          externalKey: '7',
        })
      )
    ).rejects.toThrow()
    // Many rows may still lack a key.
    await addRepo(integration.id, { externalId: 'acme/one' })
    await addRepo(integration.id, { externalId: 'acme/two' })
    expect(await listDestinations(integration.id)).toHaveLength(3)
  })

  it('stamps a verified delivery, learns the key and follows a rename', async () => {
    const integration = await seedGitHub({ channelId: 'acme/app', statusSyncEnabled: true })
    const repo = await addRepo(integration.id)

    await markDestinationInbound(integration, repo, {
      externalId: 'acme/renamed',
      externalKey: '7',
    })

    const [after] = await listDestinations(integration.id)
    expect(after).toMatchObject({ externalId: 'acme/renamed', externalKey: '7' })
    expect(after.lastInboundAt).toBeInstanceOf(Date)
    expect(await configOf(integration.id)).toEqual({
      channelId: 'acme/renamed',
      statusSyncEnabled: true,
    })
  })

  it('lets a conversation talk to its repository only while it is still synced and on', async () => {
    const legacy = await seedGitHub({ channelId: 'acme/app' })
    // No rows yet: the connection's one repository, as before.
    expect(await destinationServes(legacy, 'acme/app')).toBe(true)
    await addRepo(legacy.id, { externalId: 'acme/app' })
    const off = await addRepo(legacy.id, { externalId: 'acme/off', enabled: false })
    expect(await destinationServes(legacy, 'ACME/App')).toBe(true)
    expect(await destinationServes(legacy, off.externalId)).toBe(false)
    expect(await destinationServes(legacy, 'acme/removed')).toBe(false)
  })

  it('goes with the connection when it is deleted', async () => {
    const integration = await seedGitHub({ channelId: 'acme/app' })
    await addRepo(integration.id)
    await testDb.delete(integrations).where(eq(integrations.id, integration.id))
    expect(await listDestinations(integration.id)).toEqual([])
  })
})
