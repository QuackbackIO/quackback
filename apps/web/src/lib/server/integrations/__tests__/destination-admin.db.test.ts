/**
 * Managing a connection's repositories against a real database: the on/off
 * switch and the direction setting (validated by the provider's schema),
 * which together decide what outbound work a repository takes, the
 * feedback-to-issue mapping mirrored to every non-default repository only
 * while the connection has it on, and the sync history narrowed to one
 * repository.
 */
import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/secret-key', () => ({
  activeSecretKey: () => 'integration-sync-review-key-32-characters-only',
}))
vi.mock('@/lib/server/cache', () => ({
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => {}),
  cacheDel: vi.fn(async () => {}),
  CACHE_KEYS: { INTEGRATION_MAPPINGS: 'mappings' },
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const builder = { validator: () => builder, handler: (handler: unknown) => handler }
    return builder
  },
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: vi.fn(async () => ({})) }))
import { createId, type PostId } from '@quackback/ids'
import {
  boards,
  posts,
  principal,
  integrations,
  integrationDestinations,
  integrationEventMappings,
  postExternalLinks,
  eq,
} from '@/lib/server/db'
import { setDestinationEnabled, updateDestinationConfig } from '../destination-admin'
import { outboundAllowed } from '../destinations'
import { updateIntegrationFn } from '@/lib/server/functions/integrations'
import { integrationResolver } from '@/lib/server/events/resolvers/integration.resolver'
import { executeCascadeDelete } from '@/lib/server/domains/posts/post.cascade-delete'
import { listSyncHistory } from '../sync/history'
import { syncScopeFor } from '../sync/identity'
import { getIntegration } from '../index'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import type { Actor } from '@/lib/server/policy/types'

type IntegrationRow = typeof integrations.$inferSelect

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: integrationDestinations.id }).from(integrationDestinations).limit(0)
  },
})

describe.skipIf(!fixture.available)('integration destination management', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  async function seedRepositories() {
    const [integration] = await testDb
      .insert(integrations)
      .values({ integrationType: 'github', status: 'active', config: { channelId: 'acme/app' } })
      .returning()
    const rows = await testDb
      .insert(integrationDestinations)
      .values(
        ['acme/app', 'acme/api', 'acme/docs'].map((externalId) => ({
          integrationId: integration.id,
          kind: 'repo',
          externalId,
        }))
      )
      .returning()
    return { integration, repo: Object.fromEntries(rows.map((r) => [r.externalId, r])) }
  }

  const mappings = (integration: IntegrationRow) =>
    testDb.query.integrationEventMappings.findMany({
      where: eq(integrationEventMappings.integrationId, integration.id),
    })

  it('switches a repository off and back on, and lets only a sending one take work', async () => {
    const { integration, repo } = await seedRepositories()

    await setDestinationEnabled(repo['acme/api'].id, false)
    expect(await outboundAllowed(integration, 'acme/api')).toBe(false)
    await setDestinationEnabled(repo['acme/api'].id, true)
    expect(await outboundAllowed(integration, 'ACME/API')).toBe(true)

    await updateDestinationConfig(repo['acme/api'].id, { direction: 'inbound' })
    expect(await outboundAllowed(integration, 'acme/api')).toBe(false)
    await updateDestinationConfig(repo['acme/api'].id, { direction: 'outbound' })
    expect(await outboundAllowed(integration, 'acme/api')).toBe(true)
    // A repository the connection does not sync takes nothing.
    expect(await outboundAllowed(integration, 'acme/unknown')).toBe(false)
  })

  it("refuses settings outside the provider's schema", async () => {
    const { repo } = await seedRepositories()
    await expect(
      updateDestinationConfig(repo['acme/api'].id, { direction: 'sideways' })
    ).rejects.toThrow('not valid')
    await expect(
      updateDestinationConfig(repo['acme/api'].id, { webhookSecret: 'x' })
    ).rejects.toThrow('not valid')
    const saved = await testDb.query.integrationDestinations.findFirst({
      where: eq(integrationDestinations.id, repo['acme/api'].id),
    })
    expect(saved?.config).toEqual({})
  })

  it('mirrors the feedback-to-issue switch to every non-default repository', async () => {
    const { integration, repo } = await seedRepositories()
    const toggle = (enabled: boolean) =>
      updateIntegrationFn({
        data: { id: integration.id, eventMappings: [{ eventType: 'post.created', enabled }] },
      })

    await toggle(true)
    const on = await mappings(integration)
    expect(on.map((m) => [m.targetKey, m.enabled, m.actionConfig]).sort()).toEqual(
      [
        ['default', true, {}],
        [repo['acme/api'].id, true, { channelId: 'acme/api' }],
        [repo['acme/docs'].id, true, { channelId: 'acme/docs' }],
      ].sort()
    )

    await toggle(false)
    expect((await mappings(integration)).map((m) => [m.targetKey, m.enabled])).toEqual([
      ['default', false],
    ])
  })

  it('routes new feedback to every sending repository and skips the rest', async () => {
    const { integration, repo } = await seedRepositories()
    await updateIntegrationFn({
      data: { id: integration.id, eventMappings: [{ eventType: 'post.created', enabled: true }] },
    })
    await setDestinationEnabled(repo['acme/api'].id, false)
    await updateDestinationConfig(repo['acme/docs'].id, { direction: 'inbound' })
    await testDb
      .insert(integrationDestinations)
      .values({ integrationId: integration.id, kind: 'repo', externalId: 'acme/web' })
    await updateIntegrationFn({
      data: { id: integration.id, eventMappings: [{ eventType: 'post.created', enabled: true }] },
    })

    const targets = await integrationResolver.resolve({
      eventId: createId('event'),
      seq: 0n,
      type: 'post.created',
      entityType: 'post',
      entityId: createId('post'),
      actorType: 'service',
      payload: { post: { id: createId('post'), boardId: createId('board') } },
      context: { depth: 0, source: 'test' },
      schemaVersion: 1,
      occurredAt: new Date(),
    })
    expect(
      targets
        .filter((t) => t.type === 'github')
        .map((t) => (t.target as { channelId: string }).channelId)
        .sort()
    ).toEqual(['acme/app', 'acme/web'])
  })

  it('narrows the sync history to one repository', async () => {
    const { integration } = await seedRepositories()
    const [actor] = await testDb
      .insert(principal)
      .values({ role: 'admin', type: 'service', createdAt: new Date() })
      .returning()
    const [board] = await testDb
      .insert(boards)
      .values({ name: 'History', slug: `history-${randomUUID()}` })
      .returning()
    const [post] = await testDb
      .insert(posts)
      .values({ principalId: actor.id, boardId: board.id, title: 'Feedback', content: 'Body' })
      .returning()
    const links = await testDb
      .insert(postExternalLinks)
      .values(
        ['acme/app', 'acme/api'].map((repository, index) => ({
          postId: post.id as PostId,
          integrationId: integration.id,
          integrationType: 'github',
          externalId: String(index + 1),
          externalDisplayId: `${repository}#${index + 1}`,
          syncScope: syncScopeFor(integration, { channelId: repository }, getIntegration('github')),
        }))
      )
      .returning()
    await testDb.transaction((tx) =>
      executeCascadeDelete(
        post.id as PostId,
        links.map((link) => ({ linkId: link.id, shouldArchive: true })),
        { executor: tx, requestedBy: actor.id }
      )
    )
    const admin: Actor = {
      principalId: actor.id,
      role: 'admin',
      principalType: 'service',
      segmentIds: new Set(),
      permissions: resolveActorPermissions('admin'),
    }
    const api = (await testDb.query.integrationDestinations.findFirst({
      where: eq(integrationDestinations.externalId, 'acme/api'),
    }))!

    const all = await listSyncHistory({ provider: 'github', filter: 'all' }, admin)
    expect(all.items).toHaveLength(2)
    const one = await listSyncHistory(
      { provider: 'github', filter: 'all', destinationId: api.id },
      admin
    )
    expect(one.items.map((item) => item.remoteDisplayId)).toEqual(['acme/api#2'])
  })
})
