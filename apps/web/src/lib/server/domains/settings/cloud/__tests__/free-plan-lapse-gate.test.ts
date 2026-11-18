/**
 * A lapse seen through the gate callers use (`requireEntitlement`), from the
 * stored settings row: once a projection's access window ends, the Free
 * plan's grants still pass and paid ones refuse; before it ends, the paid
 * plan's grants all pass; with no billing projection everything passes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingProjection } from '../billing-projection'
import { ENTITLEMENT_KEYS, PLAN_CATALOGUE } from '../cloud.types'

const hoisted = vi.hoisted(() => ({ getWorkspaceSettings: vi.fn() }))

vi.mock('../../settings.service', () => ({
  getWorkspaceSettings: hoisted.getWorkspaceSettings,
}))

const LIMITS = {
  maxBoards: 25,
  maxPosts: null,
  maxTeamSeats: 10,
  maxStatusComponents: 10,
  maxCustomRoles: 5,
  maxSendingDomains: 1,
  aiTokensPerMonth: null,
  emailsPerMonth: null,
  maxInboundEmailAddresses: null,
  maxHelpCenterLocales: null,
  maxStatusSubscribers: null,
  apiRequestsPerMonth: null,
  apiRequestsPerMinute: null,
}

const EXPIRES_AT = '2026-08-15T00:00:00.000Z'

const PROJECTION: BillingProjection = {
  version: 7,
  effectivePlan: 'pro',
  trialStartedAt: '2026-08-01T00:00:00.000Z',
  trialExpiresAt: EXPIRES_AT,
  subscriptionStatus: null,
  entitlements: Object.fromEntries(PLAN_CATALOGUE.pro.grants.map((grant) => [grant, true])),
  freeLimits: { ...LIMITS, maxBoards: 1 },
  planLimits: LIMITS,
  planLimitsExpireAt: EXPIRES_AT,
  canUpgrade: true,
  canManageBilling: true,
  renewalAt: null,
  cancellationAt: null,
}

function storeRow(cloud: unknown) {
  hoisted.getWorkspaceSettings.mockResolvedValue({ settings: { id: 'ws_1', cloud } })
}

async function gate(key: (typeof ENTITLEMENT_KEYS)[number]): Promise<boolean> {
  const { requireEntitlement } = await import('../entitlements')
  return requireEntitlement(key).then(
    () => true,
    () => false
  )
}

describe('the entitlement gate across a lapse', () => {
  beforeEach(() => {
    vi.resetModules()
    hoisted.getWorkspaceSettings.mockReset()
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes the Free grants and refuses the paid ones from the instant access ends', async () => {
    vi.setSystemTime(new Date(EXPIRES_AT))
    storeRow({ enabled: true, projection: PROJECTION })
    for (const key of ENTITLEMENT_KEYS) {
      expect(await gate(key), key).toBe(PLAN_CATALOGUE.free.grants.includes(key))
    }
    expect(await gate('aiDrafts')).toBe(true)
    expect(await gate('apiAccess')).toBe(true)
    expect(await gate('webhooks')).toBe(false)
  })

  it('keeps every grant of the paid plan until the last millisecond of access', async () => {
    vi.setSystemTime(new Date(Date.parse(EXPIRES_AT) - 1))
    storeRow({ enabled: true, projection: PROJECTION })
    for (const key of ENTITLEMENT_KEYS) {
      expect(await gate(key), key).toBe(PLAN_CATALOGUE.pro.grants.includes(key))
    }
  })

  it('grants everything when the workspace has no billing projection', async () => {
    vi.setSystemTime(new Date(EXPIRES_AT))
    storeRow(null)
    for (const key of ENTITLEMENT_KEYS) expect(await gate(key), key).toBe(true)
  })
})
