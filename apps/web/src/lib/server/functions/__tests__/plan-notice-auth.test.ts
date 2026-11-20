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
  mockWarn: vi.fn(),
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ warn: hoisted.mockWarn, debug: vi.fn(), error: vi.fn() }) },
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.mockGetWorkspaceSettings,
}))

// The real helpers, with the session read standing in: the double honours a
// requested permission and a dashboard-only permission, as requireAuth does,
// so a gate that asks for member.view refuses a caller without it.
vi.mock('@/lib/server/functions/auth-helpers', async (original) => ({
  ...(await original<typeof import('@/lib/server/functions/auth-helpers')>()),
  requireAuth: async (options?: { permission?: string }) => {
    const auth = await hoisted.mockRequireAuth(options)
    if (
      options?.permission &&
      (auth.scope !== 'dashboard' || !auth.permissions?.includes(options.permission))
    ) {
      throw new Error(`Access denied: Requires permission '${options.permission}'`)
    }
    return auth
  },
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

describe('getPlanNotice — a failed read', () => {
  it('logs a warning and still fails, so the layout can show no notice', async () => {
    hoisted.mockRequireAuth.mockResolvedValueOnce({
      user: { id: 'usr_admin' },
      principal: { id: 'prn_admin', role: 'admin' },
      permissions: [PERMISSIONS.MEMBER_VIEW],
      scope: 'dashboard',
    })
    const failure = new Error('settings read failed')
    hoisted.mockGetTierLimits.mockRejectedValueOnce(failure)

    await expect(getPlanNoticeHandler()).rejects.toThrow('settings read failed')

    expect(hoisted.mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure }),
      expect.any(String)
    )
  })

  it('does not log a refused caller', async () => {
    hoisted.mockRequireAuth.mockRejectedValueOnce(new Error('Access denied: Not a team member'))

    await expect(getPlanNoticeHandler()).rejects.toThrow(/denied/i)

    expect(hoisted.mockWarn).not.toHaveBeenCalled()
  })
})

describe('getPlanNotice — team-member gate', () => {
  it('rejects an unauthenticated caller without reading tier limits', async () => {
    hoisted.mockRequireAuth.mockRejectedValueOnce(new Error('Authentication required'))

    await expect(getPlanNoticeHandler()).rejects.toThrow(/auth/i)

    expect(hoisted.mockGetTierLimits).not.toHaveBeenCalled()
  })

  it('refuses a portal user, and a teammate on a portal session, reading nothing', async () => {
    hoisted.mockRequireAuth.mockResolvedValueOnce({
      user: { id: 'usr_portal' },
      principal: { id: 'prn_portal', role: 'user' },
      permissions: [],
      scope: 'dashboard',
    })
    await expect(getPlanNoticeHandler()).rejects.toThrow(/denied/i)

    hoisted.mockRequireAuth.mockResolvedValueOnce({
      user: { id: 'usr_member' },
      principal: { id: 'prn_member', role: 'member' },
      permissions: [],
      scope: 'portal',
    })
    await expect(getPlanNoticeHandler()).rejects.toThrow(/denied/i)

    expect(hoisted.mockGetTierLimits).not.toHaveBeenCalled()
    expect(hoisted.mockGetWorkspaceSettings).not.toHaveBeenCalled()
  })

  it('returns the operator notice for a team member who can view members', async () => {
    hoisted.mockRequireAuth.mockResolvedValueOnce({
      user: { id: 'usr_member' },
      principal: { id: 'prn_member', role: 'member' },
      permissions: [PERMISSIONS.MEMBER_VIEW],
      scope: 'dashboard',
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
      effectivePlan: 'business',
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
      permissions: [PERMISSIONS.MEMBER_VIEW],
      scope: 'dashboard',
    })
  }

  function asBillingManager(): void {
    hoisted.mockRequireAuth.mockResolvedValue({
      user: { id: 'usr_admin' },
      principal: { id: 'prn_admin', role: 'admin' },
      permissions: [PERMISSIONS.MEMBER_VIEW, PERMISSIONS.BILLING_MANAGE],
      scope: 'dashboard',
    })
  }

  /** A custom role that can work the inbox, but neither view members nor manage billing. */
  function asCustomRole(extra: string[] = []): void {
    hoisted.mockRequireAuth.mockResolvedValue({
      user: { id: 'usr_custom' },
      principal: { id: 'prn_custom', role: 'admin' },
      permissions: [PERMISSIONS.CONVERSATION_VIEW, PERMISSIONS.POST_VIEW_PRIVATE, ...extra],
      scope: 'dashboard',
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
    asBillingManager()
    hoisted.mockFetchCatalogue.mockResolvedValue({ lastTrialPlanId: 'business' })
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { cloud: trialing } })
    await expect(getPlanNoticeHandler()).resolves.toEqual(
      expect.objectContaining({
        label: 'Business trial ended',
        ended: true,
        actionLabel: 'Compare plans',
      })
    )
  })

  it('tells a teammate who cannot manage billing, without a button they could not use', async () => {
    vi.setSystemTime(AFTER)
    hoisted.mockFetchCatalogue.mockResolvedValue({ lastTrialPlanId: 'business' })
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { cloud: trialing } })
    const notice = await getPlanNoticeHandler()
    expect(notice).toEqual(
      expect.objectContaining({
        label: 'Business trial ended',
        ended: true,
        message: expect.stringMatching(/Ask someone who manages billing to upgrade/),
      })
    )
    expect(notice).not.toHaveProperty('actionUrl')
    expect(notice).not.toHaveProperty('choiceDueAt')
  })

  it('still shows the ended banner more than seven days later', async () => {
    vi.setSystemTime(new Date('2026-03-23T00:00:00.000Z'))
    asBillingManager()
    hoisted.mockFetchCatalogue.mockResolvedValue({ lastTrialPlanId: 'business' })
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { cloud: trialing } })
    await expect(getPlanNoticeHandler()).resolves.toEqual(
      expect.objectContaining({
        label: 'Business trial ended',
        ended: true,
        actionLabel: 'Compare plans',
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

  describe('for a teammate without member.view', () => {
    it('shows the ended strip with only the plan, the date and the ask, and no link', async () => {
      vi.setSystemTime(AFTER)
      asCustomRole()
      hoisted.mockFetchCatalogue.mockResolvedValue({ lastTrialPlanId: 'business' })
      hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { cloud: trialing } })

      const notice = await getPlanNoticeHandler()

      expect(notice).toEqual({
        label: 'Business trial ended',
        expiresAt: ENDS,
        ended: true,
        message: 'Ask someone who manages billing to upgrade. Until then, Free limits apply.',
      })
      expect(JSON.stringify(notice)).not.toMatch(/member|seat|principal|\/admin/i)
    })

    it('offers a billing manager Compare plans, to billing', async () => {
      vi.setSystemTime(AFTER)
      asCustomRole([PERMISSIONS.BILLING_MANAGE])
      hoisted.mockFetchCatalogue.mockResolvedValue({ lastTrialPlanId: 'business' })
      hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { cloud: trialing } })

      await expect(getPlanNoticeHandler()).resolves.toEqual({
        label: 'Business trial ended',
        expiresAt: ENDS,
        ended: true,
        message: 'Upgrade to Business to keep everything, or downgrade to Free.',
        actionUrl: '/admin/settings/billing',
        actionLabel: 'Compare plans',
      })
    })

    it('counts down a running trial without a billing link it could not open', async () => {
      asCustomRole()
      hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { cloud: trialing } })

      const notice = await getPlanNoticeHandler()

      expect(notice).toEqual(expect.objectContaining({ label: 'Business trial', expiresAt: ENDS }))
      expect(notice).not.toHaveProperty('actionUrl')
      expect(notice).not.toHaveProperty('actionLabel')
    })

    it('shows nothing on an install with no plan billing, even with an operator notice', async () => {
      vi.setSystemTime(AFTER)
      asCustomRole([PERMISSIONS.BILLING_MANAGE])
      hoisted.mockGetTierLimits.mockResolvedValue({
        notice: { label: 'Scheduled maintenance', message: 'Back at 09:00 UTC' },
      })
      hoisted.mockGetWorkspaceSettings.mockResolvedValue({
        settings: { cloud: { ...trialing, enabled: false } },
      })
      await expect(getPlanNoticeHandler()).resolves.toBeNull()

      hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { cloud: null } })
      await expect(getPlanNoticeHandler()).resolves.toBeNull()
    })
  })
})
