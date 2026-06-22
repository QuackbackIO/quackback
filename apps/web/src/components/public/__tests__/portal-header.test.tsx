// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PortalHeader } from '../portal-header'

type ComponentProps = {
  children?: ReactNode
  className?: string
  onClick?: () => void
}

const mocks = vi.hoisted(() => ({
  pathname: '/',
  routeContext: {
    session: null as null | {
      user: {
        name?: string | null
        email?: string | null
        image?: string | null
        principalType?: string | null
      }
    },
    settings: {
      featureFlags: { helpCenter: false, supportInbox: false },
      helpCenterConfig: { enabled: false },
      portalConfig: { support: { enabled: false } },
      publicPortalConfig: { oauth: {} as Record<string, boolean | undefined> },
      verifiedDomains: [] as Array<{ verifiedAt: string | null }>,
    },
    registeredAuthProviders: [] as string[],
  },
  queryResult: { data: undefined as unknown },
  queryOptions: undefined as unknown,
  invalidate: vi.fn(),
  navigate: vi.fn(),
  queryInvalidate: vi.fn(),
  setTheme: vi.fn(),
  signOut: vi.fn(),
  openAuthPopover: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className, onClick }: ComponentProps & { to: string }) => (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  ),
  useRouter: () => ({
    invalidate: mocks.invalidate,
    navigate: mocks.navigate,
  }),
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => string }) =>
    select({ location: { pathname: mocks.pathname } }),
  useRouteContext: () => mocks.routeContext,
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => {
    mocks.queryOptions = options
    return mocks.queryResult
  },
  useQueryClient: () => ({
    invalidateQueries: mocks.queryInvalidate,
  }),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'system', setTheme: mocks.setTheme }),
}))

vi.mock('react-intl', () => ({
  FormattedMessage: ({
    defaultMessage,
    values,
  }: {
    defaultMessage: string
    values?: Record<string, string | number>
  }) => <>{defaultMessage.replace('{count}', String(values?.count ?? ''))}</>,
  useIntl: () => ({
    formatMessage: (
      descriptor: { defaultMessage: string },
      values?: Record<string, string | number>
    ) => descriptor.defaultMessage.replace('{count}', String(values?.count ?? '')),
  }),
}))

vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopoverSafe: () => ({ openAuthPopover: mocks.openAuthPopover }),
}))

vi.mock('@/components/auth/oauth-buttons', () => ({
  hasAnyPortalAuthMethod: (
    authConfig: Record<string, boolean | undefined>,
    opts?: { ssoEnabled?: boolean; hasVerifiedDomain?: boolean }
  ) =>
    Boolean(
      authConfig.password ||
      authConfig.magicLink ||
      authConfig.github ||
      (opts?.ssoEnabled && opts.hasVerifiedDomain)
    ),
}))

vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  useAuthBroadcast: vi.fn(),
}))

vi.mock('@/lib/client/auth-client', () => ({
  signOut: () => mocks.signOut(),
}))

vi.mock('@/lib/server/functions/chat', () => ({
  getMyConversationsFn: vi.fn(),
}))

vi.mock('@/lib/client/queries/portal-support', () => ({
  PORTAL_MY_CONVERSATIONS_QUERY_KEY: ['portal', 'my-conversations'],
}))

vi.mock('@/components/notifications', () => ({
  NotificationBell: ({ className }: { className?: string }) => (
    <button type="button" className={className}>
      Notifications
    </button>
  ),
}))

vi.mock('@/components/shared/user-stats', () => ({
  UserStatsBar: () => <div>User stats</div>,
}))

vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ name }: { name?: string | null }) => <span>{name ?? 'Avatar'}</span>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, className, onClick, asChild }: ComponentProps & { asChild?: boolean }) =>
    asChild ? (
      <>{children}</>
    ) : (
      <button type="button" className={className} onClick={onClick}>
        {children}
      </button>
    ),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: ComponentProps) => <div>{children}</div>,
  DropdownMenuContent: ({ children, className }: ComponentProps & { align?: string }) => (
    <div className={className}>{children}</div>
  ),
  DropdownMenuItem: ({ children, onClick, asChild }: ComponentProps & { asChild?: boolean }) =>
    asChild ? (
      <>{children}</>
    ) : (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  DropdownMenuLabel: ({ children, className }: ComponentProps) => (
    <div className={className}>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: ComponentProps & { asChild?: boolean }) => <>{children}</>,
}))

vi.mock('@heroicons/react/24/solid', () => ({
  ArrowPathIcon: () => <span aria-hidden="true">sync</span>,
  ArrowRightStartOnRectangleIcon: () => <span aria-hidden="true">sign-out</span>,
  Cog6ToothIcon: () => <span aria-hidden="true">settings</span>,
  ComputerDesktopIcon: () => <span aria-hidden="true">system</span>,
  MoonIcon: () => <span aria-hidden="true">dark</span>,
  ShieldCheckIcon: () => <span aria-hidden="true">admin</span>,
  SunIcon: () => <span aria-hidden="true">light</span>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pathname = '/'
  mocks.routeContext = {
    session: null,
    settings: {
      featureFlags: { helpCenter: false, supportInbox: false },
      helpCenterConfig: { enabled: false },
      portalConfig: { support: { enabled: false } },
      publicPortalConfig: { oauth: {} },
      verifiedDomains: [],
    },
    registeredAuthProviders: [],
  }
  mocks.queryResult = { data: undefined }
  mocks.queryOptions = undefined
  mocks.signOut.mockResolvedValue(undefined)
  mocks.invalidate.mockResolvedValue(undefined)
})

describe('PortalHeader', () => {
  it('renders signed-in admin navigation, support unread count, and sign-out behavior', async () => {
    mocks.pathname = '/support'
    mocks.routeContext = {
      session: {
        user: {
          name: 'Ada Admin',
          email: 'ada@example.com',
          image: '/ada.png',
          principalType: 'user',
        },
      },
      settings: {
        featureFlags: { helpCenter: true, supportInbox: true },
        helpCenterConfig: { enabled: true },
        portalConfig: { support: { enabled: true } },
        publicPortalConfig: { oauth: { password: true } },
        verifiedDomains: [],
      },
      registeredAuthProviders: [],
    }
    mocks.queryResult = {
      data: {
        conversations: [{ unreadCount: 2 }, { unreadCount: 101 }, { unreadCount: null }],
      },
    }

    render(
      <PortalHeader orgName="Acme" orgLogo="/logo.png" userRole="admin" supportAccessGranted />
    )

    expect(screen.getByRole('link', { name: /Acme/ })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /My tickets/ })).toHaveAttribute('href', '/tickets')
    expect(screen.getByRole('link', { name: /Help Center/ })).toHaveAttribute('href', '/hc')
    expect(screen.getByRole('link', { name: /Support/ })).toHaveAttribute('href', '/support')
    expect(screen.getByLabelText('103 unread')).toHaveTextContent('99+')
    expect(screen.getByRole('link', { name: /Admin/ })).toHaveAttribute('href', '/admin')
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    expect(mocks.queryOptions).toMatchObject({
      queryKey: ['portal', 'my-conversations'],
      enabled: true,
      staleTime: 30_000,
    })

    fireEvent.click(screen.getByRole('button', { name: /Sign out/ }))

    await waitFor(() => {
      expect(mocks.signOut).toHaveBeenCalled()
    })
    expect(mocks.queryInvalidate).toHaveBeenCalledWith({ queryKey: ['portal', 'post'] })
    expect(mocks.queryInvalidate).toHaveBeenCalledWith({ queryKey: ['votedPosts'] })
    expect(mocks.invalidate).toHaveBeenCalled()
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/' })
  })

  it('renders anonymous portal auth buttons only when an auth method is available', () => {
    mocks.routeContext = {
      session: null,
      settings: {
        featureFlags: { helpCenter: true, supportInbox: true },
        helpCenterConfig: { enabled: true },
        portalConfig: { support: { enabled: true } },
        publicPortalConfig: { oauth: { password: true } },
        verifiedDomains: [],
      },
      registeredAuthProviders: [],
    }

    render(<PortalHeader orgName="Acme" supportAccessGranted />)

    expect(screen.getByRole('link', { name: /Feedback/ })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('link', { name: /My tickets/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(mocks.openAuthPopover).toHaveBeenCalledWith({ mode: 'login' })
    expect(mocks.openAuthPopover).toHaveBeenCalledWith({ mode: 'signup' })
  })
})
