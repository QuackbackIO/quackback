/**
 * End-to-end proof of the plan gate at a real chokepoint.
 *
 * Custom domains were the one feature `tier_limits.features` declared and never
 * enforced, so this is the gate landing in a hole rather than layering over an
 * existing check. The path exercised here is the production one:
 *
 *   setHelpCenterDomain -> requireEntitlement -> getCloudConfig
 *     -> getTenantSettings -> resolveCloudConfig -> refuse or proceed
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { EntitlementRequiredError } from '@/lib/server/errors/entitlement-error'

const hoisted = vi.hoisted(() => ({
  mockGetTenantSettings: vi.fn(),
  mockUpdateHelpCenterConfig: vi.fn(),
  mockGetHelpCenterConfig: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getTenantSettings: hoisted.mockGetTenantSettings,
  getHelpCenterConfig: hoisted.mockGetHelpCenterConfig,
  updateHelpCenterConfig: hoisted.mockUpdateHelpCenterConfig,
}))

const { setHelpCenterDomain } = await import('../help-center-domain.service')

function withCloud(cloud: unknown) {
  hoisted.mockGetTenantSettings.mockResolvedValue({ settings: { id: 'ws_1', cloud } })
}

beforeEach(() => {
  hoisted.mockGetTenantSettings.mockReset()
  hoisted.mockUpdateHelpCenterConfig.mockReset()
  hoisted.mockUpdateHelpCenterConfig.mockResolvedValue({
    domain: { domain: 'help.acme.com', verifiedAt: null },
  })
})

describe('setHelpCenterDomain — unconfigured install', () => {
  it.each([
    ['no cloud config', null],
    ['an explicitly disabled block', { enabled: false, plan: 'free' }],
  ])('sets the domain with %s', async (_label, cloud) => {
    withCloud(cloud)
    await expect(setHelpCenterDomain('help.acme.com')).resolves.toEqual({
      domain: 'help.acme.com',
      verifiedAt: null,
    })
    expect(hoisted.mockUpdateHelpCenterConfig).toHaveBeenCalledOnce()
  })
})

describe('setHelpCenterDomain — plan gate', () => {
  it('refuses on a plan without the entitlement, and names the plan that has it', async () => {
    withCloud({ enabled: true, plan: 'free' })

    let caught: EntitlementRequiredError | null = null
    try {
      await setHelpCenterDomain('help.acme.com')
    } catch (err) {
      caught = err as EntitlementRequiredError
    }

    expect(caught).toBeInstanceOf(EntitlementRequiredError)
    // The bar: a refusal that says only "not allowed" fails. This one names it.
    expect(caught!.requiredPlanName).toBe('Pro')
    expect(caught!.message).toBe(
      'Custom domains is a Pro feature. Your workspace is on Free. Upgrade to Pro to enable it.'
    )
    // Nothing was written.
    expect(hoisted.mockUpdateHelpCenterConfig).not.toHaveBeenCalled()
  })

  it('maps to 402 through the plumbing that already exists', async () => {
    withCloud({ enabled: true, plan: 'free' })
    await expect(setHelpCenterDomain('help.acme.com')).rejects.toBeInstanceOf(TierLimitError)
  })

  it('allows the write on a plan that includes it', async () => {
    withCloud({ enabled: true, plan: 'pro' })
    await expect(setHelpCenterDomain('help.acme.com')).resolves.toBeDefined()
    expect(hoisted.mockUpdateHelpCenterConfig).toHaveBeenCalledOnce()
  })

  it('allows the write on a grandfathered override above the plan', async () => {
    withCloud({ enabled: true, plan: 'free', entitlements: { customDomain: true } })
    await expect(setHelpCenterDomain('help.acme.com')).resolves.toBeDefined()
  })

  it('still lets a downgraded workspace clear its domain', async () => {
    // Refusing this would strand the workspace on a domain it cannot manage.
    withCloud({ enabled: true, plan: 'free' })
    hoisted.mockUpdateHelpCenterConfig.mockResolvedValue({
      domain: { domain: null, verifiedAt: null },
    })
    await expect(setHelpCenterDomain(null)).resolves.toEqual({ domain: null, verifiedAt: null })
    await expect(setHelpCenterDomain('   ')).resolves.toEqual({ domain: null, verifiedAt: null })
  })
})
