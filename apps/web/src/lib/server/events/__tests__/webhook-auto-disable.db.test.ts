/**
 * Real-Postgres proof of the webhook failure counter (API-71): only a delivery
 * that spent every attempt moves `failureCount` and records `lastError`, and the
 * 50th such failure disables the webhook. A retryable failure moves nothing.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId, type WebhookId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, user, webhooks, eq } from '@/lib/server/db'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { onHookJobFailure } from '../hook-job'

const fixture = await createDbTestFixture()

let webhookId: WebhookId

function failedJob(attempts: number): ClaimedJob {
  return {
    jobId: `job_${createId('webhook')}`,
    queue: 'events',
    dedupeKey: null,
    attempts,
    maxAttempts: 6,
    payload: {
      hookType: 'webhook',
      event: { id: 'evt_1', type: 'message.created' },
      target: { url: 'https://example.com/hook' },
      config: { webhookId },
    },
  } as unknown as ClaimedJob
}

async function row() {
  const [r] = await testDb
    .select({
      failureCount: webhooks.failureCount,
      status: webhooks.status,
      lastError: webhooks.lastError,
    })
    .from(webhooks)
    .where(eq(webhooks.id, webhookId))
  return r
}

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  const userId = createId('user') as UserId
  const owner = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Owner', email: `o+${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: owner, userId, type: 'user', role: 'admin', createdAt: new Date() })
  const [hook] = await testDb
    .insert(webhooks)
    .values({
      createdById: owner,
      url: 'https://example.com/hook',
      secret: 'encrypted',
      events: ['message.created'],
    })
    .returning()
  webhookId = hook.id as WebhookId
})
afterEach(fixture.rollback)
afterAll(fixture.close)

describe('webhook failure counter', () => {
  it('moves only on a permanent failure, records the error, and leaves the webhook active', async () => {
    await onHookJobFailure(failedJob(2), new Error('HTTP 503'), false)
    expect(await row()).toMatchObject({ failureCount: 0, status: 'active', lastError: null })

    await onHookJobFailure(failedJob(6), new Error('HTTP 503'), true)
    expect(await row()).toMatchObject({ failureCount: 1, status: 'active', lastError: 'HTTP 503' })
  })

  it('disables the webhook on its 50th permanent failure, not before', async () => {
    await testDb.update(webhooks).set({ failureCount: 48 }).where(eq(webhooks.id, webhookId))
    await onHookJobFailure(failedJob(6), new Error('HTTP 500'), true)
    expect(await row()).toMatchObject({ failureCount: 49, status: 'active' })
    await onHookJobFailure(failedJob(6), new Error('HTTP 500'), true)
    expect(await row()).toMatchObject({ failureCount: 50, status: 'disabled' })
  })
})
