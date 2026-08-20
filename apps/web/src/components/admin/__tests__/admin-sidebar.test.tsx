// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
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
  useQuery: ({ queryKey }: { queryKey?: unknown[] }) => {
    if (Array.isArray(queryKey) && queryKey.includes('owner-workspaces')) {
      return { data: mockBillingEnabled.current ? mockSiblings.current : undefined }
    }
    return { data: undefined }
  },
  useQueryClient: () => ({ getQueryData: () => undefined }),
  queryOptions: (opts: unknown) => opts,
}))

vi.mock('@/lib/client/auth-client', () => ({ signOut: vi.fn() }))

vi.mock('@/components/notifications', () => ({ NotificationBell: () => null }))

vi.mock('@/lib/server/functions/conversation', () => ({ setAgentAvailabilityFn: vi.fn() }))

const { mockSiblings, mockBillingEnabled } = vi.hoisted(() => ({
  mockSiblings: {
    current: [] as Array<{ instanceId: string; displayName: string; url: string | null }>,
  },
  mockBillingEnabled: { current: false },
}))

vi.mock('@/lib/server/functions/owner-workspaces', () => ({
  listOwnerWorkspacesFn: vi.fn(async () => mockSiblings.current),
  openOwnerWorkspaceFn: vi.fn(),
}))

import { AdminSidebar } from '../admin-sidebar'

function renderSidebar(userRole: 'admin' | 'member') {
  mockRole.current = userRole
  mockGetRouteContext.mockReturnValue({
    session: { user: { name: 'Test', email: 'test@example.com', image: null } },
    settings: { featureFlags: {} },
    userRole,
    billingEnabled: mockBillingEnabled.current,
  })
  return render(
    <IntlProvider locale="en" messages={{}}>
      <TooltipProvider>
        <AdminSidebar />
      </TooltipProvider>
    </IntlProvider>
  )
}

describe('AdminSidebar — workspace switcher', () => {
  afterEach(() => {
    mockSiblings.current = []
    mockBillingEnabled.current = false
    cleanup()
  })

  it('is absent when cloud is off', () => {
    mockBillingEnabled.current = false
    mockSiblings.current = [
      {
        instanceId: 'inst_south',
        displayName: 'South',
        url: 'https://south63792f.quackback.co.uk',
      },
    ]
    renderSidebar('admin')
    expect(screen.queryByRole('button', { name: 'Switch workspace' })).toBeNull()
  })

  it('is absent when the owner has no other workspaces', () => {
    mockBillingEnabled.current = true
    mockSiblings.current = []
    renderSidebar('admin')
    expect(screen.queryByRole('button', { name: 'Switch workspace' })).toBeNull()
  })

  it('lists sibling names and friendly URLs, never a generated host', () => {
    mockBillingEnabled.current = true
    mockSiblings.current = [
      {
        instanceId: 'inst_south',
        displayName: 'South',
        url: 'https://south63792f.quackback.co.uk',
      },
      {
        instanceId: 'inst_raw',
        displayName: 'Untitled workspace',
        url: 'https://ws-4a048e07941c5e7840e986c0.quackback.co.uk',
      },
    ]
    renderSidebar('admin')
    expect(screen.getByRole('button', { name: 'Switch workspace' })).toBeTruthy()
    expect(screen.queryByText(/ws-4a048e07941c5e7840e986c0/)).toBeNull()
  })
})

describe('AdminSidebar — Getting Started placement', () => {
  afterEach(() => cleanup())

  it('puts the rocket first in the main list for an admin with launch work left', () => {
    renderSidebar('admin')
    const nav = document.querySelector('aside nav')
    const first = nav?.querySelector('a')
    expect(first?.getAttribute('href')).toBe('/admin/getting-started')
  })

  it('hides Getting Started from non-admin team members', () => {
    const { container } = renderSidebar('member')
    expect(container.querySelectorAll('a[href="/admin/getting-started"]').length).toBe(0)
  })
})

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
