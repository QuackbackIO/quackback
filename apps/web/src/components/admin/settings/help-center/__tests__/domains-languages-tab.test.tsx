// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { ReactNode } from 'react'
import { DomainsLanguagesTab } from '../domains-languages-tab'
import { DEFAULT_HELP_CENTER_CONFIG } from '@/lib/server/domains/settings/settings.types'

vi.mock('@/components/admin/settings/section-domain-card', () => ({
  SectionDomainSettingsCard: ({ section }: { section: string }) => (
    <div data-testid="section-domain">{section}</div>
  ),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
}))

vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    helpCenterRedirectRules: () => ({ queryKey: ['hc-redirects'] }),
  },
}))

vi.mock('@/lib/client/queries/help-center', () => ({
  helpCenterQueries: { categories: () => ({ queryKey: ['hc-cats'] }) },
}))

vi.mock('@/lib/client/mutations/settings', () => ({
  useUpdateHelpCenterSeo: () => ({ isPending: false, mutate: vi.fn() }),
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
  ...DEFAULT_HELP_CENTER_CONFIG,
  domain: { domain: null, verifiedAt: null },
  seo: { ...DEFAULT_HELP_CENTER_CONFIG.seo, indexable: false },
}

const inEnglish = {
  wrapper: ({ children }: { children: ReactNode }) => (
    <IntlProvider locale="en">{children}</IntlProvider>
  ),
}

describe('DomainsLanguagesTab', () => {
  afterEach(cleanup)

  it("shows the help center's custom domain read-only, set on Settings > Portal", () => {
    render(<DomainsLanguagesTab config={config} />, inEnglish)
    expect(screen.getByTestId('section-domain')).toHaveTextContent('help')
    expect(screen.queryByLabelText('Domain')).toBeNull()
    expect(screen.queryByText(/TLS terminates at your own reverse proxy/i)).toBeNull()
  })

  it('names the main language, set on Settings > General, in place of a fixed default row', () => {
    render(
      <DomainsLanguagesTab
        config={{ ...config, locales: { default: 'de', additional: ['en'], chrome: {} } }}
      />,
      inEnglish
    )
    const row = screen.getByTestId('hc-main-language')
    expect(row).toHaveTextContent('German')
    expect(row).toHaveTextContent('Main language')
    expect(screen.getByRole('link', { name: 'Change in General' })).toHaveAttribute(
      'href',
      '/admin/settings/general'
    )
    expect(screen.queryByText('Default')).toBeNull()
  })
})
