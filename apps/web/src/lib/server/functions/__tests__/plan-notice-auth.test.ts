/**
 * Regression: `getPlanNotice` shipped with zero auth check — any
 * unauthenticated RPC call to the server-fn endpoint could read
 * whatever the operator put in tierLimits.notice (label/message/
 * actionUrl), e.g. billing or maintenance details. The admin route
 * gates the UI path on admin/member, but the handler itself must
 * enforce the same boundary.
 *
 * This pins the contract at the handler boundary: requireAuth({roles:
 * ['admin', 'member']}) is invoked before tier limits are read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { StoredCloudConfig } from '@/lib/shared/db-types'

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockGetTierLimits: vi.fn(),
  mockGetWorkspaceSettings: vi.fn(),
  mockFetchCatalogue: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.mockGetWorkspaceSettings,
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: hoisted.mockGetTierLimits,
}))

vi.mock('@/lib/server/control-plane/client', () => ({
  fetchBillingCatalogue: (...args: unknown[]) => hoisted.mockFetchCatalogue(...args),
}))

vi.mock('@/lib/server/control-plane/starter-trial', () => ({
  reportStarterTrialIfDue: vi.fn().mockResolvedValue(undefined),
}))

type AnyHandler = () => Promise<unknown>

const handlers: AnyHandler[] = []
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

let getPlanNoticeHandler: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()
  hoisted.mockGetTierLimits.mockResolvedValue({})
  hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { cloud: null } })
  if (handlers.length === 0) await import('../plan-notice')
  getPlanNoticeHandler = handlers[0]
})

describe('getPlanNotice — team-member gate', () => {
  it('rejects an unauthenticated caller without reading tier limits', async () => {
    hoisted.mockRequireAuth.mockRejectedValueOnce(new Error('Authentication required'))

    await expect(getPlanNoticeHandler()).rejects.toThrow(/auth/i)

    expect(hoisted.mockRequireAuth).toHaveBeenCalledWith(
      expect.objectContaining({ permission: PERMISSIONS.MEMBER_VIEW })
    )
    expect(hoisted.mockGetTierLimits).not.toHaveBeenCalled()
  })

  it('refuses a portal-user caller', async () => {
    hoisted.mockRequireAuth.mockRejectedValueOnce(
      new Error('Access denied: Requires [admin, member], got user')
    )

    await expect(getPlanNoticeHandler()).rejects.toThrow(/denied/i)

    expect(hoisted.mockGetTierLimits).not.toHaveBeenCalled()
  })

  it('returns the notice for a team member', async () => {
    hoisted.mockRequireAuth.mockResolvedValueOnce({
      user: { id: 'usr_member' },
      principal: { id: 'prn_member', role: 'member' },
    })
    const notice = {
      label: 'Pro',
      message: 'Renewal due',
      actionUrl: 'https://example.com/billing',
    }
    hoisted.mockGetTierLimits.mockResolvedValueOnce({ notice })

    await expect(getPlanNoticeHandler()).resolves.toEqual(notice)
  })
})

/**
 * The second source. A workspace running a trial has a countdown to show, and
 * it is derived from the trial rather than stored anywhere, so it appears and
 * expires with the trial and leaves nothing behind to clear.
 */
describe('getPlanNotice — the trial countdown', () => {
  const STARTED = '2026-03-01T00:00:00.000Z'
  const ENDS = '2026-03-15T00:00:00.000Z'
  const DURING = new Date('2026-03-10T00:00:00.000Z')
  const AFTER = new Date('2026-03-20T00:00:00.000Z')

  const limits = {
    maxBoards: 25,
    maxPosts: 1_000,
    maxTeamSeats: 10,
    maxStatusComponents: 25,
    maxCustomRoles: 5,
    maxSendingDomains: 3,
    aiTokensPerMonth: 100_000,
    apiRequestsPerMonth: 100_000,
    apiRequestsPerMinute: 600,
  }

  const trialing: StoredCloudConfig = {
    enabled: true,
    projection: {
      version: 1,
      effectivePlan: 'pro',
      trialStartedAt: STARTED,
      trialExpiresAt: ENDS,
      subscriptionStatus: null,
      entitlements: {},
      freeLimits: limits,
      planLimits: limits,
      planLimitsExpireAt: ENDS,
      canUpgrade: true,
      canManageBilling: false,
      renewalAt: null,
      cancellationAt: null,
    },
  }

  function asTeamMember(): void {
    hoisted.mockRequireAuth.mockResolvedValue({
      user: { id: 'usr_member' },
      principal: { id: 'prn_member', role: 'member' },
    })
  }

  beforeEach(() => {
    // Every fixture here is a fixed past instant, so nothing is decided by
    // when this suite happens to run and nothing rots when a date passes.
    vi.useFakeTimers()
    vi.setSystemTime(DURING)
    asTeamMember()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts down while the trial is running', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { cloud: trialing } })
    await expect(getPlanNoticeHandler()).resolves.toEqual(
      expect.objectContaining({ label: 'Business trial', expiresAt: ENDS })
    )
  })

  it('re-reads cloud config after reporting a starter trial', async () => {
    const preTrial = {
      ...trialing,
      projection: {
        ...trialing.projection,
        trialStartedAt: null,
        trialExpiresAt: null,
        planLimitsExpireAt: null,
      },
    }
    hoisted.mockGetWorkspaceSettings
      .mockResolvedValueOnce({ settings: { cloud: preTrial } })
      .mockResolvedValueOnce({ settings: { cloud: trialing } })
    await expect(getPlanNoticeHandler()).resolves.toEqual(
      expect.objectContaining({ label: 'Business trial', expiresAt: ENDS })
    )
  })

  it('keeps a persistent ended banner after expiry', async () => {
    vi.setSystemTime(AFTER)
    hoisted.mockFetchCatalogue.mockResolvedValue({ lastTrialPlanId: 'pro' })
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { cloud: trialing } })
    await expect(getPlanNoticeHandler()).resolves.toEqual(
      expect.objectContaining({
        label: 'Business trial ended',
        ended: true,
        actionLabel: 'Update billing',
      })
    )
  })

  it('still shows the ended banner more than seven days later', async () => {
    vi.setSystemTime(new Date('2026-03-23T00:00:00.000Z'))
    hoisted.mockFetchCatalogue.mockResolvedValue({ lastTrialPlanId: 'pro' })
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { cloud: trialing } })
    await expect(getPlanNoticeHandler()).resolves.toEqual(
      expect.objectContaining({
        label: 'Business trial ended',
        ended: true,
        actionLabel: 'Update billing',
      })
    )
  })

  it('never talks over a self-host operator notice', async () => {
    const notice = { label: 'Scheduled maintenance', message: 'Back at 09:00 UTC' }
    hoisted.mockGetTierLimits.mockResolvedValue({ notice })
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      settings: { cloud: { ...trialing, enabled: false } },
    })
    await expect(getPlanNoticeHandler()).resolves.toEqual(notice)
  })

  it('does not let a leftover Free trial strip talk over a complimentary grant', async () => {
    hoisted.mockGetTierLimits.mockResolvedValue({
      notice: {
        label: 'Free trial',
        expiresAt: '2026-08-30T09:36:53.964Z',
        actionUrl: 'https://app.quackback.io/dashboard/org_x/choose-plan',
        actionLabel: 'Choose your plan',
      },
    })
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      settings: {
        cloud: {
          enabled: true,
          projection: {
            version: 7,
            effectivePlan: 'scale',
            trialStartedAt: null,
            trialExpiresAt: null,
            subscriptionStatus: null,
            entitlements: { customDomain: true },
            freeLimits: limits,
            planLimits: limits,
            planLimitsExpireAt: '2026-09-30T23:33:31.110Z',
            canUpgrade: true,
            canManageBilling: true,
            renewalAt: null,
            cancellationAt: '2026-09-30T23:33:31.110Z',
          },
        },
      },
    })
    await expect(getPlanNoticeHandler()).resolves.toBeNull()
  })

  it('says nothing on an install with no cloud config', async () => {
    // The self-hosted case: the same code path, and no banner at any point in
    // time, whatever the row happens to contain.
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      settings: { cloud: { ...trialing, enabled: false } },
    })
    await expect(getPlanNoticeHandler()).resolves.toBeNull()

    hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { cloud: null } })
    await expect(getPlanNoticeHandler()).resolves.toBeNull()
  })
})
