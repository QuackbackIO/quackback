// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

import { TooltipProvider } from '@/components/ui/tooltip'

// Injected by Vite at build time (see vite.config.ts `define`); absent in vitest.
vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

// vi.hoisted so the mock is ready when the hoisted vi.mock factory runs.
const { mockGetRouteContext, mockRole } = vi.hoisted(() => ({
  mockGetRouteContext: vi.fn(),
  mockRole: { current: 'admin' as 'admin' | 'member' },
}))

vi.mock('@/lib/client/hooks/use-permission', () => ({
  usePermission: () => mockRole.current === 'admin',
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/admin/feedback' } }),
  useRouteContext: () => mockGetRouteContext(),
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string
    children: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} {...(rest as React.HTMLAttributes<HTMLAnchorElement>)}>
      {children}
    </a>
  ),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn() }),
  // Launch-checklist badge query; undefined data = checklist state unknown,
  // which renders the nav item without a count.
  useQuery: () => ({ data: undefined }),
  // No cached onboarding data in tests, so the enabled-once-complete check
  // (which reads the cache directly) always falls back to "keep it enabled".
  useQueryClient: () => ({ getQueryData: () => undefined }),
  queryOptions: (opts: unknown) => opts,
}))

vi.mock('@/lib/client/auth-client', () => ({ signOut: vi.fn() }))

vi.mock('@/components/notifications', () => ({ NotificationBell: () => null }))

vi.mock('@/lib/server/functions/conversation', () => ({ setAgentAvailabilityFn: vi.fn() }))

import { AdminSidebar } from '../admin-sidebar'

function renderSidebar(userRole: 'admin' | 'member') {
  mockRole.current = userRole
  mockGetRouteContext.mockReturnValue({
    session: { user: { name: 'Test', email: 'test@example.com', image: null } },
    settings: { featureFlags: {} },
    userRole,
  })
  return render(
    <IntlProvider locale="en" messages={{}}>
      <TooltipProvider>
        <AdminSidebar />
      </TooltipProvider>
    </IntlProvider>
  )
}

describe('AdminSidebar — settings cog visibility', () => {
  afterEach(() => cleanup())

  it('shows the settings cog to admins', () => {
    const { container } = renderSidebar('admin')
    expect(container.querySelectorAll('a[href="/admin/settings"]').length).toBeGreaterThan(0)
  })

  it('hides the settings cog from non-admin team members', () => {
    const { container } = renderSidebar('member')
    expect(container.querySelectorAll('a[href="/admin/settings"]').length).toBe(0)
  })
})

describe('AdminSidebar — AI & Automation visibility', () => {
  afterEach(() => cleanup())

  it('shows AI & Automation to admins, linking to the agent page', () => {
    const { container } = renderSidebar('admin')
    expect(container.querySelectorAll('a[href="/admin/automation/agent"]').length).toBeGreaterThan(
      0
    )
  })

  it('hides AI & Automation from non-admin team members', () => {
    const { container } = renderSidebar('member')
    expect(container.querySelectorAll('a[href="/admin/automation/agent"]').length).toBe(0)
  })
})
