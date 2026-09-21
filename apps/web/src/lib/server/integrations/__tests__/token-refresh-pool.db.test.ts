import { randomUUID } from 'node:crypto'
import { it, expect, vi, afterAll } from 'vitest'
// A real, separate one-connection pool is essential: the transactional fixture
// would hide a nested global-client query behind its transaction proxy.
// oxlint-disable-next-line no-restricted-imports
import { createDb } from '@quackback/db/client'

// CI owns its disposable DATABASE_URL; local runs must opt in explicitly.
const testUrl = vi.hoisted(
  () =>
    process.env.TEST_DATABASE_URL ??
    (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
)

const refresh = vi.hoisted(() =>
  vi.fn(async () => ({ accessToken: 'fresh', refreshToken: 'rotated', expiresIn: 3600 }))
)
vi.mock('@/lib/server/integrations/index', () => ({
  getIntegration: () => ({ refreshToken: refresh }),
}))
vi.mock('@/lib/server/cache', () => ({
  cacheDel: vi.fn().mockResolvedValue(undefined),
  CACHE_KEYS: { INTEGRATION_MAPPINGS: 'test' },
}))
vi.mock('@/lib/server/db', async (original) => {
  const actual = await original<typeof import('@/lib/server/db')>()
  // A distinct physical pool is the behavior under test.
  // oxlint-disable-next-line no-restricted-imports
  const { createDb } = await import('@quackback/db/client')
  return {
    ...actual,
    db: createDb(testUrl ?? 'postgres://localhost/unused_test_pool', {
      max: 1,
      prepare: false,
    }),
  }
})
vi.mock('@/lib/server/secret-key', () => ({
  activeSecretKey: () => 'integration-sync-review-key-32-characters-only',
}))
import { db, integrations, eq, sql } from '@/lib/server/db'
import { encryptSecrets } from '../encryption'
import { getValidAccessToken } from '../token-refresh'

const observer = createDb(testUrl ?? 'postgres://localhost/unused_test_pool', {
  max: 1,
  prepare: false,
})
afterAll(async () => {
  for (const connection of [db, observer])
    await (
      connection as unknown as { $client: { end(options: { timeout: number }): Promise<void> } }
    ).$client.end({ timeout: 1 })
})

it.skipIf(!testUrl)(
  'refreshes concurrent callers using one pool connection and rotates only once',
  async () => {
    const [row] = await db
      .insert(integrations)
      .values({
        integrationType: `pool-test-${randomUUID()}`,
        status: 'active',
        secrets: encryptSecrets({ accessToken: 'expired', refreshToken: 'refresh' }),
        config: { tokenExpiresAt: '2000-01-01T00:00:00.000Z' },
      })
      .returning()
    const [backend] = await db.execute(sql`SELECT pg_backend_pid() AS pid`)
    const attempt = Promise.all([getValidAccessToken(row.id), getValidAccessToken(row.id)])
    let timer: ReturnType<typeof setTimeout> | undefined
    let result: string[] | 'stalled' = 'stalled'
    try {
      result = await Promise.race([
        attempt,
        new Promise<'stalled'>((resolve) => {
          timer = setTimeout(() => resolve('stalled'), 3000)
        }),
      ])
    } finally {
      clearTimeout(timer)
      if (result === 'stalled') {
        await observer.execute(sql`SELECT pg_terminate_backend(${backend.pid})`)
        await attempt.catch(() => undefined)
      }
      await observer.delete(integrations).where(eq(integrations.id, row.id))
    }
    expect(result).toEqual(['fresh', 'fresh'])
    expect(refresh).toHaveBeenCalledTimes(1)
  }
)
