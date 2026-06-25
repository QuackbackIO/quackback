// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PortalHeader } from '../portal-header'

type MockComponentProps = {
  children?: ReactNode
  className?: string
  onClick?: () => void
}

type PortalRouteContext = {
  session: null | {
    user: {
      id?: string
      name?: string | null
      email?: string | null
      image?: string | null
      principalType?: string | null
    }
  }
  settings: {
    featureFlags?: { helpCenter?: boolean; supportInbox?: boolean }
    helpCenterConfig?: { enabled?: boolean }
    portalConfig?: { support?: { enabled?: boolean } }
    publicPortalConfig?: { oauth?: Record<string, boolean | undefined> }
    verifiedDomains?: Array<{ verifiedAt: string | null }>
  }
  registeredAuthProviders: string[]
}

const mocks = vi.hoisted(() => ({
  pathname: '/',
  routeContext: {
    session: null,
    settings: {
      featureFlags: { helpCenter: false, supportInbox: false },
      helpCenterConfig: { enabled: false },
      portalConfig: { support: { enabled: false } },
      publicPortalConfig: { oauth: {} as Record<string, boolean | undefined> },
      verifiedDomains: [] as Array<{ verifiedAt: string | null }>,
    },
    registeredAuthProviders: [] as string[],
  } as PortalRouteContext,
  queryResult: { data: undefined as unknown },
  queryOptions: undefined as unknown,
  invalidate: vi.fn(),
  navigate: vi.fn(),
  queryInvalidate: vi.fn(),
  setTheme: vi.fn(),
  signOut: vi.fn(),
  openAuthPopover: vi.fn(),
  oauth2: vi.fn(),
  hasAnyPortalAuthMethod: vi.fn(
    (
      authConfig: Record<string, boolean | undefined> = {},
      opts?: { ssoEnabled?: boolean; hasVerifiedDomain?: boolean }
    ) =>
      Boolean(
        authConfig.password ||
          authConfig.magicLink ||
          Object.entries(authConfig).some(
            ([key, enabled]) => enabled && !['email', 'password', 'magicLink'].includes(key)
          ) ||
          (opts?.ssoEnabled && opts.hasVerifiedDomain)
      )
  ),
  resolveSoleOidcProvider: vi.fn((): string | null => null),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className, onClick }: MockComponentProps & { to: string }) => (
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

vi.mock('react-intl', () => {
  const formatDefaultMessage = (
    defaultMessage: string,
    values?: Record<string, string | number>
  ) =>
    Object.entries(values ?? {}).reduce(
      (message, [key, value]) => message.replace(`{${key}}`, String(value)),
      defaultMessage
    )

  return {
    FormattedMessage: ({
      defaultMessage,
      values,
    }: {
      defaultMessage: string
      values?: Record<string, string | number>
    }) => <>{formatDefaultMessage(defaultMessage, values)}</>,
    useIntl: () => ({
      formatMessage: (
        descriptor: { defaultMessage: string },
        values?: Record<string, string | number>
      ) => formatDefaultMessage(descriptor.defaultMessage, values),
    }),
  }
})

vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopoverSafe: () => ({ openAuthPopover: mocks.openAuthPopover }),
}))

vi.mock('@/components/auth/oauth-buttons', () => ({
  hasAnyPortalAuthMethod: (
    authConfig: Record<string, boolean | undefined>,
    opts?: { ssoEnabled?: boolean; hasVerifiedDomain?: boolean }
  ) => mocks.hasAnyPortalAuthMethod(authConfig, opts),
  resolveSoleOidcProvider: (authConfig: Record<string, boolean | undefined>) =>
    mocks.resolveSoleOidcProvider(authConfig),
}))

vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  useAuthBroadcast: vi.fn(),
}))

vi.mock('@/lib/client/auth-client', () => ({
  signOut: () => mocks.signOut(),
  authClient: {
    signIn: {
      oauth2: (options: unknown) => mocks.oauth2(options),
    },
  },
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
  Button: ({ children, className, onClick, asChild }: MockComponentProps & { asChild?: boolean }) =>
    asChild ? (
      <>{children}</>
    ) : (
      <button type="button" className={className} onClick={onClick}>
        {children}
      </button>
    ),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: MockComponentProps) => <div>{children}</div>,
  DropdownMenuContent: ({ children, className }: MockComponentProps & { align?: string }) => (
    <div role="menu" className={className}>
      {children}
    </div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
    asChild,
  }: MockComponentProps & { asChild?: boolean }) => {
    const content =
      asChild && typeof children === 'object' && children !== null && 'props' in children
        ? ((children as { props?: { children?: ReactNode } }).props?.children ?? children)
        : children

    return (
      <button type="button" role="menuitem" onClick={onClick}>
        {content}
      </button>
    )
  },
  DropdownMenuLabel: ({ children, className }: MockComponentProps) => (
    <div className={className}>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: MockComponentProps & { asChild?: boolean }) => <>{children}</>,
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
  mocks.oauth2.mockResolvedValue({ data: null })
  mocks.resolveSoleOidcProvider.mockReturnValue(null)
  mocks.hasAnyPortalAuthMethod.mockImplementation(
    (
      authConfig: Record<string, boolean | undefined> = {},
      opts?: { ssoEnabled?: boolean; hasVerifiedDomain?: boolean }
    ) =>
      Boolean(
        authConfig.password ||
          authConfig.magicLink ||
          Object.entries(authConfig).some(
            ([key, enabled]) => enabled && !['email', 'password', 'magicLink'].includes(key)
          ) ||
          (opts?.ssoEnabled && opts.hasVerifiedDomain)
      )
  )
})

afterEach(() => cleanup())

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

  it('shows an Admin menu item in the user dropdown for team members', () => {
    mocks.routeContext = {
      session: {
        user: {
          id: 'usr_1',
          name: 'Test User',
          email: 'test@example.com',
          image: null,
          principalType: 'user',
        },
      },
      settings: {},
      registeredAuthProviders: [],
    }

    render(<PortalHeader orgName="Acme" userRole="admin" showThemeToggle={false} />)

    expect(screen.getByRole('menuitem', { name: /Admin/i })).toBeInTheDocument()
  })

  it('hides the Admin menu item for portal users', () => {
    mocks.routeContext = {
      session: {
        user: {
          id: 'usr_1',
          name: 'Test User',
          email: 'test@example.com',
          image: null,
          principalType: 'user',
        },
      },
      settings: {},
      registeredAuthProviders: [],
    }

    render(<PortalHeader orgName="Acme" userRole="user" showThemeToggle={false} />)

    expect(screen.getByRole('menuitem', { name: /Settings/i })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Admin/i })).toBeNull()
  })

  it('redirects straight to the sole OIDC provider on Log in, skipping the dialog', () => {
    mocks.routeContext = {
      session: null,
      settings: {
        publicPortalConfig: { oauth: { oidc_entra: true } },
        verifiedDomains: [],
      },
      registeredAuthProviders: [],
    }
    mocks.resolveSoleOidcProvider.mockReturnValue('oidc_entra')

    render(<PortalHeader orgName="Acme" userRole={null} showThemeToggle={false} />)

    fireEvent.click(screen.getByRole('button', { name: /Log in/i }))

    expect(mocks.oauth2).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'oidc_entra' }))
    expect(mocks.openAuthPopover).not.toHaveBeenCalled()
  })

  it('opens the dialog on Log in when more than one method exists', () => {
    mocks.routeContext = {
      session: null,
      settings: {
        publicPortalConfig: { oauth: { password: true, oidc_entra: true } },
        verifiedDomains: [],
      },
      registeredAuthProviders: [],
    }
    mocks.resolveSoleOidcProvider.mockReturnValue(null)

    render(<PortalHeader orgName="Acme" userRole={null} showThemeToggle={false} />)

    fireEvent.click(screen.getByRole('button', { name: /Log in/i }))

    expect(mocks.openAuthPopover).toHaveBeenCalledWith(expect.objectContaining({ mode: 'login' }))
    expect(mocks.oauth2).not.toHaveBeenCalled()
  })
})