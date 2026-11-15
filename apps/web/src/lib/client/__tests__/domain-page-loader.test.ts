import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { EMAIL_SENDING_PERMISSION } from '@/lib/shared/email-sending-permissions'

const SUMMARIES = { sending: [], signIn: [], helpCenterDomain: null, added: [] }
const DETAIL = { name: 'acme.io', added: true, inUse: false }
const loadDomainSummaries = vi.fn()
const getDomain = vi.fn()
const CONFIG_QUERY = { queryKey: ['email-channel-config'] }

vi.mock('../domain-summaries', () => ({ loadDomainSummaries }))
vi.mock('@/lib/server/functions/domains', () => ({ getDomainFn: getDomain }))
const getWebAddresses = vi.fn()
vi.mock('@/lib/server/functions/cloud-identity', () => ({
  getCloudCustomDomainsFn: getWebAddresses,
}))
vi.mock('@/lib/client/queries/channel-accounts', () => ({
  emailChannelConfigQuery: () => CONFIG_QUERY,
}))

const { loadDomainPage } = await import('../domain-page-loader')

const prefetchQuery = vi.fn()
const queryClient = { prefetchQuery } as unknown as QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  loadDomainSummaries.mockResolvedValue(SUMMARIES)
  prefetchQuery.mockResolvedValue(undefined)
  getDomain.mockResolvedValue(DETAIL)
})

describe('domain page loader', () => {
  it('reads the email config for a viewer who manages email sending', async () => {
    const context = {
      permissions: [EMAIL_SENDING_PERMISSION],
      cloudEnabled: false,
      queryClient,
    }
    await expect(loadDomainPage(context, 'acme.io')).resolves.toEqual({
      ...SUMMARIES,
      domain: DETAIL,
      webAddresses: [],
    })
    expect(loadDomainSummaries).toHaveBeenCalledWith(context)
    expect(getDomain).toHaveBeenCalledWith({ data: { name: 'acme.io' } })
    expect(prefetchQuery).toHaveBeenCalledWith(CONFIG_QUERY)
  })

  it('leaves the email config alone for a viewer who cannot read it', async () => {
    await loadDomainPage(
      {
        permissions: [PERMISSIONS.AUTH_MANAGE, PERMISSIONS.SETTINGS_CUSTOM_DOMAIN],
        cloudEnabled: false,
        queryClient,
      },
      'acme.io'
    )
    expect(prefetchQuery).not.toHaveBeenCalled()
  })

  it('still shows the uses when the domain itself cannot be read', async () => {
    getDomain.mockRejectedValue(new Error('down'))
    const result = await loadDomainPage(
      { permissions: [EMAIL_SENDING_PERMISSION], cloudEnabled: false, queryClient },
      'acme.io'
    )
    expect(result).toEqual({ ...SUMMARIES, domain: null, webAddresses: [] })
  })

  it("reads Cloud's web addresses for a viewer who manages custom domains", async () => {
    const WEB = [{ hostname: 'feedback.acme.io', readiness: 'pending' }]
    getWebAddresses.mockResolvedValue(WEB)
    const cloud = {
      permissions: [PERMISSIONS.SETTINGS_CUSTOM_DOMAIN],
      cloudEnabled: true,
      queryClient,
    }
    expect((await loadDomainPage(cloud, 'acme.io')).webAddresses).toEqual(WEB)

    getWebAddresses.mockClear()
    await loadDomainPage({ ...cloud, cloudEnabled: false }, 'acme.io')
    await loadDomainPage({ ...cloud, permissions: [PERMISSIONS.AUTH_MANAGE] }, 'acme.io')
    expect(getWebAddresses).not.toHaveBeenCalled()
  })

  it('still shows the page when the web addresses cannot be read', async () => {
    getWebAddresses.mockRejectedValue(new Error('down'))
    const result = await loadDomainPage(
      { permissions: [PERMISSIONS.SETTINGS_CUSTOM_DOMAIN], cloudEnabled: true, queryClient },
      'acme.io'
    )
    expect(result.webAddresses).toEqual([])
  })
})
