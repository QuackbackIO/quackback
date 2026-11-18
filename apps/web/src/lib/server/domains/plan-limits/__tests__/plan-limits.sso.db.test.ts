/**
 * Single sign-on and plan limits against a real database: a provider set up
 * before a drop keeps signing in through the grace, the workspace settings
 * read never waits on the plan limits that read it, and one request
 * evaluates plan limits once.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type WorkspaceId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, eq, identityProvider, isNull, settings } from '@/lib/server/db'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

const spies = vi.hoisted(() => ({ sourceReads: 0, cache: new Map<string, unknown>() }))

// The application cache, kept in memory: its kv rows are shared by every test
// file on the database, and a write that collides with another file's commit
// aborts this test's transaction.
vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheGet: async (key: string) =>
    spies.cache.has(key) ? structuredClone(spies.cache.get(key)) : null,
  cacheSet: async (key: string, value: unknown) => {
    spies.cache.set(key, structuredClone(value))
  },
  cacheDel: async (...keys: string[]) => {
    for (const key of keys) spies.cache.delete(key)
  },
}))

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
// Counts the settings reads each plan limits evaluation starts from.
vi.mock('@/lib/server/domains/settings/settings.plan-limits', async (original) => {
  const real = await original<typeof import('@/lib/server/domains/settings/settings.plan-limits')>()
  return {
    ...real,
    readPlanLimitsSources: async () => {
      spies.sourceReads += 1
      return real.readPlanLimitsSources()
    },
  }
})
// The provider's saved secret, read as the auth layer reads it: by credential type.
vi.mock(
  '@/lib/server/domains/platform-credentials/platform-credential.service',
  async (original) => ({
    ...(await original<
      typeof import('@/lib/server/domains/platform-credentials/platform-credential.service')
    >()),
    getConfiguredIntegrationTypes: async () => new Set(['auth_acme-sso']),
  })
)

import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { getWorkspaceSettings } from '@/lib/server/domains/settings/settings.service'
import { isSsoLive } from '@/lib/server/auth/registered-providers'
import { runWithLogContext } from '@/lib/server/log-context'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import { resolveCloudConfig } from '@/lib/server/domains/settings/cloud/cloud.service'
import { planBillingOn } from './plan-billing'
import { getPlanLimits, invalidatePlanLimits } from '../plan-limits.service'

const fixture = await createDbTestFixture()
afterAll(fixture.close)
const DAY = 24 * 60 * 60 * 1000

let settingsId: WorkspaceId

/** `planBilling` off is an install without plan billing; `cloud` overrides it. */
async function configure(options: {
  planBilling: boolean
  tierLimits?: Record<string, unknown> | null
  cloud?: unknown
}) {
  await testDb
    .update(settings)
    .set({
      tierLimits: options.tierLimits === null ? null : JSON.stringify(options.tierLimits ?? {}),
      cloud: (options.cloud ?? (options.planBilling ? planBillingOn() : null)) as never,
    })
    .where(eq(settings.id, settingsId))
  invalidateTierLimitsCache()
  await invalidateSettingsCache()
}

async function ensureSettings(): Promise<WorkspaceId> {
  const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
  if (row) return row.id
  const [created] = await testDb
    .insert(settings)
    .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
    .returning({ id: settings.id })
  return created!.id
}

async function storedState(): Promise<Record<string, unknown> | null> {
  const [row] = await testDb
    .select({ state: settings.planLimitsState })
    .from(settings)
    .where(eq(settings.id, settingsId))
  return (row?.state as Record<string, unknown> | null) ?? null
}

/**
 * Single sign-on set up on a plan without it: it keeps working through the
 * grace and falls back to email links only once paused. The workspace
 * settings read asks for it, and plan limits read the settings, so the read
 * must not wait on itself.
 */
describe.skipIf(!fixture.available)('single sign-on through the grace (real DB)', () => {
  const NO_SSO = {
    ...OSS_TIER_LIMITS,
    features: { ...OSS_TIER_LIMITS.features, customOidcProvider: false },
  }

  beforeEach(async () => {
    await fixture.begin()
    vi.useRealTimers()
    spies.cache.clear()
    settingsId = await ensureSettings()
    await testDb.update(settings).set({ planLimitsState: null }).where(eq(settings.id, settingsId))
    await testDb.update(boards).set({ deletedAt: new Date() }).where(isNull(boards.deletedAt))
    await testDb.delete(identityProvider)
    await testDb.insert(identityProvider).values({
      registrationId: 'acme-sso',
      label: 'Acme SSO',
      clientId: 'acme-client',
      enabled: true,
      showButton: true,
    } as never)
  })
  afterEach(async () => {
    vi.useRealTimers()
    await invalidatePlanLimits()
    await fixture.rollback()
  })

  const settled = <T>(work: Promise<T>) =>
    Promise.race([
      work,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('the settings read waited on itself')), 5000)
      ),
    ])

  it('keeps a provider set up before the drop signing in until the grace ends', async () => {
    await configure({ planBilling: true, tierLimits: NO_SSO })
    const workspace = await settled(getWorkspaceSettings())
    expect(workspace?.ssoProvidersConfigured).toBe(true)
    expect(workspace?.publicPortalConfig.oidcProviders?.map((p) => p.id)).toEqual(['acme-sso'])
    expect(await isSsoLive()).toBe(true)
    const state = await storedState()
    expect((state?.fromFeatures as Record<string, boolean>).sso).toBe(true)

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    await invalidatePlanLimits()
    expect(await isSsoLive()).toBe(false)
    // The cached settings still hold the button; the read drops it.
    const paused = await settled(getWorkspaceSettings())
    expect(paused?.publicPortalConfig.oidcProviders).toBeUndefined()
  })

  it('keeps single sign-on live through the grace after a Business term lapses', async () => {
    const now = new Date()
    vi.useFakeTimers({ toFake: ['Date'], now })
    const business = {
      ...projection(1, 'business', null, { sso: true, webhooks: true }),
      planLimitsExpireAt: new Date(now.getTime() - DAY).toISOString(),
    }
    await configure({
      planBilling: true,
      tierLimits: null,
      cloud: { enabled: true, projection: business },
    })
    // The term has lapsed: the plan in force is Free, which has no single sign-on.
    expect(resolveCloudConfig({ enabled: true, projection: business } as never, now).plan).toBe(
      'free'
    )
    expect(await isSsoLive()).toBe(true)
    const limits = await getPlanLimits()
    expect(limits.phase).toBe('grace')
    expect(limits.fromPlan).toBe('business')
    expect(limits.featureIssues.map((issue) => issue.key)).toContain('sso')
    vi.setSystemTime(now.getTime() + 6 * DAY)
    await invalidatePlanLimits()
    expect(await isSsoLive()).toBe(true)
    vi.setSystemTime(now.getTime() + 8 * DAY)
    await invalidatePlanLimits()
    expect(await isSsoLive()).toBe(false)
  })

  it('evaluates plan limits once for two settings reads in one request', async () => {
    await configure({ planBilling: true, tierLimits: NO_SSO })
    // A first read stores the grace; the request below finds it stored.
    await settled(getWorkspaceSettings())
    spies.sourceReads = 0
    // In a request the settings load is shared, so loading it must not ask
    // plan limits, which read the same settings.
    await runWithLogContext({ request_id: 'req_acme' }, async () => {
      await settled(getWorkspaceSettings())
      await settled(getWorkspaceSettings())
      expect(await isSsoLive()).toBe(true)
    })
    expect(spies.sourceReads).toBe(1)
  })

  it('is the plan alone without plan billing', async () => {
    await configure({ planBilling: false, tierLimits: NO_SSO })
    expect(await isSsoLive()).toBe(false)
    await configure({ planBilling: false, tierLimits: { ...OSS_TIER_LIMITS } })
    expect(await isSsoLive()).toBe(true)
    expect(await storedState()).toBeNull()
  })
})

function projection(
  version: number,
  plan: string,
  maxBoards: number | null,
  entitlements: Record<string, boolean>
) {
  return {
    version,
    effectivePlan: plan,
    trialStartedAt: null,
    trialExpiresAt: null,
    subscriptionStatus: plan === 'free' ? null : 'active',
    entitlements,
    freeLimits: projectedLimits(1),
    planLimits: projectedLimits(maxBoards),
    planLimitsExpireAt: null,
    canUpgrade: true,
    canManageBilling: true,
    renewalAt: null,
    cancellationAt: null,
  }
}

function projectedLimits(boards: number | null) {
  return {
    maxBoards: boards,
    maxPosts: null,
    maxTeamSeats: null,
    maxStatusComponents: null,
    maxCustomRoles: null,
    maxSendingDomains: null,
    aiTokensPerMonth: null,
    emailsPerMonth: null,
    apiRequestsPerMonth: null,
    apiRequestsPerMinute: null,
    maxInboundEmailAddresses: null,
    maxHelpCenterLocales: null,
    maxStatusSubscribers: null,
  }
}

/** A Pro term that lapsed at `at`: Free's one board from then on. */
