// @vitest-environment happy-dom
/**
 * The root document wraps every page in the theme provider. Every navigation
 * hands the tree a fresh root context, a search-only one included, and the
 * document shows none of it unless the theme, the language or the kind of
 * page (admin, portal, widget) changed, so it renders nothing again for a
 * navigation between admin pages; a change to the theme still reaches it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

const doc = vi.hoisted(() => ({
  themeRenders: 0,
  defaultTheme: '' as string | undefined,
  bootstrap: null as null | Record<string, unknown>,
}))

vi.mock('@/lib/server/functions/bootstrap', () => ({
  getBootstrapData: async () => doc.bootstrap,
}))
vi.mock('@/components/theme-provider', () => ({
  ThemeProvider: ({ children, defaultTheme }: { children: ReactNode; defaultTheme?: string }) => {
    doc.themeRenders++
    doc.defaultTheme = defaultTheme
    return <>{children}</>
  },
}))
vi.mock('@/components/shared/document-head', () => ({
  DocumentHead: () => null,
  DocumentScripts: () => null,
}))
vi.mock('@/components/shared/ott-handler', () => ({ OttHandler: () => null }))
vi.mock('@/components/shared/visitor-beacon', () => ({ VisitorBeacon: () => null }))
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))

const { Route: RootRoute } = await import('../__root')
const { expireRouteContext } = await import('@/lib/client/route-context-memo')

afterEach(() => {
  cleanup()
  expireRouteContext()
})

// A workspace past onboarding, so the root route renders its pages.
const COMPLETE_SETUP = JSON.stringify({
  version: 2,
  steps: {
    core: true,
    workspace: true,
    startingPoint: {
      outcome: 'product_feedback',
      resourceType: 'none',
      source: 'managed',
      resolution: 'configured',
      completedAt: '2026-08-13T00:00:00.000Z',
    },
  },
})

function bootstrap(themeCookie: 'light' | 'dark') {
  doc.bootstrap = {
    baseUrl: 'http://localhost',
    session: null,
    settings: { featureFlags: {}, settings: { setupState: COMPLETE_SETUP } },
    userRole: 'admin',
    themeCookie,
    prefersColorScheme: null,
    managedFieldPaths: [],
    registeredAuthProviders: [],
    acceptLanguageLocale: 'en',
    updateBannerDismissedVersion: null,
    billingEnabled: false,
    cloudEnabled: false,
  }
}

function buildRouter() {
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
  return createRouter({
    routeTree: RootRoute.addChildren([inbox, roadmap]),
    history: createMemoryHistory({ initialEntries: ['/admin/inbox'] }),
    context: { queryClient: {} as never },
  })
}

async function mount() {
  doc.themeRenders = 0
  const router = buildRouter()
  // The document renders <html> itself, so it mounts on the document.
  render(<RouterProvider router={router} />, { container: document as never })
  await screen.findByText('inbox page')
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
})
