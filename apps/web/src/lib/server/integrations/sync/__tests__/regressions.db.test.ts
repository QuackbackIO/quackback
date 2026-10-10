import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/secret-key', () => ({
  activeSecretKey: () => 'integration-sync-test-key-32-characters-only',
}))
vi.mock('@slack/web-api', async (original) => {
  const actual = await original<typeof import('@slack/web-api')>()
  return {
    ...actual,
    WebClient: class {
      chat = {
        postMessage: vi.fn(async () => {
          throw new actual.WebAPIRateLimitedError(10)
        }),
      }
      conversations = { join: vi.fn(async () => ({ ok: true })) }
    },
  }
})
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
import { queueHookSync, persistSyncLink } from '../hooks'
import {
  claimSyncOperation,
  recoverExpiredSyncs,
  markSyncDispatched,
  finishSyncOperation,
} from '../ledger'
import { actOnSync, inspectSyncOperation } from '../history'
import * as config from '@/lib/server/config'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { queueAppHookSync } from '../app-hooks'
import { readSyncHealth } from '../health'
import { recordIntegrationLastError } from '../../webhook-registration'
import { getIntegration } from '../../index'
import { buildRemoteStatusPushTargets } from '@/lib/server/events/resolvers/remote-status-push.resolver'
import { slackHook } from '@/integrations/slack/server/hook'
import { withSyncTransport } from '../transport'
import type { HookJobData } from '@/lib/server/events/hook-job'
const fixture = await createDbTestFixture()
beforeEach(async () => {
  await fixture.begin()
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    new Error('Network disabled in sync regression test')
  )
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fixture.rollback()
})
afterAll(fixture.close)
async function seed(provider = 'linear') {
  const [actor] = await testDb
    .insert(principal)
    .values({ type: 'service', role: 'user', createdAt: new Date() })
    .returning()
  const [board] = await testDb
    .insert(boards)
    .values({ name: 'Sync regression', slug: `probe-${randomUUID()}` })
    .returning()
  const [post] = await testDb
    .insert(posts)
    .values({
      boardId: board.id,
      principalId: actor.id,
      title: 'Probe',
      content: 'Current content',
    })
    .returning()
  const [integration] = await testDb
    .insert(integrations)
    .values({ integrationType: provider, status: 'active', config: { channelId: 'team' } })
    .returning()
  const data: HookJobData = {
    hookType: provider,
    config: { integrationId: integration.id },
    target: { channelId: 'team' },
    event: {
      id: createId('event'),
      type: 'post.created',
      timestamp: new Date().toISOString(),
      actor: { type: 'service' },
      data: {
        post: {
          id: post.id,
          title: post.title,
          content: post.content,
          boardId: board.id,
          boardSlug: board.slug,
          voteCount: 0,
        },
      },
    },
  }
  return { data, post, integration }
}
describe('sync recovery regressions (PostgreSQL)', () => {
  it.each(['slack', 'discord', 'teams', 'linear'])(
    'keeps %s delivery evidence without treating notifications as linked issues',
    async (provider) => {
      const { data, post } = await seed(provider)
      const operation = (await queueHookSync(data))!
      const claim = (await claimSyncOperation(operation.id))!
      const result = { externalId: 'remote-receipt', externalUrl: 'https://provider.test/item' }
      await markSyncDispatched(claim)
      await finishSyncOperation(claim, { state: 'succeeded', result }, (tx) =>
        persistSyncLink(tx, claim, result)
      )
      const saved = await testDb.query.integrationSyncOperations.findFirst({
        where: eq(operations.id, operation.id),
      })
      expect(saved).toMatchObject({ state: 'succeeded', remoteId: result.externalId, result })
      const links = await testDb.query.postExternalLinks.findMany({
        where: eq(postExternalLinks.postId, post.id),
      })
      expect(links).toHaveLength(provider === 'linear' ? 1 : 0)
      expect(await queueHookSync(data)).toMatchObject({ id: operation.id, state: 'succeeded' })
    }
  )
  it.each(['linear', 'github'])(
    'makes %s manual review content portable without truncating it',
    async (provider) => {
      const { data } = await seed(provider)
      if (data.event.type !== 'post.created') throw new Error('Expected post event')
      data.event.data.post.content = `# Proposed update\n\n- Keep this list\n- Keep its formatting\n\n${'Full review text. '.repeat(200)}\n\n![Screenshot](/uploads/image.png)\n\n[Recording](/uploads/video.mp4)`
      const first = (await queueHookSync(data))!
      await testDb
        .update(operations)
        .set({ kind: 'refresh', state: 'conflict', errorCode: 'manual_update' })
        .where(eq(operations.id, first.id))
      vi.spyOn(config, 'getBaseUrl').mockReturnValue('https://review.quackback.test')
      const detail = await inspectSyncOperation(first.id, {
        principalId: createId('principal'),
        role: 'admin',
        principalType: 'user',
        permissions: new Set(Object.values(PERMISSIONS)),
        segmentIds: new Set(),
      })
      expect(detail.preview?.content).toContain('Full review text. '.repeat(200))
      expect(detail.preview?.content).toContain(
        '# Proposed update\n\n- Keep this list\n- Keep its formatting\n\n'
      )
      expect(detail.preview?.content).toContain(
        '![Screenshot](https://review.quackback.test/uploads/image.png)'
      )
      expect(detail.preview?.content).toContain(
        provider === 'linear'
          ? '![Video: Recording](https://review.quackback.test/uploads/video.mp4)'
          : '[Recording](https://review.quackback.test/uploads/video.mp4)'
      )
    }
  )
  it('reschedules a never-dispatched create after source deletion and restoration', async () => {
    const { data, post } = await seed()
    const first = await queueHookSync(data)
    expect(first?.state).toBe('queued')
    await testDb.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, post.id))
    const deleted = await testDb.query.integrationSyncOperations.findFirst({
      where: eq(operations.id, first!.id),
    })
    expect(deleted?.state).toBe('cancelled')
    expect(deleted?.dispatchedAt).toBeNull()
    await testDb.update(posts).set({ deletedAt: null }).where(eq(posts.id, post.id))
    const restored = await queueHookSync(data)
    expect(restored?.state).toBe('queued')
    expect(restored?.id).toBe(first?.id)
  })
  it('resumes after deletion interrupts a worker before dispatch and its lease expires', async () => {
    const { data, post } = await seed()
    const first = (await queueHookSync(data))!
    await claimSyncOperation(first.id)
    await testDb.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, post.id))
    await testDb
      .update(operations)
      .set({ leaseExpiresAt: new Date('2000-01-01') })
      .where(eq(operations.id, first.id))
    await recoverExpiredSyncs()
    expect(
      (
        await testDb.query.integrationSyncOperations.findFirst({
          where: eq(operations.id, first.id),
        })
      )?.state
    ).toBe('cancelled')
    await testDb.update(posts).set({ deletedAt: null }).where(eq(posts.id, post.id))
    expect(await queueHookSync(data)).toMatchObject({ id: first.id, state: 'queued' })
  })
  it.each(['succeeded', 'uncertain', 'cancelled'] as const)(
    'does not reactivate %s deliveries on restore',
    async (state) => {
      const { data, post } = await seed()
      const first = (await queueHookSync(data))!
      if (state === 'cancelled') {
        await actOnSync(
          { id: first.id, version: 1, actionId: randomUUID(), action: 'cancel' },
          {
            principalId: createId('principal'),
            role: 'admin',
            principalType: 'user',
            permissions: new Set(Object.values(PERMISSIONS)),
            segmentIds: new Set(),
          }
        )
      } else {
        const claim = (await claimSyncOperation(first.id))!
        await markSyncDispatched(claim)
        await finishSyncOperation(
          claim,
          state === 'succeeded'
            ? { state, result: { externalId: 'already-created' } }
            : { state, errorCode: 'outcome_unknown' }
        )
      }
      await testDb.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, post.id))
      await testDb.update(posts).set({ deletedAt: null }).where(eq(posts.id, post.id))
      expect(await queueHookSync(data)).toMatchObject({ id: first.id, state })
    }
  )
  it('retries a confirmed Slack SDK rate limit', async () => {
    const { data } = await seed('slack')
    const result = await withSyncTransport(async () => {
      const response = await slackHook.run(data.event, data.target, {
        accessToken: 'test',
        rootUrl: 'https://workspace.test',
      })
      return response
    })
    expect(result).toMatchObject({ state: 'retry_wait', retryAfterMs: 10_000 })
  })
  it('keeps app-event recovery on the serial Slack queue', async () => {
    await seed('slack')
    await queueAppHookSync('slack', randomUUID(), { encryptedPayload: 'test' })
    const op = await testDb.query.integrationSyncOperations.findFirst({
      where: eq(operations.kind, 'app-hook'),
    })
    expect(op).toBeDefined()
    const claim = await claimSyncOperation(op!.id, op!.version)
    expect(claim).not.toBeNull()
    await testDb
      .update(operations)
      .set({ leaseExpiresAt: new Date('2000-01-01') })
      .where(eq(operations.id, op!.id))
    await recoverExpiredSyncs()
    const current = await testDb.query.integrationSyncOperations.findFirst({
      where: eq(operations.id, op!.id),
    })
    const jobs = await testDb.execute(
      sql`SELECT queue FROM job_queue WHERE payload->>'operationId' = ${op!.id} AND payload->>'version' = ${String(current!.version)}`
    )
    expect(jobs[0]?.queue).toBe('slack-hook')
  })
  it('keeps a manual app-event retry on the serial Slack queue', async () => {
    await seed('slack')
    await queueAppHookSync('slack', randomUUID(), { encryptedPayload: 'test' })
    const op = (await testDb.query.integrationSyncOperations.findFirst({
      where: eq(operations.kind, 'app-hook'),
    }))!
    const claim = (await claimSyncOperation(op.id, op.version))!
    await finishSyncOperation(claim, { state: 'failed', errorCode: 'provider_failed' })
    const failed = (await testDb.query.integrationSyncOperations.findFirst({
      where: eq(operations.id, op.id),
    }))!
    await actOnSync(
      { id: op.id, version: failed.version, actionId: randomUUID(), action: 'retry' },
      {
        principalId: createId('principal'),
        role: 'admin',
        principalType: 'user',
        permissions: new Set(Object.values(PERMISSIONS)),
        segmentIds: new Set(),
      }
    )
    const jobs = await testDb.execute(
      sql`SELECT queue FROM job_queue WHERE payload->>'operationId' = ${op.id} AND payload->>'version' = ${String(failed.version + 1)}`
    )
    expect(jobs.map((job) => job.queue)).toEqual(['slack-hook'])
  })
  it('keeps webhook registration errors when refreshing sync health', async () => {
    const { integration } = await seed()
    await recordIntegrationLastError(integration.id, 'Webhook registration failed')
    await readSyncHealth(integration)
    const current = await testDb.query.integrations.findFirst({
      where: eq(integrations.id, integration.id),
    })
    expect(current?.lastError).toBe('Webhook registration failed')
  })
  it('produces a review item for a mapped GitHub status change', () => {
    const targets = buildRemoteStatusPushTargets({
      links: [
        {
          linkId: 'link',
          externalId: '42',
          integrationId: 'integration',
          integrationType: 'github',
          integrationPrincipalId: null,
          pushStatusMappings: { done: 'closed' },
        },
      ],
      statusId: 'done',
      actorType: 'user',
      actorId: 'person',
      entityType: 'post',
      hasPushCapability: (type) => !!getIntegration(type)?.listExternalStatuses,
    })
    expect(targets).toHaveLength(1)
  })
})
