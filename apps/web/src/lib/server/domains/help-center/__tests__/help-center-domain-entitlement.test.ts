/**
 * End-to-end proof of the plan gate at a real chokepoint.
 *
 * Custom domains were the one feature `tier_limits.features` declared and never
 * enforced, so this is the gate landing in a hole rather than layering over an
 * existing check. The path exercised here is the production one:
 *
 *   setHelpCenterDomain -> requireEntitlement -> getCloudConfig
 *     -> getWorkspaceSettings -> resolveCloudConfig -> refuse or proceed
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenError } from '@/lib/shared/errors'
import { HC_DOMAIN_CLOUD_MANAGED } from '../help-center-domain.service'

const hoisted = vi.hoisted(() => ({
  mockGetWorkspaceSettings: vi.fn(),
  mockUpdateHelpCenterConfig: vi.fn(),
  mockGetHelpCenterConfig: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.mockGetWorkspaceSettings,
  getHelpCenterConfig: hoisted.mockGetHelpCenterConfig,
  updateHelpCenterConfig: hoisted.mockUpdateHelpCenterConfig,
}))

const { setHelpCenterDomain } = await import('../help-center-domain.service')

function withCloud(cloud: unknown) {
  hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { id: 'ws_1', cloud } })
}

beforeEach(() => {
  hoisted.mockGetWorkspaceSettings.mockReset()
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

describe('setHelpCenterDomain — cloud amputates the local writer', () => {
  it.each(['free', 'growth', 'pro', 'scale'] as const)(
    'refuses the local reverse-proxy writer on cloud %s',
    async (plan) => {
      withCloud({ enabled: true, plan })
      await expect(setHelpCenterDomain('help.acme.com')).rejects.toMatchObject({
        code: HC_DOMAIN_CLOUD_MANAGED,
        statusCode: 403,
      })
      expect(hoisted.mockUpdateHelpCenterConfig).not.toHaveBeenCalled()
    }
  )

  it('names the local writer so the refusal is distinguishable', async () => {
    withCloud({ enabled: true, plan: 'pro' })
    await expect(setHelpCenterDomain('help.acme.com')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(setHelpCenterDomain('help.acme.com')).rejects.toThrow(
      'Cloud workspaces cannot use the local reverse-proxy domain writer.'
    )
  })

  it('still lets a cloud workspace clear a leftover domain', async () => {
    withCloud({ enabled: true, plan: 'free' })
    hoisted.mockUpdateHelpCenterConfig.mockResolvedValue({
      domain: { domain: null, verifiedAt: null },
    })
    await expect(setHelpCenterDomain(null)).resolves.toEqual({ domain: null, verifiedAt: null })
    await expect(setHelpCenterDomain('   ')).resolves.toEqual({ domain: null, verifiedAt: null })
  })
})
