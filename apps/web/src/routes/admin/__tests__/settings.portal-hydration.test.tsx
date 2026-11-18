// @vitest-environment happy-dom
/**
 * The portal settings page holds its live preview iframe back until
 * hydration, and its welcome message editor reports its document once it
 * mounts. Neither may re-render the page: that repaints the theme controls,
 * the navigation editor and the welcome message editor for nothing.
 */
import { act, useEffect, type ComponentType, type ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { cardRenders, previewRenders, rootContext, router, customDomainReads } = vi.hoisted(() => ({
  cardRenders: new Map<string, number>(),
  previewRenders: { count: 0 },
  router: {
    search: {} as { tab?: string },
    blocker: null as null | { enableBeforeUnload: () => boolean },
  },
  customDomainReads: { count: 0, cloud: [] as boolean[] },
  rootContext: {
    settings: { name: 'Acme', featureFlags: { feedback: true, changelog: true } },
    session: null,
    permissions: ['settings.branding'] as string[],
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
    useRouter: () => ({ invalidate: vi.fn() }),
    useBlocker: (opts: { enableBeforeUnload: () => boolean }) => {
      router.blocker = opts
    },
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

// The Custom domains tab: leaving for another domain is all this page needs of it.
vi.mock('@/components/admin/settings/portal-custom-domains-tab', () => ({
  default: ({ onLeave, cloud }: { onLeave?: () => void; cloud: boolean }) => (
    <button type="button" onClick={onLeave} data-cloud={String(cloud)}>
      Leave for the new domain
    </button>
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

vi.mock('@/lib/client/mutations/settings', () => ({
  useUpdatePortalConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveBrandingTheme: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  useImageUpload: () => ({ upload: vi.fn() }),
}))

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({
    value,
    onDocumentChange,
  }: {
    value: unknown
    onDocumentChange: (document: { json(): unknown }) => void
  }) => {
    const report = (doc: unknown) => onDocumentChange({ json: () => doc })
    // The real editor reports its (unchanged) document once it has mounted.
    useEffect(() => report(JSON.parse(JSON.stringify(value))), [])
    return (
      <button
        data-testid="rich-text-editor"
        onClick={() =>
          report({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
          })
        }
      />
    )
  },
}))

vi.mock('@/components/admin/upgrade', () => ({ UpgradeModal: () => null }))

vi.mock('@/components/admin/settings/settings-card', () => ({
  SettingsCard: ({ title, children }: { title?: string; children?: ReactNode }) => {
    cardRenders.set(title ?? '', (cardRenders.get(title ?? '') ?? 0) + 1)
    return (
      <section>
        <h2>{title}</h2>
        {children}
      </section>
    )
  },
}))

vi.mock('@/components/admin/settings/branding/portal-preview', () => ({
  PortalPreview: () => {
    previewRenders.count++
    return <div data-testid="portal-preview" />
  },
}))

const { Route } = await import('@/routes/admin/settings.portal')
const PortalPage = (Route as unknown as { options: { component: ComponentType } }).options.component

function seededClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['settings', 'branding'], { themeMode: 'user' })
  queryClient.setQueryData(['settings', 'logo'], { url: null })
  queryClient.setQueryData(['settings', 'customCss'], '')
  queryClient.setQueryData(['settings', 'portalConfig'], {})
  return queryClient
}

afterEach(() => {
  cardRenders.clear()
  previewRenders.count = 0
  document.body.innerHTML = ''
  rootContext.permissions = ['settings.branding']
  router.search = {}
})

describe('portal settings page hydration', () => {
  async function hydratePage() {
    const html = renderToString(
      <IntlProvider locale="en" defaultLocale="en">
        <QueryClientProvider client={seededClient()}>
          <PortalPage />
        </QueryClientProvider>
      </IntlProvider>
    )
    expect(html).not.toContain('portal-preview')

    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)
    cardRenders.clear()

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

  it('renders each settings card once and mounts the preview after hydrating', async () => {
    const container = await hydratePage()

    expect(container.querySelector('[data-testid="portal-preview"]')).toBeTruthy()
    expect(previewRenders.count).toBe(1)

    expect([...cardRenders.keys()]).toEqual(['Appearance', 'Navigation', 'Welcome message'])
    for (const [title, renders] of cardRenders) {
      expect({ title, renders }).toEqual({ title, renders: 1 })
    }
    // Nothing is unsaved: the save bar stays hidden.
    expect(container.querySelector('[data-slot="draft-bar"]')).toBeNull()
  })

  it('takes an edit to the welcome message as an unsaved change', async () => {
    const container = await hydratePage()
    act(() => {
      fireEvent.click(container.querySelector('[data-testid="rich-text-editor"]')!)
    })
    expect(container.querySelector('[data-slot="draft-bar"]')).toBeTruthy()
  })

  it('shows no tab bar to a viewer without settings.custom_domain', async () => {
    const container = await hydratePage()
    expect(container.querySelector('nav[aria-label="Portal"]')).toBeNull()
    expect(container).not.toHaveTextContent('Custom domains')
  })

  it('shows Design and Custom domains tabs to a viewer with settings.custom_domain', async () => {
    rootContext.permissions = ['settings.branding', 'settings.custom_domain']
    const container = await hydratePage()
    const bar = container.querySelector('nav[aria-label="Portal"]')
    expect(bar?.textContent).toBe('DesignCustom domains')
    // Design is open: its cards are on the page.
    expect([...cardRenders.keys()]).toContain('Welcome message')
  })

  it('reads the Custom domains tab ahead when the pointer or focus reaches its tab', async () => {
    rootContext.permissions = ['settings.branding', 'settings.custom_domain']
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

  it('drops the unsaved-changes guard when the Custom domains tab leaves for another domain', async () => {
    rootContext.permissions = ['settings.branding', 'settings.custom_domain']
    const queryClient = seededClient()
    const page = () => (
      <IntlProvider locale="en" defaultLocale="en">
        <QueryClientProvider client={queryClient}>
          <PortalPage />
        </QueryClientProvider>
      </IntlProvider>
    )
    const { rerender } = render(page())
    act(() => {
      fireEvent.click(screen.getByTestId('rich-text-editor'))
    })
    expect(router.blocker?.enableBeforeUnload()).toBe(true)

    // The drafts wait on Design while the admin is on Custom domains.
    router.search = { tab: 'custom-domains' }
    rerender(page())
    expect(router.blocker?.enableBeforeUnload()).toBe(true)

    fireEvent.click(await screen.findByText('Leave for the new domain'))
    expect(router.blocker?.enableBeforeUnload()).toBe(false)
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
    rootContext.permissions = ['settings.branding', 'settings.custom_domain']
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
      const tab = await screen.findByText('Leave for the new domain')
      expect(tab.getAttribute('data-cloud')).toBe('true')
    } finally {
      rootContext.sectionDomainsCloud = false
      router.search = {}
    }
  })
})
