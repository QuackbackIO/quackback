/**
 * Managing a webhook over REST and from the admin settings: a deleted webhook
 * is gone (reads, updates and rotations answer not found), and only turning a
 * disabled webhook back on clears its failure count. Saving an unrelated edit
 * keeps the count, so a failing endpoint stays visible.
 *
 * Real Postgres in a rolled-back transaction.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type PrincipalId, type WebhookId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, principal, webhooks } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// Secret encryption needs the instance secret key, which plays no part here.
vi.mock('../encryption', () => ({ encryptWebhookSecret: () => 'encrypted' }))

const { createWebhook, deleteWebhook, getWebhookById, rotateWebhookSecret, updateWebhook } =
  await import('../webhook.service')

const fixture = await createDbTestFixture({
  probe: async (db) => void (await db.select({ id: webhooks.id }).from(webhooks).limit(0)),
})

async function newHook(): Promise<WebhookId> {
  const creator = createId('principal') as PrincipalId
  await testDb
    .insert(principal)
    .values({ id: creator, role: 'admin', type: 'anonymous', createdAt: new Date() })
  const { webhook } = await createWebhook(
    { url: 'https://hooks.example.com/manage', events: ['post.created'] },
    creator
  )
  return webhook.id
}

async function setCounters(id: WebhookId, values: Partial<typeof webhooks.$inferInsert>) {
  await testDb.update(webhooks).set(values).where(eq(webhooks.id, id))
}

const notFound = { code: 'WEBHOOK_NOT_FOUND', message: 'Webhook not found' }

describe.skipIf(!fixture.available)('webhook management (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('treats a deleted webhook as not found for reads, updates, rotations and deletes', async () => {
    const id = await newHook()
    await deleteWebhook(id)

    await expect(getWebhookById(id)).rejects.toMatchObject(notFound)
    await expect(updateWebhook(id, { status: 'active' })).rejects.toMatchObject(notFound)
    await expect(rotateWebhookSecret(id)).rejects.toMatchObject(notFound)
    await expect(deleteWebhook(id)).rejects.toMatchObject(notFound)
  })

  it("keeps an active webhook's failure count when an edit saves status active again", async () => {
    const id = await newHook()
    await setCounters(id, { failureCount: 12, lastError: 'HTTP 500' })

    const updated = await updateWebhook(id, {
      events: ['post.created', 'comment.created'],
      status: 'active',
    })

    expect(updated).toMatchObject({
      events: ['post.created', 'comment.created'],
      status: 'active',
      failureCount: 12,
      lastError: 'HTTP 500',
    })
  })

  it('clears the failure count when a disabled webhook is turned back on', async () => {
    const id = await newHook()
    await setCounters(id, { status: 'disabled', failureCount: 50, lastError: 'HTTP 500' })

    const updated = await updateWebhook(id, { status: 'active' })

    expect(updated).toMatchObject({ status: 'active', failureCount: 0, lastError: null })
  })

  it('keeps the failure count when a webhook is turned off', async () => {
    const id = await newHook()
    await setCounters(id, { failureCount: 3, lastError: 'HTTP 502' })

    const updated = await updateWebhook(id, { status: 'disabled' })

    expect(updated).toMatchObject({ status: 'disabled', failureCount: 3, lastError: 'HTTP 502' })
  })
})
