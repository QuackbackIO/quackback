/**
 * A tier-limits write moves the auth config version.
 *
 * Tier limits decide whether identity providers register, and the auth
 * instance is rebuilt only when `auth_config_version` changes, so without the
 * bump a write that turns single sign-on back on would leave every process on
 * an instance built without its providers.
 */
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { settings } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { writeTierLimits } = await import('../tier-limits.write')
const { OSS_TIER_LIMITS } = await import('../tier-limits.types')

const fixture = await createDbTestFixture()

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  await testDb
    .insert(settings)
    .values({ id: createId('workspace'), name: 'Acme', slug: 'acme', createdAt: new Date() })
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function authConfigVersion(): Promise<number> {
  const [row] = await testDb.select({ v: settings.authConfigVersion }).from(settings).limit(1)
  return row.v
}

it('moves the auth config version when the limits change', async () => {
  const before = await authConfigVersion()
  const off = {
    ...OSS_TIER_LIMITS,
    features: { ...OSS_TIER_LIMITS.features, customOidcProvider: false },
  }
  const result = await writeTierLimits(off, { writer: 'config' })
  expect(result.changed).toBe(true)
  expect(await authConfigVersion()).toBeGreaterThan(before)
})

it('leaves it alone when nothing changes', async () => {
  await writeTierLimits(OSS_TIER_LIMITS, { writer: 'config' })
  const applied = await authConfigVersion()
  const result = await writeTierLimits(OSS_TIER_LIMITS, { writer: 'config' })
  expect(result.changed).toBe(false)
  expect(await authConfigVersion()).toBe(applied)
})
