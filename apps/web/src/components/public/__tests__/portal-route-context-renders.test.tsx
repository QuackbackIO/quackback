// @vitest-environment happy-dom
/**
 * Every portal navigation, a search-only one included (a sort, a filter),
 * hands the tree a new route context object while the parts inside it (the
 * session, the workspace settings) stay the same. Components that show the
 * workspace's branding or the viewer read just those parts, so a navigation
 * renders none of them, and a settings change still reaches them.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Profiler, type ReactNode } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { PortalBrandMark } from '@/components/auth/portal-brand-mark'
import { PortalAuthShell } from '@/components/auth/portal-auth-shell'
import { AuthorHoverCard } from '../author-hover-card'
import { MentionHoverCardOverlay } from '@/components/ui/mention-hover-card-overlay'

afterEach(cleanup)

// The root beforeLoad keeps one answer between navigations (its route-context
// memo), so the parts are the same objects each time.
let rootAnswer: { session: null; settings: { name: string; brandingData: { name: string } } }

const commits: Record<string, number> = {}
const counted = (id: string, children: ReactNode) => (
  <Profiler id={id} onRender={() => (commits[id] = (commits[id] ?? 0) + 1)}>
    {children}
  </Profiler>
)

function buildRouter() {
  const rootRoute = createRootRouteWithContext<object>()({
    beforeLoad: () => rootAnswer,
    component: () => (
      <>
        {counted('brand', <PortalBrandMark />)}
        {counted('shell', <PortalAuthShell heading="Sign in">form</PortalAuthShell>)}
        {counted(
          'author',
          <AuthorHoverCard principalId="principal_1" displayName="Ada">
            Ada
          </AuthorHoverCard>
        )}
        {counted(
          'mentions',
          <MentionHoverCardOverlay>
            <p>post body</p>
          </MentionHoverCardOverlay>
        )}
        <Outlet />
      </>
    ),
  })
  const home = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    validateSearch: (search: Record<string, unknown>) => search as { sort?: string },
    component: () => <p>feedback page</p>,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([home]),
    history: createMemoryHistory({ initialEntries: ['/?sort=top'] }),
    context: {},
  })
}

async function mount() {
  for (const key of Object.keys(commits)) delete commits[key]
  const router = buildRouter()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}}>
        <RouterProvider router={router} />
      </IntlProvider>
    </QueryClientProvider>
  )
  await screen.findByText('feedback page')
  return router
}

describe('portal route context readers', () => {
  it('render nothing for a search-only navigation', async () => {
    rootAnswer = { session: null, settings: { name: 'Acme', brandingData: { name: 'Acme' } } }
    const router = await mount()
    const settled = { ...commits }

    await act(() => router.navigate({ to: '/', search: { sort: 'new' } }))
    await act(() => router.navigate({ to: '/', search: { sort: 'trending' } }))

    expect(router.state.location.search).toEqual({ sort: 'trending' })
    expect(commits).toEqual(settled)
  })

  it('show a settings change', async () => {
    rootAnswer = { session: null, settings: { name: 'Acme', brandingData: { name: 'Acme' } } }
    const router = await mount()
    expect(screen.getAllByText('Acme').length).toBeGreaterThan(0)

    rootAnswer = { session: null, settings: { name: 'Initech', brandingData: { name: 'Initech' } } }
    await act(() => router.invalidate())

    expect(screen.queryAllByText('Acme')).toHaveLength(0)
    expect(screen.getAllByText('Initech').length).toBeGreaterThan(0)
  })
})
