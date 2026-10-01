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
  useRouteContext: (opts?: { select?: (context: unknown) => unknown }) =>
    opts?.select ? opts.select(mockGetRouteContext()) : mockGetRouteContext(),
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
  useQuery: ({ queryKey, enabled }: { queryKey?: unknown[]; enabled?: boolean }) => {
    if (Array.isArray(queryKey) && queryKey.includes('owner-workspaces')) {
      return { data: mockBillingEnabled.current ? mockSiblings.current : undefined }
    }
    if (Array.isArray(queryKey) && queryKey.includes('moderationStatus')) {
      moderationQueryEnabled.current = enabled !== false
      if (enabled === false) return { data: undefined }
      return { data: { enabled: true, pendingCount: mockPending.current } }
    }
    return { data: undefined }
  },
  useQueryClient: () => ({ getQueryData: () => undefined }),
  queryOptions: (opts: unknown) => opts,
}))

vi.mock('@/lib/client/auth-client', () => ({ signOut: vi.fn() }))

vi.mock('@/components/notifications', () => ({ NotificationBell: () => null }))

vi.mock('@/lib/server/functions/conversation', () => ({ setAgentAvailabilityFn: vi.fn() }))

const { mockSiblings, mockBillingEnabled, mockPending, moderationQueryEnabled } = vi.hoisted(
  () => ({
    mockPending: { current: 0 },
    moderationQueryEnabled: { current: null as boolean | null },
    mockSiblings: {
      current: [] as Array<{ instanceId: string; displayName: string; url: string | null }>,
    },
    mockBillingEnabled: { current: false },
  })
)

vi.mock('@/lib/server/functions/owner-workspaces', () => ({
  listOwnerWorkspacesFn: vi.fn(async () => mockSiblings.current),
  openOwnerWorkspaceFn: vi.fn(),
}))

import { AdminSidebar, buildRailItems } from '../admin-sidebar'
import { DEFAULT_FEATURE_FLAGS } from '@/lib/shared/types/settings'
import { ALL_PERMISSIONS, PERMISSIONS } from '@/lib/shared/permissions'

function renderSidebar(
  userRole: 'admin' | 'member',
  opts: { flags?: Record<string, boolean>; name?: string; permissions?: string[] } = {}
) {
  mockRole.current = userRole
  mockGetRouteContext.mockReturnValue({
    permissions: opts.permissions ?? (userRole === 'admin' ? ALL_PERMISSIONS : []),
    session: { user: { name: 'Test', email: 'test@example.com', image: null } },
    settings: {
      featureFlags: opts.flags ?? {},
      brandingData: opts.name ? { name: opts.name } : undefined,
    },
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

const ALL_ON = {
  ...DEFAULT_FEATURE_FLAGS,
  feedback: true,
  supportInbox: true,
  changelog: true,
  helpCenter: true,
  statusPage: true,
}

describe('buildRailItems', () => {
  it('orders Home, Feedback, Roadmap, Changelog, Support, Help Center, Status, Analytics, Users', () => {
    const items = buildRailItems(ALL_ON)
    expect(items.map((i) => [i.label, i.href])).toEqual([
      ['Home', '/admin'],
      ['Feedback', '/admin/feedback'],
      ['Roadmap', '/admin/roadmap'],
      ['Changelog', '/admin/changelog'],
      ['Support', '/admin/inbox'],
      ['Help Center', '/admin/help-center'],
      ['Status', '/admin/status'],
      ['Analytics', '/admin/analytics'],
      ['Users', '/admin/users'],
    ])
  })

  it('keeps Home when every product is off', () => {
    const items = buildRailItems({})
    expect(items.map((i) => i.label)).toEqual(['Home', 'Analytics', 'Users'])
  })

  it('matches Home on its own path only', () => {
    const items = buildRailItems(ALL_ON)
    expect(items.find((i) => i.label === 'Home')!.exact).toBe(true)
    expect(items.filter((i) => i.exact).length).toBe(1)
  })
})

describe('AdminSidebar — Home logo', () => {
  afterEach(() => cleanup())

  it('sends the org logo to Overview', () => {
    const { container } = renderSidebar('admin')
    expect(container.querySelector('aside a[href="/admin"]')).toBeTruthy()
    expect(container.querySelectorAll('a[href="/admin/getting-started"]').length).toBe(0)
  })

  it('does not add a Getting Started rocket for admins or members', () => {
    const admin = renderSidebar('admin')
    expect(admin.container.querySelectorAll('a[href="/admin/getting-started"]').length).toBe(0)
    cleanup()
    const member = renderSidebar('member')
    expect(member.container.querySelectorAll('a[href="/admin/getting-started"]').length).toBe(0)
  })
})

describe('AdminSidebar — settings entry', () => {
  afterEach(() => cleanup())

  it('shows Settings to admins', () => {
    const { container } = renderSidebar('admin')
    expect(container.querySelectorAll('a[href="/admin/settings"]').length).toBeGreaterThan(0)
  })

  it('hides Settings from a team member who can open no settings page', () => {
    const { container } = renderSidebar('member')
    expect(container.querySelectorAll('a[href="/admin/settings"]').length).toBe(0)
  })

  it('shows Settings to an assistant manager, who has no legacy admin role', () => {
    const { container } = renderSidebar('member', { permissions: [PERMISSIONS.ASSISTANT_MANAGE] })
    expect(container.querySelectorAll('a[href="/admin/settings"]').length).toBeGreaterThan(0)
  })

  it('shows Settings to a workflow manager only while the Support inbox is on', () => {
    const permissions = [PERMISSIONS.WORKFLOW_MANAGE]
    const on = renderSidebar('member', { permissions, flags: { supportInbox: true } })
    expect(on.container.querySelectorAll('a[href="/admin/settings"]').length).toBeGreaterThan(0)
    cleanup()
    const off = renderSidebar('member', { permissions, flags: { supportInbox: false } })
    expect(off.container.querySelectorAll('a[href="/admin/settings"]').length).toBe(0)
  })
})

describe('AdminSidebar — labeled rail', () => {
  afterEach(() => cleanup())

  it('always shows full menu labels, whatever the stored appearance says', () => {
    for (const stored of [undefined, 'legacy', 'refined'] as const) {
      mockRole.current = 'admin'
      mockGetRouteContext.mockReturnValue({
        permissions: ALL_PERMISSIONS,
        session: { user: { name: 'Test', email: 'test@example.com', image: null } },
        settings: { featureFlags: {}, visualTheme: stored },
        visualTheme: stored,
        userRole: 'admin',
        billingEnabled: false,
      })
      const { container } = render(
        <IntlProvider locale="en" messages={{}}>
          <TooltipProvider>
            <AdminSidebar />
          </TooltipProvider>
        </IntlProvider>
      )
      expect(container.querySelector('[data-admin-rail][data-labeled]')).toBeTruthy()
      expect(
        container.querySelectorAll('[data-admin-rail-item][data-labeled]').length
      ).toBeGreaterThan(0)
      expect(container.querySelector('aside a[href="/admin/settings"]')?.textContent).toContain(
        'Settings'
      )
      expect(container.querySelector('aside')?.className).toContain('w-56')
      expect(container.querySelector('aside')?.className).not.toContain('w-14')
      cleanup()
    }
  })
})

describe('AdminSidebar — AI & Automation', () => {
  afterEach(() => cleanup())

  it('has no rail item: the pages live under Settings', () => {
    const { container } = renderSidebar('admin', { flags: ALL_ON })
    expect(container.querySelector('a[href^="/admin/automation"]')).toBeNull()
    expect(container.textContent).not.toContain('AI & Automation')
  })
})

describe('AdminSidebar rail', () => {
  afterEach(() => {
    mockPending.current = 0
    cleanup()
  })

  it('has a labelled Home item pointing at /admin', () => {
    const { container } = renderSidebar('admin', { flags: ALL_ON })
    expect(container.querySelector('aside nav a[href="/admin"]')?.textContent).toContain('Home')
  })

  it('shows the pending moderation count on Feedback only when above zero', () => {
    mockPending.current = 3
    const withCount = renderSidebar('admin', { flags: ALL_ON })
    const feedback = withCount.container.querySelector('aside nav a[href="/admin/feedback"]')!
    expect(feedback.textContent).toContain('3')
    expect(feedback.textContent).toContain('3 waiting for review')
    expect(
      withCount.container.querySelector('aside nav a[href="/admin/roadmap"]')!.textContent
    ).not.toMatch(/\d/)
    cleanup()
    mockPending.current = 0
    const none = renderSidebar('admin', { flags: ALL_ON })
    expect(none.container.querySelector('aside nav a[href="/admin/feedback"]')!.textContent).toBe(
      'Feedback'
    )
  })

  it('asks for the pending moderation count only with the post.approve permission', () => {
    mockPending.current = 3
    moderationQueryEnabled.current = null
    const member = renderSidebar('member', { flags: ALL_ON })
    expect(moderationQueryEnabled.current).toBe(false)
    expect(member.container.querySelector('aside nav a[href="/admin/feedback"]')!.textContent).toBe(
      'Feedback'
    )
    cleanup()
    renderSidebar('admin', { flags: ALL_ON })
    expect(moderationQueryEnabled.current).toBe(true)
  })

  it('uses a solid icon for Status', () => {
    const { container } = renderSidebar('admin', { flags: ALL_ON })
    const svg = container.querySelector('aside nav a[href="/admin/status"] svg')!
    expect(svg.getAttribute('fill')).toBe('currentColor')
  })

  it('titles the mobile menu with the workspace name', async () => {
    const { fireEvent } = await import('@testing-library/react')
    renderSidebar('admin', { flags: ALL_ON, name: 'Acme Feedback' })
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const title = await screen.findByRole('dialog')
    expect(title.textContent).toContain('Acme Feedback')
    expect(title.textContent).not.toContain('Quackback')
  })

  it('lists Home first in the mobile menu', async () => {
    const { fireEvent } = await import('@testing-library/react')
    renderSidebar('admin', { flags: ALL_ON })
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const dialog = await screen.findByRole('dialog')
    const links = [...dialog.querySelectorAll('nav a')].map((a) => a.getAttribute('href'))
    expect(links.slice(0, 3)).toEqual(['/admin', '/admin/feedback', '/admin/roadmap'])
  })
})
