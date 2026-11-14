import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { EMAIL_SENDING_PERMISSION } from '@/lib/shared/email-sending-permissions'

const SUMMARIES = { sending: [], signIn: [], helpCenterDomain: null }
const loadDomainSummaries = vi.fn()
const CONFIG_QUERY = { queryKey: ['email-channel-config'] }

vi.mock('../domain-summaries', () => ({ loadDomainSummaries }))
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
})

describe('domain page loader', () => {
  it('reads the email config for a viewer who manages email sending', async () => {
    const context = {
      permissions: [EMAIL_SENDING_PERMISSION],
      cloudEnabled: false,
      queryClient,
    }
    await expect(loadDomainPage(context)).resolves.toBe(SUMMARIES)
    expect(loadDomainSummaries).toHaveBeenCalledWith(context)
    expect(prefetchQuery).toHaveBeenCalledWith(CONFIG_QUERY)
  })

  it('leaves the email config alone for a viewer who cannot read it', async () => {
    await loadDomainPage({
      permissions: [PERMISSIONS.AUTH_MANAGE, PERMISSIONS.SETTINGS_CUSTOM_DOMAIN],
      cloudEnabled: false,
      queryClient,
    })
    expect(prefetchQuery).not.toHaveBeenCalled()
  })
})
