/**
 * The per-workspace webhook limit counts live webhooks only. Deleting a webhook
 * is a soft delete (deleted_at is set), so a count over the whole table would
 * keep every deleted webhook against the limit, and after enough create and
 * delete cycles no new webhook could ever be created.
 *
 * Real Postgres in a rolled-back transaction: the value here is the SQL
 * itself (which rows the limit query counts).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, webhooks, isNull, sql } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// Secret encryption needs the instance secret key, which plays no part in the limit.
vi.mock('../encryption', () => ({ encryptWebhookSecret: () => 'encrypted' }))

const { createWebhook, deleteWebhook } = await import('../webhook.service')

const MAX_WEBHOOKS = 25

const fixture = await createDbTestFixture({
  probe: async (db) => void (await db.select({ id: webhooks.id }).from(webhooks).limit(0)),
})

async function seedCreator(): Promise<PrincipalId> {
  const id = createId('principal')
  await testDb
    .insert(principal)
    .values({ id, role: 'admin', type: 'anonymous', createdAt: new Date() })
  return id
}

/** Live webhooks other suites may have committed; the limit applies to them too. */
async function liveCount(): Promise<number> {
  const [{ count }] = await testDb
    .select({ count: sql<number>`count(*)::int` })
    .from(webhooks)
    .where(isNull(webhooks.deletedAt))
  return count
}

function input(n: number) {
  return { url: `https://hooks.example.com/limit-${n}`, events: ['post.created' as const] }
}

describe.skipIf(!fixture.available)('createWebhook limit', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('does not count deleted webhooks, so create and delete can repeat past the limit', async () => {
    const creator = await seedCreator()
    expect(await liveCount()).toBeLessThan(MAX_WEBHOOKS)

    for (let n = 0; n <= MAX_WEBHOOKS; n++) {
      const { webhook } = await createWebhook(input(n), creator)
      await deleteWebhook(webhook.id)
    }

    const { webhook } = await createWebhook(input(MAX_WEBHOOKS + 1), creator)
    expect(webhook.url).toBe(input(MAX_WEBHOOKS + 1).url)
  })

  it('still refuses a new webhook once the live webhooks reach the limit', async () => {
    const creator = await seedCreator()
    const toFill = MAX_WEBHOOKS - (await liveCount())
    for (let n = 0; n < toFill; n++) {
      await createWebhook(input(n), creator)
    }

    await expect(createWebhook(input(toFill), creator)).rejects.toMatchObject({
      code: 'WEBHOOK_LIMIT_REACHED',
    })
  })
})
