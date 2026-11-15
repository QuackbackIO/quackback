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
  mockSetSectionDomain: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.mockGetWorkspaceSettings,
}))

// The write itself (the help entry in the section map) is covered by the
// section domains database test; this file is about the gate in front of it.
vi.mock('@/lib/server/domains/settings/section-domains.service', () => ({
  setSectionDomain: hoisted.mockSetSectionDomain,
}))

const { setHelpCenterDomain } = await import('../help-center-domain.service')

function withCloud(cloud: unknown) {
  hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { id: 'ws_1', cloud } })
}

beforeEach(() => {
  hoisted.mockGetWorkspaceSettings.mockReset()
  hoisted.mockSetSectionDomain.mockReset()
  hoisted.mockSetSectionDomain.mockImplementation(
    async (_section: string, hostname: string | null) => ({
      ok: true,
      sectionDomains: hostname ? { help: { hostname, verifiedAt: null } } : {},
    })
  )
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
    expect(hoisted.mockSetSectionDomain).toHaveBeenCalledExactlyOnceWith('help', 'help.acme.com')
  })
})

describe('setHelpCenterDomain — cloud amputates the local writer', () => {
  it.each(['free', 'pro', 'business', 'enterprise'] as const)(
    'refuses the local reverse-proxy writer on cloud %s',
    async (plan) => {
      withCloud({ enabled: true, plan })
      await expect(setHelpCenterDomain('help.acme.com')).rejects.toMatchObject({
        code: HC_DOMAIN_CLOUD_MANAGED,
        statusCode: 403,
      })
      expect(hoisted.mockSetSectionDomain).not.toHaveBeenCalled()
    }
  )

  it('names the local writer so the refusal is distinguishable', async () => {
    withCloud({ enabled: true, plan: 'business' })
    await expect(setHelpCenterDomain('help.acme.com')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(setHelpCenterDomain('help.acme.com')).rejects.toThrow(
      'Cloud workspaces cannot use the local reverse-proxy domain writer.'
    )
  })

  it('still lets a cloud workspace clear a leftover domain', async () => {
    withCloud({ enabled: true, plan: 'free' })
    await expect(setHelpCenterDomain(null)).resolves.toEqual({ domain: null, verifiedAt: null })
    await expect(setHelpCenterDomain('   ')).resolves.toEqual({ domain: null, verifiedAt: null })
  })
})
