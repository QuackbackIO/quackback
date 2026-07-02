// @vitest-environment happy-dom
/**
 * Differential-coverage tests for the /admin route — the loader's public-path
 * short circuit, the authenticated parallel prefetch, and the layout's
 * public-route Outlet branch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode, ReactElement } from 'react'
;(globalThis as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = '0.0.0'

const routeData = vi.hoisted(() => ({ useLoaderData: vi.fn() }))
const m = vi.hoisted(() => ({
  fetchUserAvatar: vi.fn(),
  getLatestVersion: vi.fn(),
  isNewerVersion: vi.fn(),
  getMyPermissions: vi.fn(),
  getPlanNotice: vi.fn(),
  prefetchQuery: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (cfg: unknown) => ({
    options: cfg,
    useLoaderData: routeData.useLoaderData,
  }),
  Outlet: () => <div data-testid="outlet" />,
  useRouterState: () => undefined,
}))
vi.mock('react-intl', () => ({
  IntlProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('@/lib/server/functions/portal', () => ({
  fetchUserAvatar: (...a: unknown[]) => m.fetchUserAvatar(...a),
}))
vi.mock('@/lib/server/functions/version', () => ({
  getLatestVersion: (...a: unknown[]) => m.getLatestVersion(...a),
  isNewerVersion: (...a: unknown[]) => m.isNewerVersion(...a),
}))
vi.mock('@/components/admin/admin-sidebar', () => ({ AdminSidebar: () => <div /> }))
vi.mock('@/components/admin/feedback/post-modal', () => ({ PostModal: () => <div /> }))
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/admin/update-banner', () => ({ UpdateBanner: () => <div /> }))
vi.mock('@/lib/client/hooks/use-authz-queries', () => ({
  authzKeys: { me: () => ['authz', 'me'] },
}))
vi.mock('@/lib/server/functions/authz', () => ({
  getMyPermissionsFn: (...a: unknown[]) => m.getMyPermissions(...a),
}))
vi.mock('@/lib/server/functions/plan-notice', () => ({
  getPlanNotice: (...a: unknown[]) => m.getPlanNotice(...a),
}))

const { Route } = await import('../admin')
type Opts = {
  loader: (a: {
    context: unknown
    location: { pathname: string }
  }) => Promise<Record<string, unknown>>
  component: () => ReactElement
}
const opts = () => (Route as unknown as { options: Opts }).options

beforeEach(() => {
  vi.clearAllMocks()
  m.fetchUserAvatar.mockResolvedValue({ avatarUrl: 'a.png' })
  m.getLatestVersion.mockResolvedValue({ version: '9.9.9' })
  m.isNewerVersion.mockReturnValue(true)
  m.getPlanNotice.mockResolvedValue(null)
  m.prefetchQuery.mockResolvedValue(undefined)
})

describe('admin loader', () => {
  it('short-circuits for public paths', async () => {
    const data = await opts().loader({ context: {}, location: { pathname: '/admin/login' } })
    expect(data).toMatchObject({ user: null, latestVersion: null })
  })

  it('prefetches avatar, version, permissions and plan notice for authenticated users', async () => {
    const ctx = {
      user: { id: 'u1', name: 'Jane', email: 'j@x.test', image: null },
      principal: { id: 'pr1' },
      queryClient: { prefetchQuery: (...a: unknown[]) => m.prefetchQuery(...a) },
    }
    const data = await opts().loader({ context: ctx, location: { pathname: '/admin/tickets' } })
    expect(data.latestVersion).toMatchObject({ version: '9.9.9' })
    expect(data.initialUserData).toMatchObject({ avatarUrl: 'a.png' })
    expect(data.currentUser).toMatchObject({ principalId: 'pr1' })
    expect(m.prefetchQuery).toHaveBeenCalled()
  })
})

describe('AdminLayout', () => {
  it('renders just the outlet on public routes (no user data)', () => {
    routeData.useLoaderData.mockReturnValue({
      initialUserData: null,
      latestVersion: null,
      currentUser: null,
    })
    const Layout = opts().component
    render(<Layout />)
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })
})
