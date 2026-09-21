import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  posts,
  principal,
  integrations,
  postExternalLinks,
  integrationSyncOperations as operations,
  eq,
  sql,
} from '@/lib/server/db'
import { enqueueJob } from '@/lib/server/jobs/job-queue'
import { linkTicketToPost, unlinkTicketFromPost, getLinkedPosts } from '../../apps/service'
import { queueHookSync } from '../hooks'
import { claimSyncOperation } from '../ledger'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import type { HookJobData } from '@/lib/server/events/hook-job'
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
    .values({ type: 'service', role: 'user', createdAt: new Date() })
    .returning()
  const [board] = await testDb
    .insert(boards)
    .values({ name: 'Sync start', slug: `sync-start-${randomUUID()}` })
    .returning()
  const [post] = await testDb
    .insert(posts)
    .values({
      boardId: board.id,
      principalId: actor.id,
      title: 'Current title',
      content: 'Current body',
    })
    .returning()
  const [integration] = await testDb
    .insert(integrations)
    .values({ integrationType: 'linear', status: 'active', config: { channelId: 'team' } })
    .returning()
  const data: HookJobData = {
    hookType: 'linear',
    config: { integrationId: integration.id, accessToken: 'OLD-SECRET' },
    target: { channelId: 'team' },
    event: {
      id: createId('event'),
      type: 'post.created',
      timestamp: new Date().toISOString(),
      actor: { type: 'service' },
      data: {
        post: {
          id: post.id,
          title: 'OLD-PRIVATE-TITLE',
          content: 'OLD-BODY',
          boardId: board.id,
          boardSlug: board.slug,
          voteCount: 0,
        },
      },
    },
  }
  return { data, post, integration }
}
async function startAt(date = '2020-01-01T00:00:00Z') {
  await testDb.execute(
    sql`UPDATE integration_sync_start SET started_at = ${date}::timestamptz WHERE id = 1`
  )
}
describe('forward-only integration sync (PostgreSQL)', () => {
  it('skips old posts without creating history or a job, while new posts sync', async () => {
    await startAt()
    const { data, post, integration } = await seed()
    await testDb
      .update(posts)
      .set({ createdAt: new Date('2019-01-01') })
      .where(eq(posts.id, post.id))
    expect(await queueHookSync(data)).toBeNull()
    expect(
      await testDb.query.integrationSyncOperations.findMany({
        where: eq(operations.integrationId, integration.id),
      })
    ).toHaveLength(0)
    await testDb.update(posts).set({ createdAt: new Date() }).where(eq(posts.id, post.id))
    expect(await queueHookSync(data)).toMatchObject({ state: 'queued' })
  })
  it('ignores old outbox events but accepts a new event for existing content', async () => {
    await startAt()
    const { data, integration } = await seed()
    const stale = {
      ...data,
      event: { ...data.event, type: 'post.updated', timestamp: '2019-01-01T00:00:00Z' },
    } as HookJobData
    expect(await queueHookSync(stale)).toBeNull()
    expect(
      await testDb.query.integrationSyncOperations.findMany({
        where: eq(operations.integrationId, integration.id),
      })
    ).toHaveLength(0)
    expect(
      await queueHookSync({
        ...stale,
        event: { ...stale.event, timestamp: new Date().toISOString() },
      } as HookJobData)
    ).toMatchObject({ state: 'queued' })
  })
  it('fails closed when the recorded boundary is unavailable', async () => {
    await startAt()
    const { data } = await seed()
    const op = await queueHookSync(data)
    if (!op) throw new Error('Expected eligible operation')
    await testDb.execute(sql`DELETE FROM integration_sync_start WHERE id = 1`)
    await expect(queueHookSync(data)).rejects.toThrow('start boundary is unavailable')
    await expect(claimSyncOperation(op.id)).rejects.toThrow('start boundary is unavailable')
  })
  it('deletes retired jobs and receipts without importing them or touching new and ordinary jobs', async () => {
    await startAt()
    const { data, integration } = await seed()
    await enqueueJob({
      queue: 'events',
      dedupeKey: 'retired-integration',
      payload: data as unknown as Record<string, unknown>,
    })
    await enqueueJob({
      queue: 'events',
      dedupeKey: 'ordinary-webhook',
      payload: { hookType: 'webhook', config: {} },
    })
    await enqueueJob({
      queue: 'slack-hook',
      dedupeKey: 'retired-slack',
      payload: { encryptedPayload: 'old' },
    })
    await enqueueJob({
      queue: 'slack-hook',
      dedupeKey: 'current-slack',
      payload: { operationId: randomUUID(), version: 1 },
    })
    const receipt = `integration-post-created:${data.event.id}:${integration.id}:old`
    await testDb.execute(
      sql`INSERT INTO hook_deliveries(job_id, hook_type, outcome) VALUES (${receipt}, 'linear', 'completed')`
    )
    const migration = readFileSync(
      resolve(process.cwd(), 'packages/db/drizzle/0284_integration_sync.sql'),
      'utf8'
    )
    const retirement = migration.split('--> statement-breakpoint').at(-1)!
    await testDb.execute(sql.raw(retirement))
    await testDb.execute(sql.raw(retirement))
    expect(
      getExecuteRows(
        await testDb.execute(
          sql`SELECT dedupe_key FROM job_queue WHERE dedupe_key IN ('retired-integration', 'ordinary-webhook', 'retired-slack', 'current-slack') ORDER BY dedupe_key`
        )
      )
    ).toEqual([{ dedupe_key: 'current-slack' }, { dedupe_key: 'ordinary-webhook' }])
    expect(
      getExecuteRows(
        await testDb.execute(sql`SELECT 1 FROM hook_deliveries WHERE job_id = ${receipt}`)
      )
    ).toHaveLength(0)
    expect(
      await testDb.query.integrationSyncOperations.findMany({
        where: eq(operations.integrationId, integration.id),
      })
    ).toHaveLength(0)
  })
  it('keeps sidebar references idempotent and independent of sync-owned links', async () => {
    const { post, integration } = await seed()
    const [owned] = await testDb
      .insert(postExternalLinks)
      .values({
        postId: post.id,
        integrationId: integration.id,
        integrationType: 'linear',
        externalId: 'same-remote-id',
        syncScope: 'managed-destination',
      })
      .returning()
    const input = { postId: post.id, integrationType: 'linear', externalId: 'same-remote-id' }
    const first = await linkTicketToPost(input, post.principalId!)
    const second = await linkTicketToPost(input, post.principalId!)
    expect(first.linkId).not.toBe(owned.id)
    expect(second.linkId).toBe(first.linkId)
    expect(await getLinkedPosts(input)).toMatchObject([{ linkId: first.linkId }])
    expect(await getLinkedPosts(input)).toHaveLength(1)
    await unlinkTicketFromPost(input)
    expect(
      await testDb.query.postExternalLinks.findFirst({ where: eq(postExternalLinks.id, owned.id) })
    ).toBeDefined()
    expect(await getLinkedPosts(input)).toHaveLength(0)
  })
})
