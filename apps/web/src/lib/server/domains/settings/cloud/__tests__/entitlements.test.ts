/**
 * The refusal must name the plan. A refusal that says only "not allowed" is
 * the failure this whole layer exists to fix, so the assertions below are
 * about the *content* of the refusal as much as the fact of it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { EntitlementRequiredError } from '@/lib/server/errors/entitlement-error'
import {
  DISABLED_CLOUD_CONFIG,
  ENTITLEMENTS,
  ENTITLEMENT_KEYS,
  PLAN_CATALOGUE,
  minimumPlanFor,
  type CloudConfig,
} from '../cloud.types'
import { buildRefusal, isEntitled } from '../entitlements'

const hoisted = vi.hoisted(() => ({ mockGetWorkspaceSettings: vi.fn() }))

vi.mock('../../settings.service', () => ({
  getWorkspaceSettings: hoisted.mockGetWorkspaceSettings,
}))

function cloud(overrides: Partial<CloudConfig>): CloudConfig {
  const config = { ...DISABLED_CLOUD_CONFIG, enabled: true, canUpgrade: true, ...overrides }
  if (overrides.entitlements === undefined && config.plan) {
    const grants = new Set(PLAN_CATALOGUE[config.plan].grants)
    config.entitlements = Object.fromEntries(ENTITLEMENT_KEYS.map((key) => [key, grants.has(key)]))
  }
  return config
}

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
}

function storedCloud(plan: 'free' | 'growth' | 'business' | 'enterprise') {
  const grants = new Set(PLAN_CATALOGUE[plan].grants)
  return {
    enabled: true,
    projection: {
      version: 1,
      effectivePlan: plan,
      trialStartedAt: null,
      trialExpiresAt: null,
      subscriptionStatus: null,
      entitlements: Object.fromEntries(ENTITLEMENT_KEYS.map((key) => [key, grants.has(key)])),
      freeLimits: LIMITS,
      planLimits: LIMITS,
      planLimitsExpireAt: null,
      canUpgrade: true,
      canManageBilling: false,
      renewalAt: null,
      cancellationAt: null,
    },
  }
}

describe('isEntitled', () => {
  it('grants what the plan grants', () => {
    const config = cloud({ plan: 'business' })
    expect(isEntitled(config, 'customDomain')).toBe(true)
    expect(isEntitled(config, 'workflows')).toBe(true)
  })

  it('denies what the plan does not grant', () => {
    const config = cloud({ plan: 'business' })
    expect(isEntitled(config, 'sso')).toBe(false)
    expect(isEntitled(config, 'auditLog')).toBe(false)
  })

  it('grants nothing on the free plan', () => {
    const config = cloud({ plan: 'free' })
    for (const key of ENTITLEMENT_KEYS) expect(isEntitled(config, key)).toBe(false)
  })

  it('lets an explicit override open a feature the plan does not include', () => {
    expect(isEntitled(cloud({ plan: 'free', entitlements: { sso: true } }), 'sso')).toBe(true)
  })

  it('lets an explicit override close a feature the plan does include', () => {
    expect(isEntitled(cloud({ plan: 'enterprise', entitlements: { sso: false } }), 'sso')).toBe(
      false
    )
  })

  it('denies everything when enabled with no plan (fail closed)', () => {
    const config = cloud({ plan: null })
    for (const key of ENTITLEMENT_KEYS) expect(isEntitled(config, key)).toBe(false)
  })

  it('still honours overrides when enabled with no plan', () => {
    expect(isEntitled(cloud({ plan: null, entitlements: { apiAccess: true } }), 'apiAccess')).toBe(
      true
    )
  })
})

describe('the refusal names the plan', () => {
  it('names the cheapest plan that would grant the feature', () => {
    const err = buildRefusal(cloud({ plan: 'free' }), 'customDomain')
    expect(err.requiredPlan).toBe('growth')
    expect(err.requiredPlanName).toBe('Pro')
    expect(err.currentPlan).toBe('free')
    expect(err.currentPlanName).toBe('Free')
    expect(err.message).toBe(
      'Custom domains are a Pro feature. Your workspace is on Free. Upgrade to Pro to enable it.'
    )
  })

  it('names the smallest sufficient upgrade, not the largest plan', () => {
    // The MCP server is included from the cheapest paid plan; the audit log
    // only from the dearest. A refusal that always pointed at the top plan
    // would over-sell and read as dishonest.
    expect(buildRefusal(cloud({ plan: 'free' }), 'mcpServer').requiredPlanName).toBe('Pro')
    expect(buildRefusal(cloud({ plan: 'free' }), 'auditLog').requiredPlanName).toBe('Enterprise')
  })

  it('does not invent an upsell when the workspace already has the plan', () => {
    // An explicit override denied a feature the top plan grants. Telling the
    // customer to upgrade to it would be nonsense.
    const err = buildRefusal(cloud({ plan: 'enterprise', entitlements: { sso: false } }), 'sso')
    expect(err.requiredPlan).toBeNull()
    expect(err.message).toBe(
      'Single sign-on is not included in your plan. Your workspace is on Enterprise. Contact us to enable it.'
    )
  })

  it('still names a plan when the workspace has none', () => {
    const err = buildRefusal(cloud({ plan: null }), 'workflows')
    expect(err.currentPlan).toBeNull()
    expect(err.requiredPlanName).toBe('Business')
    expect(err.message).toBe('Workflows are a Business feature. Upgrade to Business to enable it.')
  })

  it.each(ENTITLEMENT_KEYS.filter((key) => key !== 'hideBranding'))(
    '%s refuses with a nameable plan from the free tier',
    (key) => {
      const err = buildRefusal(cloud({ plan: 'free' }), key)
      // Every catalogue entry must be reachable by upgrading — an entitlement no
      // plan grants is a pricing bug, and this pins it at build time.
      const cheapest = minimumPlanFor(key)
      expect(cheapest).not.toBeNull()
      expect(err.requiredPlan).toBe(cheapest!.id)
      expect(err.message).toContain(ENTITLEMENTS[key].friendly)
      expect(err.message).toContain(PLAN_CATALOGUE[cheapest!.id].name)
    }
  )

  it('hideBranding has no plan; refusal degrades to contact us', () => {
    const err = buildRefusal(cloud({ plan: 'free' }), 'hideBranding')
    expect(minimumPlanFor('hideBranding')).toBeNull()
    expect(err.requiredPlan).toBeNull()
  })
})

describe('the refusal reuses the existing 402 plumbing', () => {
  it('is a TierLimitError, so every existing catch site maps it already', () => {
    const err = buildRefusal(cloud({ plan: 'free' }), 'webhooks')
    expect(err).toBeInstanceOf(EntitlementRequiredError)
    expect(err).toBeInstanceOf(TierLimitError)
    expect(err).toBeInstanceOf(Error)
    expect(err.statusCode).toBe(402)
    expect(err.code).toBe('TIER_LIMIT_EXCEEDED')
    expect(err.limit).toBe('entitlements.webhooks')
  })

  it('serialises a payload an upgrade prompt can render without extra lookups', () => {
    const err = buildRefusal(cloud({ plan: 'free' }), 'mcpServer')
    expect(err.toResponseBody()).toEqual({
      error: 'entitlement_required',
      limit: 'entitlements.mcpServer',
      entitlement: 'mcpServer',
      message:
        'The MCP server is a Pro feature. Your workspace is on Free. Upgrade to Pro to enable it.',
      currentPlan: 'free',
      currentPlanName: 'Free',
      requiredPlan: 'growth',
      requiredPlanName: 'Pro',
      upgradeUrl: '/admin/settings/billing',
    })
  })

  it('sends the refusal to the workspace billing page when no upgradeUrl is set', () => {
    const err = buildRefusal(cloud({ plan: 'free' }), 'apiAccess')
    expect(err.upgradeUrl).toBe('/admin/settings/billing')
  })

  it('does not invent an upgrade link when cloud is off', () => {
    const err = buildRefusal(DISABLED_CLOUD_CONFIG, 'apiAccess')
    expect(err.upgradeUrl).toBeUndefined()
  })
})

describe('requireEntitlement against a configured workspace', () => {
  beforeEach(() => {
    vi.resetModules()
    hoisted.mockGetWorkspaceSettings.mockReset()
  })

  it('refuses and names the plan', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      settings: { id: 'ws_1', cloud: storedCloud('free') },
    })
    const { requireEntitlement } = await import('../entitlements')
    await expect(requireEntitlement('customDomain')).rejects.toThrow(
      /Custom domains are a Pro feature/
    )
  })

  it('allows what the plan grants', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      settings: { id: 'ws_1', cloud: storedCloud('business') },
    })
    const { requireEntitlement } = await import('../entitlements')
    await expect(requireEntitlement('customDomain')).resolves.toBeUndefined()
  })

  it('resolves the level from the stored plan, not from a hand-built config', async () => {
    // Reads the plan out of a stored settings blob and refuses on it, so the
    // catalogue level is reached through the real resolution path rather than
    // asserted on a hand-built config object.
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      settings: { id: 'ws_1', cloud: storedCloud('growth') },
    })
    const { requireEntitlement } = await import('../entitlements')
    await expect(requireEntitlement('mcpServer')).resolves.toBeUndefined()
    await expect(requireEntitlement('aiInsights')).resolves.toBeUndefined()
    await expect(requireEntitlement('workflows')).rejects.toThrow(
      /Workflows are a Business feature. Your workspace is on Pro./
    )
  })

  it('reports the whole catalogue for a plan surface', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      settings: { id: 'ws_1', cloud: storedCloud('growth') },
    })
    const { listEntitlements } = await import('../entitlements')
    expect(await listEntitlements()).toEqual({
      customDomain: true,
      sso: false,
      aiAssistant: true,
      aiDrafts: true,
      aiInsights: true,
      workflows: false,
      apiAccess: true,
      mcpServer: true,
      webhooks: true,
      auditLog: false,
      hideBranding: false,
    })
  })

  it('reports a different set one plan up, so the surface is not a constant', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      settings: { id: 'ws_1', cloud: storedCloud('business') },
    })
    const { listEntitlements } = await import('../entitlements')
    expect(await listEntitlements()).toEqual({
      customDomain: true,
      sso: false,
      aiAssistant: true,
      aiDrafts: true,
      aiInsights: true,
      workflows: true,
      apiAccess: true,
      mcpServer: true,
      webhooks: true,
      auditLog: false,
      hideBranding: false,
    })
  })
})
