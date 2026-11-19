/**
 * Single sign-on and the stand-in email links across a plan's life, on the
 * real plan store.
 *
 * The other fallback tests fake plan limits. Here the plan is what the real
 * tier-limits service resolves from the settings row (no billing at all, a
 * tier-limits row, a billing projection, a projection whose access window
 * ends), so the lapse, the upgrade and self-hosting are each proven through
 * the same read the auth layer makes in production. Only the provider list and
 * saved credentials are faked, and both honour the provider asked about.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { settings } from '@/lib/server/db'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import type { BillingProjection } from '@/lib/server/domains/settings/cloud/billing-projection'
import { makeAuthConfig, makeVerifiedDomain, makeWorkspace } from './_helpers'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const state = vi.hoisted(() => ({
  providers: [] as IdentityProvider[],
  configuredTypes: new Set<string>(),
}))

vi.mock('@/lib/server/domains/settings/identity-providers.service', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/identity-providers.service')>()),
  listIdentityProviders: async () => state.providers,
}))

vi.mock(
  '@/lib/server/domains/platform-credentials/platform-credential.service',
  async (original) => ({
    ...(await original<
      typeof import('@/lib/server/domains/platform-credentials/platform-credential.service')
    >()),
    getConfiguredIntegrationTypes: async () => state.configuredTypes,
    hasPlatformCredentials: async (type: string) => state.configuredTypes.has(type),
  })
)

vi.mock('@quackback/email', async (original) => ({
  ...(await original<typeof import('@quackback/email')>()),
  isEmailConfigured: () => true,
}))

// The last-way-in guard reads the stored methods from the settings; serve the
// same SSO-only methods the row holds. The settings row itself stays real:
// plan limits read the plan from it.
vi.mock('@/lib/server/domains/settings/settings.service', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.service')>()),
  getWorkspaceSettings: async () => ssoOnlyWorkspace(),
}))

const { isAuthMethodAllowed, isHardBound } = await import('../auth-restrictions')
const { getRegisteredOidcProviderIds, isSsoLive } = await import('../registered-providers')
const { writeBillingProjection } =
  await import('@/lib/server/domains/settings/cloud/billing-projection.write')
const { writeTierLimits } = await import('@/lib/server/domains/settings/tier-limits.write')
const { invalidateTierLimitsCache } =
  await import('@/lib/server/domains/settings/tier-limits.service')
const { checkIsOnlyWorkingSignInMethod } = await import('../sign-in-method-availability')
const { OSS_TIER_LIMITS } = await import('@/lib/server/domains/settings/tier-limits.types')

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

const projection = (
  version: number,
  sso: boolean,
  over: Partial<BillingProjection> = {}
): BillingProjection => ({
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
  ...over,
})

const WORKSPACE_KEY = 'inst_acme'
const STORED_OAUTH = JSON.stringify({ oauth: { password: false, magicLink: false } })
const fixture = await createDbTestFixture()
let previousInstanceId: string | undefined

function provider(): IdentityProvider {
  const fields: Partial<IdentityProvider> = {
    id: 'idp_1' as IdentityProvider['id'],
    registrationId: 'sso',
    label: 'Acme SSO',
    enabled: true,
    configured: true,
    domains: [makeVerifiedDomain('acme.com', true, { providerId: 'idp_1' as `idp_${string}` })],
  }
  return fields as IdentityProvider
}

/** Team signs in through the provider only: password and email links off. */
const ssoOnlyWorkspace = () =>
  makeWorkspace({
    authConfig: makeAuthConfig({ oauth: { password: false, magicLink: false }, ssoOidc: null }),
  })

/** What a team member meets at sign-in right now. */
async function signIn() {
  const registered = await getRegisteredOidcProviderIds()
  const link = await isAuthMethodAllowed('magic-link', 'admin', registered, ssoOnlyWorkspace())
  return {
    emailLink: link.allowed,
    providerRegistered: registered.has('sso'),
    requireSsoBlocksEmailLink: isHardBound(
      'magic-link',
      'jane@acme.com',
      state.providers,
      registered
    ),
    // Switching the provider off would leave no way in, whether it signs the
    // team in itself or keeps the stand-in email links on.
    providerIsLastWayIn: await checkIsOnlyWorkingSignInMethod('idp_1' as `idp_${string}`),
  }
}

const SSO_ON = {
  emailLink: false,
  providerRegistered: true,
  requireSsoBlocksEmailLink: true,
  providerIsLastWayIn: true,
}
const SSO_OFF = {
  emailLink: true,
  providerRegistered: false,
  requireSsoBlocksEmailLink: false,
  providerIsLastWayIn: true,
}

async function storedRow() {
  const [row] = await testDb
    .select({ authConfig: settings.authConfig, version: settings.authConfigVersion })
    .from(settings)
    .limit(1)
  return row
}

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  previousInstanceId = process.env.QUACKBACK_INSTANCE_ID
  process.env.QUACKBACK_INSTANCE_ID = WORKSPACE_KEY
  invalidateTierLimitsCache()
  state.providers = [provider()]
  state.configuredTypes = new Set(['auth_sso'])
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Acme',
    slug: 'acme',
    authConfig: STORED_OAUTH,
    createdAt: new Date(),
  })
})
afterEach(async () => {
  vi.useRealTimers()
  invalidateTierLimitsCache()
  if (previousInstanceId === undefined) delete process.env.QUACKBACK_INSTANCE_ID
  else process.env.QUACKBACK_INSTANCE_ID = previousInstanceId
  await fixture.rollback()
})
afterAll(fixture.close)

describe('without plan billing (self-hosted)', () => {
  it('keeps single sign-on live and the stored methods exactly as they are', async () => {
    expect(await isSsoLive()).toBe(true)
    expect(await signIn()).toEqual(SSO_ON)
  })

  it('falls back to email links when tier limits leave single sign-on out, and back when cleared', async () => {
    await writeTierLimits(
      { features: { ...OSS_TIER_LIMITS.features, customOidcProvider: false } },
      { writer: 'config' }
    )
    expect(await signIn()).toEqual(SSO_OFF)

    await writeTierLimits(null, { writer: 'config' })
    expect(await signIn()).toEqual(SSO_ON)
    expect((await storedRow()).authConfig).toBe(STORED_OAUTH)
  })
})

describe('with plan billing', () => {
  it('falls back the moment a plan without single sign-on is applied, and the upgrade restores it with no setup', async () => {
    await writeBillingProjection(WORKSPACE_KEY, projection(1, true))
    expect(await signIn()).toEqual(SSO_ON)

    await writeBillingProjection(WORKSPACE_KEY, projection(2, false))
    expect(await signIn()).toEqual(SSO_OFF)

    await writeBillingProjection(WORKSPACE_KEY, projection(3, true))
    expect(await signIn()).toEqual(SSO_ON)
    // Nothing stored was changed on the way down or back.
    expect((await storedRow()).authConfig).toBe(STORED_OAUTH)
  })

  it('falls back on the clock when the plan access window ends, with nothing written', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'))
    await writeBillingProjection(
      WORKSPACE_KEY,
      projection(1, true, { planLimitsExpireAt: '2026-11-20T12:00:00.000Z' })
    )
    const before = await storedRow()

    vi.setSystemTime(new Date('2026-11-20T11:59:59.999Z'))
    expect(await signIn()).toEqual(SSO_ON)

    vi.setSystemTime(new Date('2026-11-20T12:00:00.000Z'))
    expect(await signIn()).toEqual(SSO_OFF)
    expect(await storedRow()).toEqual(before)
  })

  it('offers nothing extra on a plan without single sign-on when no provider is set up', async () => {
    state.configuredTypes = new Set()
    await writeBillingProjection(WORKSPACE_KEY, projection(1, false))
    expect((await signIn()).emailLink).toBe(false)
  })
})
