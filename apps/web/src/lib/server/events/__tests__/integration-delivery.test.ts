import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createId, type PostId, type BoardId } from '@quackback/ids'
vi.mock('@/lib/server/secret-key', () => ({
  activeSecretKey: () => 'integration-sync-test-key-32-characters-only',
}))
vi.mock('@/lib/server/db', async (original) => {
  // oxlint-disable-next-line no-restricted-imports
  const { createDb } = await import('@quackback/db/client')
  return {
    ...(await original<typeof import('@/lib/server/db')>()),
    db: createDb(process.env.DATABASE_URL!, { max: 8, prepare: false }),
  }
})
import {
  db,
  eq,
  sql,
  posts,
  boards,
  integrations,
  principal,
  integrationSyncOperations as operations,
} from '@/lib/server/db'
import { enqueueHookJobsWithIds } from '../process'
import { queueHookSync } from '@/lib/server/integrations/sync/hooks'
import {
  claimSyncOperation,
  finishSyncOperation,
  markSyncDispatched,
} from '@/lib/server/integrations/sync/ledger'
import type { HookJobData } from '../hook-job'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
const fixtures: HookJobData[] = []
const principals: string[] = []
async function delivery(type = 'linear'): Promise<HookJobData> {
  const [author] = await db
    .insert(principal)
    .values({ type: 'service', role: 'user', displayName: 'Sync test', createdAt: new Date() })
    .returning()
  principals.push(author.id)
  const [board] = await db
    .insert(boards)
    .values({ name: 'Sync review', slug: `sync-${randomUUID()}` })
    .returning()
  const [post] = await db
    .insert(posts)
    .values({
      boardId: board.id,
      principalId: author.id,
      title: 'Sync review',
      content: 'Canonical body',
      moderationState: 'published',
    })
    .returning()
  const [integration] = await db
    .insert(integrations)
    .values({
      integrationType: `test-${randomUUID()}`,
      status: 'active',
      config: { channelId: 'team' },
    })
    .returning()
  const data: HookJobData = {
    hookType: type,
    target: { channelId: 'team' },
    config: { integrationId: integration.id, accessToken: 'must-not-be-queued' },
    event: {
      id: createId('event'),
      type: 'post.created',
      timestamp: new Date().toISOString(),
      actor: { type: 'service' },
      data: {
        post: {
          id: post.id,
          title: post.title,
          boardId: board.id,
          boardSlug: board.slug,
          voteCount: 0,
          content: post.content,
        },
      },
    },
  }
  fixtures.push(data)
  return data
}
async function rows(data: HookJobData) {
  return db.query.integrationSyncOperations.findMany({
    where: eq(operations.integrationId, String(data.config.integrationId)),
  })
}
async function jobs(data: HookJobData) {
  return getExecuteRows<{ status: string; payload: Record<string, unknown> }>(
    await db.execute(sql`
    SELECT status, payload FROM job_queue WHERE queue = 'integration-sync' AND payload->>'operationId' IN
      (SELECT id::text FROM integration_sync_operations WHERE integration_id = ${String(data.config.integrationId)})`)
  )
}
afterEach(async () => {
  for (const data of fixtures.splice(0)) {
    await db.execute(sql`DELETE FROM job_queue WHERE payload->'config'->>'integrationId' = ${String(data.config.integrationId)}
      OR payload->>'operationId' IN (SELECT id::text FROM integration_sync_operations WHERE integration_id = ${String(data.config.integrationId)})`)
    await db
      .delete(operations)
      .where(eq(operations.integrationId, String(data.config.integrationId)))
    if (data.event.type === 'post.created') {
      await db.delete(posts).where(eq(posts.id, data.event.data.post.id as PostId))
      await db.delete(boards).where(eq(boards.id, data.event.data.post.boardId as BoardId))
    }
    await db.delete(integrations).where(eq(integrations.id, data.config.integrationId as never))
  }
  for (const id of principals.splice(0))
    await db.delete(principal).where(eq(principal.id, id as never))
})
describe('durable integration fan-out (PostgreSQL)', () => {
  it.each(['linear', 'github', 'slack'])(
    '%s deduplicates original and concurrent manual requests',
    async (type) => {
      const data = await delivery(type)
      await Promise.all([
        enqueueHookJobsWithIds([{ name: 'post.created', data, jobId: 'original-key' }]),
        ...Array.from({ length: 4 }, () =>
          queueHookSync({ ...data, event: { ...data.event, id: createId('event') } })
        ),
      ])
      expect(await rows(data)).toHaveLength(1)
      const queued = await jobs(data)
      expect(queued).toHaveLength(1)
      expect(queued[0].status).toBe('pending')
      expect(Object.keys(queued[0].payload).sort()).toEqual(['operationId', 'version'])
      expect(JSON.stringify(queued)).not.toContain('must-not-be-queued')
    }
  )
  it('keeps destinations independent', async () => {
    const data = await delivery()
    await queueHookSync(data)
    await queueHookSync({ ...data, target: { channelId: 'other-team' } })
    expect(await rows(data)).toHaveLength(2)
  })
  it('never resets failed or running operations through source re-sync', async () => {
    const data = await delivery()
    await queueHookSync(data)
    const op = (await rows(data))[0]
    const claim = (await claimSyncOperation(op.id))!
    await markSyncDispatched(claim)
    await queueHookSync(data)
    expect((await rows(data))[0].leaseToken).toBe(claim.token)
    await finishSyncOperation(claim, { state: 'failed', errorCode: 'provider_failed' })
    expect((await queueHookSync(data))?.state).toBe('failed')
    expect((await rows(data))[0].state).toBe('failed')
  })
  it('keeps completed identity after the queue row is pruned', async () => {
    const data = await delivery()
    await queueHookSync(data)
    const op = (await rows(data))[0]
    await finishSyncOperation((await claimSyncOperation(op.id))!, { state: 'succeeded' })
    await db.execute(sql`DELETE FROM job_queue WHERE payload->>'operationId' = ${op.id}`)
    expect((await queueHookSync(data))?.state).toBe('succeeded')
    expect(await jobs(data)).toHaveLength(0)
  })
})
