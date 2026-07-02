// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
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
        id?: string
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
      publicAuthConfig: { oauth: {} as Record<string, boolean | undefined> },
      publicPortalConfig: {} as { oidcProviders?: unknown[] },
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
  oauth2: vi.fn(),
  hasAnyPortalAuthMethod: vi.fn((..._args: unknown[]): boolean => false),
  resolveSoleOidcProvider: vi.fn((..._args: unknown[]): string | null => null),
  // Toggled off by tests that need the header's avatar button to be the only
  // button present (NotificationBell mocked away entirely for those cases).
  showNotificationBell: true,
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

vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopoverSafe: () => ({ openAuthPopover: mocks.openAuthPopover }),
}))

vi.mock('@/components/auth/oauth-buttons', () => ({
  hasAnyPortalAuthMethod: (...args: unknown[]) => mocks.hasAnyPortalAuthMethod(...args),
  resolveSoleOidcProvider: (...args: unknown[]) => mocks.resolveSoleOidcProvider(...args),
}))

vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  useAuthBroadcast: vi.fn(),
}))

vi.mock('@/lib/client/auth-client', () => ({
  signOut: () => mocks.signOut(),
  authClient: { signIn: { oauth2: mocks.oauth2 } },
}))

vi.mock('@/lib/server/functions/chat', () => ({
  getMyConversationsFn: vi.fn(),
}))

vi.mock('@/lib/client/queries/portal-support', () => ({
  PORTAL_MY_CONVERSATIONS_QUERY_KEY: ['portal', 'my-conversations'],
}))

vi.mock('@/components/notifications', () => ({
  NotificationBell: ({ className }: { className?: string }) =>
    mocks.showNotificationBell ? (
      <button type="button" className={className}>
        Notifications
      </button>
    ) : null,
}))

vi.mock('@/components/shared/user-stats', () => ({
  UserStatsBar: () => null,
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
    // Radix's real DropdownMenuItem merges role="menuitem" onto the child even
    // when asChild is set (via Slot), so mirror that here rather than dropping
    // the role for asChild items (e.g. the Settings/Admin links).
    asChild ? (
      <div role="menuitem">{children}</div>
    ) : (
      <button type="button" role="menuitem" onClick={onClick}>
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

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      {ui}
    </IntlProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pathname = '/'
  mocks.routeContext = {
    session: null,
    settings: {
      featureFlags: { helpCenter: false, supportInbox: false },
      helpCenterConfig: { enabled: false },
      portalConfig: { support: { enabled: false } },
      publicAuthConfig: { oauth: {} },
      publicPortalConfig: {},
      verifiedDomains: [],
    },
    registeredAuthProviders: [],
  }
  mocks.queryResult = { data: undefined }
  mocks.queryOptions = undefined
  mocks.signOut.mockResolvedValue(undefined)
  mocks.invalidate.mockResolvedValue(undefined)
  mocks.hasAnyPortalAuthMethod.mockReturnValue(false)
  mocks.resolveSoleOidcProvider.mockReturnValue(null)
  mocks.showNotificationBell = true
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
        publicAuthConfig: { oauth: { password: true } },
        publicPortalConfig: {},
        verifiedDomains: [],
      },
      registeredAuthProviders: [],
    }
    mocks.queryResult = {
      data: {
        conversations: [{ unreadCount: 2 }, { unreadCount: 101 }, { unreadCount: null }],
      },
    }

    renderWithIntl(
      <PortalHeader orgName="Acme" orgLogo="/logo.png" userRole="admin" supportAccessGranted />
    )

    expect(screen.getByRole('link', { name: /Acme/ })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /My tickets/ })).toHaveAttribute('href', '/tickets')
    expect(screen.getByRole('link', { name: /Help Center/ })).toHaveAttribute('href', '/hc')
    expect(screen.getByRole('link', { name: /Support/ })).toHaveAttribute('href', '/support')
    expect(screen.getByLabelText('103 unread')).toHaveTextContent('99+')
    // Team members get an Admin link both as a standalone header button and as
    // an item in the user dropdown (dropdown is mocked open/always-rendered here).
    const adminLinks = screen.getAllByRole('link', { name: /Admin/ })
    expect(adminLinks.length).toBeGreaterThan(0)
    for (const link of adminLinks) {
      expect(link).toHaveAttribute('href', '/admin')
    }
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    expect(mocks.queryOptions).toMatchObject({
      queryKey: ['portal', 'my-conversations'],
      enabled: true,
      staleTime: 30_000,
    })

    fireEvent.click(screen.getByRole('menuitem', { name: /Sign out/ }))

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
        publicAuthConfig: { oauth: { password: true } },
        publicPortalConfig: {},
        verifiedDomains: [],
      },
      registeredAuthProviders: [],
    }
    mocks.hasAnyPortalAuthMethod.mockReturnValue(true)

    renderWithIntl(<PortalHeader orgName="Acme" supportAccessGranted />)

    expect(screen.getByRole('link', { name: /Feedback/ })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('link', { name: /My tickets/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(mocks.openAuthPopover).toHaveBeenCalledWith({ mode: 'login' })
    expect(mocks.openAuthPopover).toHaveBeenCalledWith({ mode: 'signup' })
  })
})

describe('PortalHeader — Admin dropdown item', () => {
  const loggedInSession = {
    user: {
      id: 'usr_1',
      name: 'Test User',
      email: 'test@example.com',
      image: null,
      principalType: 'user',
    },
  }

  function renderHeader({
    userRole,
    isLoggedIn,
  }: {
    userRole?: 'admin' | 'member' | 'user' | null
    isLoggedIn: boolean
  }) {
    mocks.showNotificationBell = false
    mocks.routeContext = {
      session: isLoggedIn ? loggedInSession : null,
      settings: {
        featureFlags: { helpCenter: false, supportInbox: false },
        helpCenterConfig: { enabled: false },
        portalConfig: { support: { enabled: false } },
        publicAuthConfig: { oauth: {} },
        publicPortalConfig: {},
        verifiedDomains: [],
      },
      registeredAuthProviders: [],
    }

    return renderWithIntl(
      // showThemeToggle=false removes the theme dropdown trigger so the only
      // remaining button is the avatar / user-dropdown trigger.
      <PortalHeader orgName="Acme" userRole={userRole} showThemeToggle={false} />
    )
  }

  afterEach(() => cleanup())

  it('shows an Admin item in the user dropdown for team members', async () => {
    renderHeader({ userRole: 'admin', isLoggedIn: true })
    // The avatar button is the only button in the header (theme toggle off,
    // NotificationBell mocked away, standalone Admin renders as a link).
    const trigger = screen.getByRole('button')
    fireEvent.click(trigger)
    expect(await screen.findByRole('menuitem', { name: /admin/i })).toBeInTheDocument()
  })

  it('hides the Admin item for portal users', async () => {
    renderHeader({ userRole: 'user', isLoggedIn: true })
    const trigger = screen.getByRole('button')
    fireEvent.click(trigger)
    // Wait for the dropdown to open (Settings will appear), then confirm
    // no Admin menuitem is present.
    await screen.findByRole('menuitem', { name: /settings/i })
    expect(screen.queryByRole('menuitem', { name: /admin/i })).toBeNull()
  })
})

describe('PortalHeader — single-IdP redirect', () => {
  beforeEach(() => {
    mocks.showNotificationBell = false
    mocks.hasAnyPortalAuthMethod.mockReturnValue(true) // the portal has a usable sign-in method
    mocks.resolveSoleOidcProvider.mockReturnValue(null)
  })
  afterEach(() => cleanup())

  function renderHeader({
    userRole,
    isLoggedIn,
  }: {
    userRole?: 'admin' | 'member' | 'user' | null
    isLoggedIn: boolean
  }) {
    mocks.routeContext = {
      session: isLoggedIn
        ? {
            user: {
              id: 'usr_1',
              name: 'Test User',
              email: 'test@example.com',
              image: null,
              principalType: 'user',
            },
          }
        : null,
      settings: {
        featureFlags: { helpCenter: false, supportInbox: false },
        helpCenterConfig: { enabled: false },
        portalConfig: { support: { enabled: false } },
        publicAuthConfig: { oauth: {} },
        publicPortalConfig: {},
        verifiedDomains: [],
      },
      registeredAuthProviders: [],
    }

    return renderWithIntl(
      <PortalHeader orgName="Acme" userRole={userRole} showThemeToggle={false} />
    )
  }

  it('redirects straight to the sole OIDC provider on Log in, skipping the dialog', () => {
    mocks.resolveSoleOidcProvider.mockReturnValue('oidc_entra')
    renderHeader({ userRole: null, isLoggedIn: false })
    fireEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(mocks.oauth2).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'oidc_entra' }))
    expect(mocks.openAuthPopover).not.toHaveBeenCalled()
  })

  it('opens the dialog on Log in when more than one method exists', () => {
    mocks.resolveSoleOidcProvider.mockReturnValue(null)
    renderHeader({ userRole: null, isLoggedIn: false })
    fireEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(mocks.openAuthPopover).toHaveBeenCalledWith(expect.objectContaining({ mode: 'login' }))
    expect(mocks.oauth2).not.toHaveBeenCalled()
  })
})
