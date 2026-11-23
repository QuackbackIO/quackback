// @vitest-environment happy-dom
/**
 * Settings > Portal: the Design tab is a summary of what is live that leads
 * to Customise (no drafts, no save bar), beside the Custom domains tab, each
 * shown only to a viewer with its permission.
 */
import { act, type ComponentType, type ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { summaryRows, rootContext, router, customDomainReads } = vi.hoisted(() => ({
  summaryRows: { labels: [] as string[] },
  router: {
    search: {} as { tab?: string },
  },
  customDomainReads: { count: 0, cloud: [] as boolean[] },
  rootContext: {
    settings: { name: 'Acme', featureFlags: { feedback: true, changelog: true } },
    session: null,
    permissions: ['settings.branding', 'settings.manage'] as string[],
    cloudEnabled: false,
    sectionDomainsCloud: false,
  },
}))

const { portalTabsFor } = await vi.hoisted(() => import('@/lib/shared/portal-settings-tabs'))

vi.mock('@tanstack/react-router', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return {
    ...actual,
    createFileRoute: () => (options: Record<string, unknown>) => ({
      options,
      useLoaderData: () => ({ tabs: portalTabsFor(rootContext.permissions) }),
      useSearch: () => router.search,
      useNavigate: () => vi.fn(),
    }),
    useRouteContext: ({ select }: { select: (context: typeof rootContext) => unknown }) =>
      select(rootContext),
    useSearch: () => router.search,
    Link: ({
      children,
      to: _to,
      search: _search,
      replace: _replace,
      ...rest
    }: {
      children: ReactNode
      to?: string
      search?: unknown
      replace?: boolean
    }) => (
      <a href="#tab" {...rest}>
        {children}
      </a>
    ),
  }
})

// The Custom domains tab: which way it was opened is all this page needs of it.
vi.mock('@/components/admin/settings/portal-custom-domains-tab', () => ({
  default: ({ cloud }: { cloud: boolean }) => (
    <div data-cloud={String(cloud)}>Custom domains tab</div>
  ),
}))

vi.mock('@/lib/client/queries/portal-custom-domains', () => ({
  portalCustomDomainsQueries: {
    tab: (cloud: boolean) => ({
      queryKey: ['settings', 'portal-custom-domains', cloud],
      staleTime: 30_000,
      queryFn: async () => {
        customDomainReads.count++
        customDomainReads.cloud.push(cloud)
        return { sectionDomains: null, operator: null }
      },
    }),
  },
}))

// The summary card: its thumbnail is an iframe of the live portal.
vi.mock('@/components/admin/settings/portal-customise/summary-card', () => ({
  PortalSummaryCard: ({ summary }: { summary: { label: string }[] }) => {
    summaryRows.labels = summary.map((row) => row.label)
    return (
      <section data-testid="portal-summary">
        <a href="/admin/settings/portal/customise">Customise</a>
      </section>
    )
  },
}))

const { Route } = await import('@/routes/admin/settings.portal')
const PortalPage = (Route as unknown as { options: { component: ComponentType } }).options.component

function seededClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['settings', 'branding'], { themeMode: 'user' })
  queryClient.setQueryData(['settings', 'logo'], { url: null })
  queryClient.setQueryData(['settings', 'headerLogo'], null)
  queryClient.setQueryData(['settings', 'customCss'], '')
  queryClient.setQueryData(['settings', 'portalConfig', 'page'], {})
  return queryClient
}

afterEach(() => {
  summaryRows.labels = []
  document.body.innerHTML = ''
  rootContext.permissions = ['settings.branding', 'settings.manage']
  router.search = {}
})

describe('portal settings page', () => {
  async function hydratePage() {
    const html = renderToString(
      <IntlProvider locale="en" defaultLocale="en">
        <QueryClientProvider client={seededClient()}>
          <PortalPage />
        </QueryClientProvider>
      </IntlProvider>
    )
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)

    await act(async () => {
      hydrateRoot(
        container,
        <IntlProvider locale="en" defaultLocale="en">
          <QueryClientProvider client={seededClient()}>
            <PortalPage />
          </QueryClientProvider>
        </IntlProvider>
      )
    })

    return container
  }

  it('shows what is live and the way into Customise, with nothing to save', async () => {
    const container = await hydratePage()
    expect(container.querySelector('[data-testid="portal-summary"]')).toBeTruthy()
    expect(summaryRows.labels.length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Customise' })).toHaveAttribute(
      'href',
      '/admin/settings/portal/customise'
    )
    expect(container.querySelector('[data-slot="draft-bar"]')).toBeNull()
    expect(container).toHaveTextContent('Workspace name')
  })

  it('gives settings.branding alone the same summary', async () => {
    rootContext.permissions = ['settings.branding']
    const container = await hydratePage()
    expect(container.querySelector('[data-testid="portal-summary"]')).toBeTruthy()
  })

  it('shows no tab bar to a viewer without settings.custom_domain', async () => {
    const container = await hydratePage()
    expect(container.querySelector('nav[aria-label="Portal"]')).toBeNull()
    expect(container).not.toHaveTextContent('Custom domains')
  })

  it('shows Design and Custom domains tabs to a viewer with settings.custom_domain', async () => {
    rootContext.permissions = ['settings.branding', 'settings.manage', 'settings.custom_domain']
    const container = await hydratePage()
    const bar = container.querySelector('nav[aria-label="Portal"]')
    expect(bar?.textContent).toBe('DesignCustom domains')
    // Design is open: its summary is on the page.
    expect(container.querySelector('[data-testid="portal-summary"]')).toBeTruthy()
  })

  it('reads the Custom domains tab ahead when the pointer or focus reaches its tab', async () => {
    rootContext.permissions = ['settings.branding', 'settings.manage', 'settings.custom_domain']
    customDomainReads.count = 0
    render(
      <IntlProvider locale="en" defaultLocale="en">
        <QueryClientProvider client={seededClient()}>
          <PortalPage />
        </QueryClientProvider>
      </IntlProvider>
    )
    expect(customDomainReads.count).toBe(0)
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Custom domains' }))
    await vi.waitFor(() => expect(customDomainReads.count).toBe(1))
    // Reaching it again reads nothing new.
    fireEvent.focus(screen.getByRole('link', { name: 'Custom domains' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(customDomainReads.count).toBe(1)
    // Design has nothing to read ahead.
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Design' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(customDomainReads.count).toBe(1)
  })

  it('loads the Custom domains tab the Cloud way on a pooled workspace whose projection has not landed', async () => {
    customDomainReads.cloud = []
    const loader = (
      Route as unknown as {
        options: { loader: (args: Record<string, unknown>) => Promise<unknown> }
      }
    ).options.loader
    await loader({
      context: {
        queryClient: seededClient(),
        permissions: ['settings.custom_domain'],
        billingEnabled: false,
        cloudEnabled: false,
        sectionDomainsCloud: true,
      },
      location: { search: { tab: 'custom-domains' } },
    })
    expect(customDomainReads.cloud).toEqual([true])
  })

  it('sets up section domains the Cloud way on a pooled workspace whose projection has not landed', async () => {
    // Billing is not on yet (cloudEnabled false), but the workspace is on
    // Cloud's fleet: the tab must never offer the self-hosted record and check.
    rootContext.permissions = ['settings.branding', 'settings.manage', 'settings.custom_domain']
    rootContext.cloudEnabled = false
    rootContext.sectionDomainsCloud = true
    customDomainReads.cloud = []
    try {
      const page = () => (
        <IntlProvider locale="en" defaultLocale="en">
          <QueryClientProvider client={seededClient()}>
            <PortalPage />
          </QueryClientProvider>
        </IntlProvider>
      )
      const { rerender } = render(page())
      // Read ahead the Cloud way...
      fireEvent.mouseEnter(screen.getByRole('link', { name: 'Custom domains' }))
      await vi.waitFor(() => expect(customDomainReads.cloud).toEqual([true]))
      // ...and opened the Cloud way.
      router.search = { tab: 'custom-domains' }
      rerender(page())
      const tab = await screen.findByText('Custom domains tab')
      expect(tab.getAttribute('data-cloud')).toBe('true')
    } finally {
      rootContext.sectionDomainsCloud = false
      router.search = {}
    }
  })
})
