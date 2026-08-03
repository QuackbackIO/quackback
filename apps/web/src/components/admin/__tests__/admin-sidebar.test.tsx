// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AdminSidebar } from '../admin-sidebar'

type ComponentProps = {
  children?: ReactNode
  className?: string
  onClick?: () => void
}

const hoisted = vi.hoisted(() => ({
  pathname: '/admin/feedback',
  routeContext: {
    session: {
      user: {
        name: 'Ada Admin',
        email: 'ada@example.com',
        image: '/ada.png',
      },
    },
    settings: {
      featureFlags: { helpCenter: true, supportInbox: true },
      brandingData: { logoUrl: '/brand.png', name: 'Acme' },
    },
    userRole: 'admin' as 'admin' | 'member' | null,
  },
  myPerms: {
    workspacePermissions: ['ticket.view_all'],
    teamPermissions: [] as Array<{ teamId: string; permissions: string[] }>,
  },
  invalidateMock: vi.fn(),
  mutateMock: vi.fn(),
  signOutMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    className,
    onClick,
  }: ComponentProps & { to: string; children?: ReactNode }) => (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  ),
  useRouter: () => ({ invalidate: hoisted.invalidateMock }),
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => string }) =>
    select({ location: { pathname: hoisted.pathname } }),
  useRouteContext: () => hoisted.routeContext,
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: hoisted.mutateMock }),
}))

vi.mock('@/lib/client/auth-client', () => ({
  signOut: (...args: unknown[]) => hoisted.signOutMock(...args),
}))

vi.mock('@/lib/client/hooks/use-authz-queries', () => ({
  useMyPermissions: () => ({ data: hoisted.myPerms }),
}))

vi.mock('@/lib/server/functions/chat', () => ({
  setAgentAvailabilityFn: vi.fn(),
}))

vi.mock('@/components/notifications', () => ({
  NotificationBell: ({ className }: { className?: string }) => (
    <button className={className}>Notifications</button>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, className, onClick }: ComponentProps) => (
    <button className={className} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ name }: { name?: string | null }) => <span>{name ?? 'Avatar'}</span>,
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: ComponentProps) => <div>{children}</div>,
  DropdownMenuContent: ({ children, className }: ComponentProps) => (
    <div className={className}>{children}</div>
  ),
  DropdownMenuItem: ({ children, onClick }: ComponentProps) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children, className }: ComponentProps) => (
    <div className={className}>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: ComponentProps) => <>{children}</>,
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: ComponentProps) => <>{children}</>,
  TooltipContent: ({ children }: ComponentProps) => <span>{children}</span>,
  TooltipTrigger: ({ children }: ComponentProps) => <>{children}</>,
}))

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: ComponentProps) => <div>{children}</div>,
  SheetContent: ({ children, className }: ComponentProps) => (
    <div className={className}>{children}</div>
  ),
  SheetHeader: ({ children, className }: ComponentProps) => (
    <div className={className}>{children}</div>
  ),
  SheetTitle: ({ children, className }: ComponentProps) => (
    <div className={className}>{children}</div>
  ),
  SheetTrigger: ({ children }: ComponentProps) => <>{children}</>,
}))

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children, className }: ComponentProps) => (
    <div className={className}>{children}</div>
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('__APP_VERSION__', '1.2.3')
  hoisted.pathname = '/admin/feedback'
  hoisted.routeContext = {
    session: {
      user: {
        name: 'Ada Admin',
        email: 'ada@example.com',
        image: '/ada.png',
      },
    },
    settings: {
      featureFlags: { helpCenter: true, supportInbox: true },
      brandingData: { logoUrl: '/brand.png', name: 'Acme' },
    },
    userRole: 'admin',
  }
  hoisted.myPerms = {
    workspacePermissions: ['ticket.view_all'],
    teamPermissions: [],
  }
})

describe('AdminSidebar', () => {
  it('renders enabled navigation, account data, branding, and version update state', () => {
    render(
      <AdminSidebar
        initialUserData={{ name: null, email: null, avatarUrl: null, chatAvailability: 'online' }}
        latestVersion={{ version: '2.0.0', releaseUrl: 'https://example.test/release' } as never}
      />
    )

    expect(screen.getAllByText('Feedback').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Tickets').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Conversations').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Help Center').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Ada Admin').length).toBeGreaterThan(0)
    expect(screen.getAllByText('ada@example.com').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Update available · v2.0.0').length).toBeGreaterThan(0)
    expect(screen.getAllByAltText('Acme').length).toBeGreaterThan(0)
  })

  it('hides permission-gated and feature-flagged navigation entries', () => {
    hoisted.routeContext = {
      ...hoisted.routeContext,
      settings: {
        ...hoisted.routeContext.settings,
        featureFlags: { helpCenter: false, supportInbox: false },
      },
    }
    hoisted.myPerms = {
      workspacePermissions: [],
      teamPermissions: [],
    }

    render(<AdminSidebar initialUserData={{ name: 'Fallback', email: null, avatarUrl: null }} />)

    expect(screen.queryByText('Tickets')).toBeNull()
    expect(screen.queryByText('Conversations')).toBeNull()
    expect(screen.queryByText('Help Center')).toBeNull()
  })

  it('updates chat availability optimistically through the mutation hook', () => {
    render(
      <AdminSidebar
        initialUserData={{
          name: 'Fallback',
          email: 'fallback@example.com',
          avatarUrl: null,
          chatAvailability: 'online',
        }}
      />
    )

    fireEvent.click(screen.getAllByText('Set yourself as away')[0])

    expect(hoisted.mutateMock).toHaveBeenCalledWith('away', { onError: expect.any(Function) })
  })
})

describe('AdminSidebar — settings cog visibility', () => {
  it('shows the settings cog to admins', () => {
    hoisted.routeContext = { ...hoisted.routeContext, userRole: 'admin' }

    const { container } = render(<AdminSidebar />)

    expect(container.querySelectorAll('a[href="/admin/settings"]').length).toBeGreaterThan(0)
  })

  it('hides the settings cog from non-admin team members', () => {
    hoisted.routeContext = { ...hoisted.routeContext, userRole: 'member' }

    const { container } = render(<AdminSidebar />)

    expect(container.querySelectorAll('a[href="/admin/settings"]').length).toBe(0)
  })
})
