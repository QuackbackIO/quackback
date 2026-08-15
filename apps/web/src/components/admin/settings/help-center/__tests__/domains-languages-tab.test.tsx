// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DomainsLanguagesTab } from '../domains-languages-tab'

const { mockBillingEnabled } = vi.hoisted(() => ({
  mockBillingEnabled: { current: false },
}))

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({ billingEnabled: mockBillingEnabled.current }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
}))

vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    helpCenterDomainStatus: () => ({ queryKey: ['hc-domain-status'] }),
    helpCenterRedirectRules: () => ({ queryKey: ['hc-redirects'] }),
  },
}))

vi.mock('@/lib/client/queries/help-center', () => ({
  helpCenterQueries: { categories: () => ({ queryKey: ['hc-cats'] }) },
}))

vi.mock('@/lib/client/mutations/settings', () => ({
  useUpdateHelpCenterSeo: () => ({ isPending: false, mutate: vi.fn() }),
  useUpdateHelpCenterDomain: () => ({ isPending: false, isError: false, mutate: vi.fn() }),
  useVerifyHelpCenterDomain: () => ({ isPending: false, mutate: vi.fn() }),
  useCreateHelpCenterRedirectRule: () => ({ isPending: false, isError: false, mutate: vi.fn() }),
  useDeleteHelpCenterRedirectRule: () => ({ isPending: false, mutate: vi.fn() }),
  useEnableHelpCenterLocale: () => ({ isPending: false, isError: false, mutate: vi.fn() }),
  useDisableHelpCenterLocale: () => ({ isPending: false, mutate: vi.fn() }),
  useUpdateHelpCenterLocaleChrome: () => ({ isPending: false, mutate: vi.fn() }),
  useUpdateHelpCenterAutoTranslate: () => ({ isPending: false, mutate: vi.fn() }),
}))

vi.mock('@/lib/server/functions/help-center', () => ({
  listArticlesFn: vi.fn(),
}))

const config = {
  domain: { domain: null, verifiedAt: null },
  seo: { indexable: false },
  locales: { default: 'en' as const, additional: [], chrome: {} },
  autoTranslate: { enabled: false, protectedTerms: [] },
}

describe('DomainsLanguagesTab', () => {
  afterEach(() => {
    mockBillingEnabled.current = false
    cleanup()
  })

  it('shows the local reverse-proxy writer when cloud is off', () => {
    mockBillingEnabled.current = false
    render(<DomainsLanguagesTab config={config} />)
    expect(screen.getByText('Custom domain')).toBeTruthy()
    expect(screen.getByText(/TLS terminates at your own reverse proxy/i)).toBeTruthy()
  })

  it('hides the local reverse-proxy writer when cloud is on', () => {
    mockBillingEnabled.current = true
    render(<DomainsLanguagesTab config={config} />)
    expect(screen.queryByText('Custom domain')).toBeNull()
    expect(screen.queryByText(/TLS terminates at your own reverse proxy/i)).toBeNull()
  })
})
