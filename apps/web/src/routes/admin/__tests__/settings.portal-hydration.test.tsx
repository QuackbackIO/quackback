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
  customDomainReads: { count: 0 },
  rootContext: {
    settings: { name: 'Acme', featureFlags: { feedback: true, changelog: true } },
    session: null,
    permissions: ['settings.branding'] as string[],
  },
}))

vi.mock('@tanstack/react-router', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return {
    ...actual,
    createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
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
    }) => <a {...rest}>{children}</a>,
  }
})

// The Custom domains tab: leaving for another domain is all this page needs of it.
vi.mock('@/components/admin/settings/portal-custom-domains-tab', () => ({
  default: ({ onLeave }: { onLeave?: () => void }) => (
    <button type="button" onClick={onLeave}>
      Leave for the new domain
    </button>
  ),
}))

vi.mock('@/lib/client/queries/portal-custom-domains', () => ({
  portalCustomDomainsQuery: (cloud: boolean) => ({
    queryKey: ['settings', 'portal-custom-domains', cloud],
    staleTime: 30_000,
    queryFn: async () => {
      customDomainReads.count++
      return { sectionDomains: null, operator: null }
    },
  }),
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

  it('shows Navigation and Custom domains tabs to a viewer with settings.custom_domain', async () => {
    rootContext.permissions = ['settings.branding', 'settings.custom_domain']
    try {
      const container = await hydratePage()
      const bar = container.querySelector('nav[aria-label="Portal"]')
      expect(bar?.textContent).toBe('NavigationCustom domains')
      // Navigation is open: its cards are on the page.
      expect([...cardRenders.keys()]).toContain('Welcome message')
    } finally {
      rootContext.permissions = ['settings.branding']
    }
  })

  it('reads the Custom domains tab ahead when the pointer or focus reaches its tab', async () => {
    rootContext.permissions = ['settings.branding', 'settings.custom_domain']
    customDomainReads.count = 0
    try {
      render(
        <IntlProvider locale="en" defaultLocale="en">
          <QueryClientProvider client={seededClient()}>
            <PortalPage />
          </QueryClientProvider>
        </IntlProvider>
      )
      expect(customDomainReads.count).toBe(0)
      fireEvent.mouseEnter(screen.getByText('Custom domains'))
      await vi.waitFor(() => expect(customDomainReads.count).toBe(1))
      // Reaching it again reads nothing new.
      fireEvent.focus(screen.getByText('Custom domains'))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(customDomainReads.count).toBe(1)
      // Navigation has nothing to read ahead.
      fireEvent.mouseEnter(screen.getByRole('navigation', { name: 'Portal' }).firstElementChild!)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(customDomainReads.count).toBe(1)
    } finally {
      rootContext.permissions = ['settings.branding']
    }
  })

  it('drops the unsaved-changes guard when the Custom domains tab leaves for another domain', async () => {
    rootContext.permissions = ['settings.branding', 'settings.custom_domain']
    router.search = {}
    const queryClient = seededClient()
    const page = () => (
      <IntlProvider locale="en" defaultLocale="en">
        <QueryClientProvider client={queryClient}>
          <PortalPage />
        </QueryClientProvider>
      </IntlProvider>
    )
    try {
      const { rerender } = render(page())
      act(() => {
        fireEvent.click(screen.getByTestId('rich-text-editor'))
      })
      expect(router.blocker?.enableBeforeUnload()).toBe(true)

      // The drafts wait on Navigation while the admin is on Custom domains.
      router.search = { tab: 'custom-domains' }
      rerender(page())
      expect(router.blocker?.enableBeforeUnload()).toBe(true)

      fireEvent.click(await screen.findByText('Leave for the new domain'))
      expect(router.blocker?.enableBeforeUnload()).toBe(false)
    } finally {
      rootContext.permissions = ['settings.branding']
      router.search = {}
    }
  })
})
