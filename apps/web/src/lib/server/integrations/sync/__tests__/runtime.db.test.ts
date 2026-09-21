import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
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
const refresh = vi.hoisted(() => vi.fn())
vi.mock('../../index', () => ({ getIntegration: () => ({ refreshToken: refresh }) }))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getPlatformCredentials: async () => null,
}))
vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheDel: vi.fn().mockResolvedValue(undefined),
}))
import { db, eq, sql, integrations, integrationSyncOperations as operations } from '@/lib/server/db'
import { encryptSecrets, decryptSecrets } from '../../encryption'
import { getValidAccessToken } from '../../token-refresh'
import { readSyncHealth } from '../health'
import { queueSyncOperation } from '../ledger'
import { installationIdentity } from '../identity'
import type { IntegrationId } from '@quackback/ids'
const ids: IntegrationId[] = []
async function seed() {
  const [row] = await db
    .insert(integrations)
    .values({
      integrationType: `sync-runtime-${randomUUID()}`,
      status: 'active',
      connectedAt: new Date(),
      secrets: encryptSecrets({ accessToken: 'expired', refreshToken: 'one-use' }),
      config: { channelId: 'original', tokenExpiresAt: new Date(0).toISOString() },
    })
    .returning()
  ids.push(row.id)
  return row
}
afterEach(async () => {
  vi.clearAllMocks()
  for (const id of ids.splice(0)) {
    await db.execute(
      sql`DELETE FROM job_queue WHERE payload->>'operationId' IN (SELECT id::text FROM integration_sync_operations WHERE integration_id = ${id})`
    )
    await db.delete(operations).where(eq(operations.integrationId, id))
    await db.delete(integrations).where(eq(integrations.id, id))
  }
})
describe('sync runtime concurrency (PostgreSQL)', () => {
  it('consumes a rotating refresh token once across concurrent workers and preserves a concurrent configuration change', async () => {
    const integration = await seed()
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    refresh.mockImplementation(async (token) => {
      expect(token).toBe('one-use')
      started.resolve()
      await release.promise
      return { accessToken: 'fresh', refreshToken: 'rotated', expiresIn: 3600 }
    })
    const first = getValidAccessToken(integration.id)
    await started.promise
    const second = getValidAccessToken(integration.id)
    const change = db
      .update(integrations)
      .set({ config: sql`${integrations.config} || '{"channelId":"new-destination"}'::jsonb` })
      .where(eq(integrations.id, integration.id))
      .execute()
    release.resolve()
    expect(await Promise.all([first, second])).toEqual(['fresh', 'fresh'])
    await change
    expect(refresh).toHaveBeenCalledTimes(1)
    const row = (await db.query.integrations.findFirst({
      where: eq(integrations.id, integration.id),
    }))!
    expect(decryptSecrets(row.secrets!)).toMatchObject({
      accessToken: 'fresh',
      refreshToken: 'rotated',
    })
    expect(row.config).toMatchObject({ channelId: 'new-destination' })
  })
  it('starts health from the new ledger instead of retaining discarded delivery state', async () => {
    const integration = await seed()
    await db
      .update(integrations)
      .set({
        lastError: 'Old delivery failed',
        lastErrorAt: new Date(),
        errorCount: 9,
        lastOutboundAt: new Date(),
        lastInboundAt: new Date(),
      })
      .where(eq(integrations.id, integration.id))
    expect(await readSyncHealth(integration)).toMatchObject({
      attentionCount: 0,
      lastOutboundAt: null,
      lastInboundAt: null,
    })
  })
  it('counts unresolved operations independently of concurrent successful deliveries', async () => {
    const integration = await seed()
    const base = {
      integrationId: integration.id,
      installation: installationIdentity(integration),
      provider: integration.integrationType,
      direction: 'outbound' as const,
      kind: 'notify',
      sourceType: 'event',
      destination: {},
      payload: { executor: 'refresh' as const, data: {} },
    }
    const [failed] = await Promise.all([
      queueSyncOperation({
        ...base,
        operationKey: randomUUID(),
        sourceId: randomUUID(),
        state: 'failed',
        errorCode: 'provider_failed',
      }),
      queueSyncOperation({
        ...base,
        operationKey: randomUUID(),
        sourceId: randomUUID(),
        state: 'succeeded',
      }),
    ])
    const snapshots = await Promise.all(
      Array.from({ length: 4 }, () => readSyncHealth(integration))
    )
    expect(snapshots.every((s) => s.attentionCount === 1)).toBe(true)
    expect(snapshots[0].lastOutboundAt).not.toBeNull()
    if (!failed) throw new Error('Expected a new sync operation')
    await db.update(operations).set({ state: 'cancelled' }).where(eq(operations.id, failed.id))
    expect((await readSyncHealth(integration)).attentionCount).toBe(0)
  })
})
