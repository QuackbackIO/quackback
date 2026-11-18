/**
 * A billing projection that is applied moves the auth config version.
 *
 * The auth instance registers identity providers only while the plan includes
 * single sign-on, and it is rebuilt only when `auth_config_version` changes.
 * Without the bump, a workspace whose plan gained single sign-on back kept an
 * instance built without its providers, so the sign-in button led nowhere
 * until some unrelated auth setting was saved.
 */
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { settings } from '@/lib/server/db'
import type { BillingProjection } from '../billing-projection'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { writeBillingProjection } = await import('../billing-projection.write')

const LIMITS = {
  maxBoards: 25,
  maxPosts: 1_000,
  maxTeamSeats: 10,
  maxStatusComponents: 25,
  maxCustomRoles: 5,
  maxSendingDomains: 3,
  aiTokensPerMonth: 100_000,
  emailsPerMonth: null,
  apiRequestsPerMonth: 100_000,
  apiRequestsPerMinute: 600,
  maxInboundEmailAddresses: null,
  maxHelpCenterLocales: null,
  maxStatusSubscribers: null,
}

const projection = (version: number, sso: boolean): BillingProjection => ({
  version,
  effectivePlan: sso ? 'enterprise' : 'free',
  trialStartedAt: null,
  trialExpiresAt: null,
  subscriptionStatus: null,
  entitlements: { sso },
  freeLimits: LIMITS,
  planLimits: LIMITS,
  planLimitsExpireAt: null,
  canUpgrade: true,
  canManageBilling: false,
  renewalAt: null,
  cancellationAt: null,
})

const WORKSPACE_KEY = 'inst_acme'
const fixture = await createDbTestFixture()
let previousInstanceId: string | undefined

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  previousInstanceId = process.env.QUACKBACK_INSTANCE_ID
  process.env.QUACKBACK_INSTANCE_ID = WORKSPACE_KEY
  await testDb
    .insert(settings)
    .values({ id: createId('workspace'), name: 'Acme', slug: 'acme', createdAt: new Date() })
})
afterEach(async () => {
  if (previousInstanceId === undefined) delete process.env.QUACKBACK_INSTANCE_ID
  else process.env.QUACKBACK_INSTANCE_ID = previousInstanceId
  await fixture.rollback()
})
afterAll(fixture.close)

async function authConfigVersion(): Promise<number> {
  const [row] = await testDb.select({ v: settings.authConfigVersion }).from(settings).limit(1)
  return row.v
}

it('moves the auth config version when a projection is applied', async () => {
  const before = await authConfigVersion()
  await writeBillingProjection(WORKSPACE_KEY, projection(1, false))
  const afterDrop = await authConfigVersion()
  expect(afterDrop).toBeGreaterThan(before)

  await writeBillingProjection(WORKSPACE_KEY, projection(2, true))
  expect(await authConfigVersion()).toBeGreaterThan(afterDrop)
})

it('leaves it alone for an idempotent replay', async () => {
  await writeBillingProjection(WORKSPACE_KEY, projection(1, true))
  const applied = await authConfigVersion()
  const result = await writeBillingProjection(WORKSPACE_KEY, projection(1, true))
  expect(result.applied).toBe(false)
  expect(await authConfigVersion()).toBe(applied)
})
