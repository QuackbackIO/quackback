// @vitest-environment happy-dom
/**
 * The root document wraps every page in the theme provider. Every navigation
 * hands the tree a fresh root context, a search-only one included, and the
 * document shows none of it unless the theme, the language or the kind of
 * page (admin, portal, widget) changed, so it renders nothing again for a
 * navigation between admin pages; a change to the theme still reaches it.
 *
 * The document advertises the status feed to feed readers only where one is
 * served it: a reader has no session, so a private portal turns it away.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

const doc = vi.hoisted(() => ({
  themeRenders: 0,
  defaultTheme: '' as string | undefined,
  storageKey: '' as string | undefined,
  bootstrap: null as null | Record<string, unknown>,
}))

vi.mock('@/lib/server/functions/bootstrap', () => ({
  getBootstrapData: async () => doc.bootstrap,
}))
vi.mock('@/components/theme-provider', () => ({
  ThemeProvider: ({
    children,
    defaultTheme,
    storageKey,
  }: {
    children: ReactNode
    defaultTheme?: string
    storageKey?: string
  }) => {
    doc.themeRenders++
    doc.defaultTheme = defaultTheme
    doc.storageKey = storageKey
    return <>{children}</>
  },
}))
vi.mock('@/components/shared/document-head', () => ({
  DocumentHead: () => null,
  DocumentScripts: () => null,
}))
vi.mock('@/components/shared/ott-handler', () => ({ OttHandler: () => null }))
vi.mock('@/components/shared/visitor-beacon', () => ({ VisitorBeacon: () => null }))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  HeadContent: () => null,
}))
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))

const { Route: RootRoute } = await import('../__root')
const { MinimalDocument } = await import('@/components/shared/minimal-document')
const { expireRouteContext } = await import('@/lib/client/route-context-memo')

afterEach(() => {
  cleanup()
  expireRouteContext()
})

function bootstrap(
  themeCookie: 'light' | 'dark',
  settings: Record<string, unknown> = {},
  portalThemeCookie: 'light' | 'dark' | 'system' = themeCookie
) {
  doc.bootstrap = {
    baseUrl: 'http://localhost',
    session: null,
    settings: { featureFlags: {}, ...settings },
    onboarding: { complete: true, needsSetupWizard: false },
    userRole: 'admin',
    themeCookie,
    portalThemeCookie,
    prefersColorScheme: null,
    managedFieldPaths: [],
    registeredAuthProviders: [],
    acceptLanguageLocale: 'en',
    updateBannerDismissedVersion: null,
    billingEnabled: false,
    cloudEnabled: false,
  }
}

function buildRouter(initialPath: string) {
  const inbox = createRoute({
    getParentRoute: () => RootRoute,
    path: '/admin/inbox',
    validateSearch: (search: Record<string, unknown>) => search as { i?: string },
    component: () => <p>inbox page</p>,
  })
  const roadmap = createRoute({
    getParentRoute: () => RootRoute,
    path: '/admin/roadmap',
    component: () => <p>roadmap page</p>,
  })
  const portal = createRoute({
    getParentRoute: () => RootRoute,
    path: '/feedback',
    component: () => <p>portal page</p>,
  })
  return createRouter({
    routeTree: RootRoute.addChildren([inbox, roadmap, portal]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    context: { queryClient: {} as never },
  })
}

async function mount(initialPath = '/admin/inbox') {
  doc.themeRenders = 0
  const router = buildRouter(initialPath)
  // The document renders <html> itself, so it mounts on the document.
  render(<RouterProvider router={router} />, { container: document as never })
  await screen.findByText(initialPath === '/feedback' ? 'portal page' : 'inbox page')
  return router
}

describe('root document renders', () => {
  it('renders nothing again for navigations between admin pages', async () => {
    bootstrap('dark')
    const router = await mount()
    const settled = doc.themeRenders

    await act(() => router.navigate({ to: '/admin/inbox', search: { i: 'one' } } as never))
    await act(() => router.navigate({ to: '/admin/inbox', search: { i: 'two' } } as never))
    await act(() => router.navigate({ to: '/admin/roadmap' } as never))
    await screen.findByText('roadmap page')

    expect(doc.themeRenders).toBe(settled)
    expect(doc.defaultTheme).toBe('dark')
  })

  it('still follows a theme change', async () => {
    bootstrap('dark')
    const router = await mount()
    expect(doc.defaultTheme).toBe('dark')

    bootstrap('light')
    expireRouteContext()
    await act(() => router.invalidate())

    expect(doc.defaultTheme).toBe('light')
  })

  // Labs rows are ignored: a workspace that stored an old appearance and one
  // with no row at all render the same document, with no theme marker.
  it.each([
    ['no stored appearance', {}],
    ['a stored legacy appearance', { visualTheme: 'legacy' }],
    ['a stored refined appearance', { visualTheme: 'refined' }],
  ])('renders one theme for %s', async (_label, settings) => {
    bootstrap('dark', settings)
    await mount()
    expect(document.documentElement.hasAttribute('data-visual-theme')).toBe(false)
  })
})

describe('the portal’s own theme', () => {
  const design = (mode: 'auto' | 'light' | 'dark') => ({
    portalDesign: {
      engine: 'v2',
      mode,
      revision: 1,
      themeStyles: '',
      customCss: '',
      fontSans: '',
      fontIds: [],
      attributes: { 'data-qb-nav': 'pills' },
    },
  })

  it('keeps the portal visitor’s light or dark choice apart from the admin’s', async () => {
    bootstrap('dark', {}, 'light')
    const router = await mount('/feedback')
    expect(doc.defaultTheme).toBe('light')
    expect(doc.storageKey).toBe('portal-theme')

    await act(() => router.navigate({ to: '/admin/inbox' } as never))
    await screen.findByText('inbox page')
    expect(doc.defaultTheme).toBe('dark')
    expect(doc.storageKey).toBe('theme')
  })

  it('scopes a design to portal pages only', async () => {
    bootstrap('light', design('auto'))
    const router = await mount('/feedback')
    expect(document.documentElement.hasAttribute('data-portal-theme')).toBe(true)
    expect(document.documentElement.getAttribute('data-qb-nav')).toBe('pills')

    await act(() => router.navigate({ to: '/admin/inbox' } as never))
    await screen.findByText('inbox page')
    expect(document.documentElement.hasAttribute('data-portal-theme')).toBe(false)
    expect(document.documentElement.hasAttribute('data-qb-nav')).toBe(false)
  })

  it('leaves the attribute off while the portal uses today’s theme', async () => {
    bootstrap('light')
    await mount('/feedback')
    expect(document.documentElement.hasAttribute('data-portal-theme')).toBe(false)
  })

  it('forces the mode a design sets', async () => {
    bootstrap('light', design('dark'), 'light')
    await mount('/feedback')
    expect(doc.defaultTheme).toBe('dark')
  })
})

describe('the RSS feed the document advertises', () => {
  const statusPageMatches = (settings: Record<string, unknown>) => [
    { routeId: '__root__', context: { settings } },
    { routeId: '/_portal', context: { settings } },
    { routeId: '/_portal/status/', context: { settings } },
  ]
  const alternateHref = (settings: Record<string, unknown>) => {
    const head = (
      RootRoute.options.head as unknown as (ctx: { matches: unknown[] }) => {
        links: Array<{ rel: string; href: string }>
      }
    )({ matches: statusPageMatches(settings) })
    return head.links.find((link) => link.rel === 'alternate')?.href
  }
  const publicPage = {
    featureFlags: { statusPage: true },
    statusConfig: { enabled: true, audience: 'public' },
  }

  it('is the status feed on a public status page', () => {
    expect(alternateHref(publicPage)).toBe('/status/feed')
  })

  it('is not the status feed inside a private portal, which turns a feed reader away', () => {
    expect(
      alternateHref({ ...publicPage, portalConfig: { access: { visibility: 'private' } } })
    ).toBe('/changelog/feed')
  })
})

describe('crash fallback document', () => {
  it('renders without a theme marker, like the app document', () => {
    const html = renderToStaticMarkup(
      <MinimalDocument>
        <p>fallback</p>
      </MinimalDocument>
    )
    expect(html).toContain('<p>fallback</p>')
    expect(html).not.toContain('data-visual-theme')
  })
})
