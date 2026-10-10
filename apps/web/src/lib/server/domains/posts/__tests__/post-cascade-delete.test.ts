import { getIntegration } from '@/lib/server/integrations'
/** Selected archive intents and source deletion are one durable transaction. */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  posts,
  principal,
  integrations,
  postExternalLinks,
  integrationSyncOperations as operations,
  eq,
} from '@/lib/server/db'
import {
  installationIdentity,
  syncHash,
  syncDestination,
} from '@/lib/server/integrations/sync/identity'
import { executeCascadeDelete } from '../post.cascade-delete'
import { readSyncPayload } from '@/lib/server/integrations/sync/ledger'
import { listSyncHistory } from '@/lib/server/integrations/sync/history'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import type { Actor } from '@/lib/server/policy/types'
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/secret-key', () => ({
  activeSecretKey: () => 'integration-sync-test-key-32-characters-only',
}))
const fixture = await createDbTestFixture()
beforeEach(fixture.begin)
afterEach(async () => {
  vi.restoreAllMocks()
  await fixture.rollback()
})
afterAll(fixture.close)
async function seed() {
  const [actor] = await testDb
    .insert(principal)
    .values({ role: 'admin', type: 'service', createdAt: new Date() })
    .returning()
  const [board] = await testDb
    .insert(boards)
    .values({ name: 'Archive test', slug: `archive-${randomUUID()}` })
    .returning()
  const [post] = await testDb
    .insert(posts)
    .values({
      principalId: actor.id,
      boardId: board.id,
      title: 'Private source title',
      content: 'Private source body',
    })
    .returning()
  const [integration] = await testDb
    .insert(integrations)
    .values({ integrationType: 'github', status: 'active', config: { channelId: 'acme/widgets' } })
    .returning()
  const [link] = await testDb
    .insert(postExternalLinks)
    .values({
      postId: post.id,
      integrationId: integration.id,
      integrationType: 'github',
      externalId: '42',
      syncScope: `${installationIdentity(integration)}:${syncHash(syncDestination({ channelId: 'acme/widgets' }, integration.config, getIntegration(integration.integrationType)))}`,
      externalDisplayId: '#42',
      externalUrl: 'https://github.com/acme/widgets/issues/42',
    })
    .returning()
  return {
    post,
    integration,
    link,
    actor: {
      principalId: actor.id,
      role: 'admin',
      principalType: 'service',
      segmentIds: new Set(),
      permissions: resolveActorPermissions('admin'),
    } as Actor,
  }
}
describe('archive review (PostgreSQL)', () => {
  it('captures selected requests, preserves a usable review after soft deletion and sends no remote request', async () => {
    const { post, link, actor } = await seed()
    const network = vi.spyOn(globalThis, 'fetch')
    await testDb.transaction(async (tx) => {
      expect(
        await executeCascadeDelete(post.id, [{ linkId: link.id, shouldArchive: true }], {
          executor: tx,
          requestedBy: actor.principalId!,
        })
      ).toMatchObject([{ success: true, action: 'queued' }])
      await tx.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, post.id))
    })
    const op = (await testDb.query.integrationSyncOperations.findFirst({
      where: eq(operations.sourceId, post.id),
    }))!
    expect(op.state).toBe('conflict')
    expect(readSyncPayload(op).data).toEqual({
      linkId: link.id,
      proposedStatus: 'Archive or close this remote item',
    })
    expect(JSON.stringify(readSyncPayload(op))).not.toContain('Private source')
    const history = await listSyncHistory({ provider: 'github', filter: 'attention' }, actor)
    expect(history.items[0]).toMatchObject({
      sourceTitle: 'Deleted feedback',
      remoteUrl: link.externalUrl,
      remoteDisplayId: '#42',
    })
    expect(network).not.toHaveBeenCalled()
    network.mockRestore()
  })
  it('rolls back the source delete and every intent together', async () => {
    const { post, link, actor } = await seed()
    await expect(
      testDb.transaction(async (tx) => {
        await executeCascadeDelete(post.id, [{ linkId: link.id, shouldArchive: true }], {
          executor: tx,
          requestedBy: actor.principalId!,
        })
        await tx.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, post.id))
        throw new Error('Simulated transaction failure')
      })
    ).rejects.toThrow('Simulated transaction failure')
    expect(
      await testDb.select().from(operations).where(eq(operations.sourceId, post.id))
    ).toHaveLength(0)
    expect(
      (await testDb.query.posts.findFirst({ where: eq(posts.id, post.id) }))?.deletedAt
    ).toBeNull()
  })
  it('does not accept a link from a different post', async () => {
    const { link, actor, post } = await seed()
    const [other] = await testDb
      .insert(posts)
      .values({
        boardId: post.boardId,
        principalId: actor.principalId!,
        title: 'Other source',
        content: 'Other',
      })
      .returning()
    await expect(
      testDb.transaction((tx) =>
        executeCascadeDelete(other.id, [{ linkId: link.id, shouldArchive: true }], {
          executor: tx,
          requestedBy: actor.principalId!,
        })
      )
    ).rejects.toThrow('no longer available')
    expect(
      await testDb.select().from(operations).where(eq(operations.sourceId, post.id))
    ).toHaveLength(0)
  })
  it('ignores unselected links', async () => {
    const { post, link, actor } = await seed()
    expect(
      await testDb.transaction((tx) =>
        executeCascadeDelete(post.id, [{ linkId: link.id, shouldArchive: false }], {
          executor: tx,
          requestedBy: actor.principalId!,
        })
      )
    ).toEqual([])
    expect(
      await testDb.select().from(operations).where(eq(operations.sourceId, post.id))
    ).toHaveLength(0)
  })
})
