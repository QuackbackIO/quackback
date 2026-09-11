// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

// vi.hoisted ensures these mocks are available when the vi.mock factory runs
// (vi.mock calls are hoisted above imports by the Vitest transformer).
const {
  mockGetRouteContext,
  mockOpenAuthPopover,
  mockSocial,
  mockResolveSole,
  mockHasAny,
  mockHasDistinctSignup,
  mockInvalidateQueries,
  mockRemoveQueries,
  mockSignOut,
} = vi.hoisted(() => ({
  mockGetRouteContext: vi.fn(),
  mockOpenAuthPopover: vi.fn(),
  mockSocial: vi.fn(),
  mockResolveSole: vi.fn((): string | null => null),
  mockHasAny: vi.fn((): boolean => false),
  mockHasDistinctSignup: vi.fn((): boolean => true),
  mockInvalidateQueries: vi.fn(() => Promise.resolve()),
  mockRemoveQueries: vi.fn(() => Promise.resolve()),
  mockSignOut: vi.fn(() => Promise.resolve()),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn(), navigate: vi.fn() }),
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/' } }),
  useRouteContext: () => mockGetRouteContext(),
  Link: ({
    to,
    children,
    className,
    ...rest
  }: {
    to: string
    children: React.ReactNode
    className?: string
    [key: string]: unknown
  }) => (
    <a href={to} className={className} {...(rest as React.HTMLAttributes<HTMLAnchorElement>)}>
      {children}
    </a>
  ),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}))

vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopoverSafe: () => ({ openAuthPopover: mockOpenAuthPopover }),
}))

vi.mock('@/components/auth/oauth-buttons', () => ({
  hasAnyPortalAuthMethod: () => mockHasAny(),
  resolveSoleOidcProvider: () => mockResolveSole(),
  hasDistinctSignup: () => mockHasDistinctSignup(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: null }),
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
    removeQueries: mockRemoveQueries,
  }),
}))

vi.mock('@/lib/server/functions/conversation', () => ({
  getMyConversationsFn: vi.fn(),
}))

vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  useAuthBroadcast: () => {},
}))

vi.mock('@/lib/client/auth-client', () => ({
  signOut: mockSignOut,
  authClient: { signIn: { social: mockSocial } },
}))

vi.mock('@/components/notifications', () => ({
  NotificationBell: () => null,
}))

vi.mock('@/components/shared/user-stats', () => ({
  UserStatsBar: () => null,
}))

import { PortalHeader } from '../portal-header'
import { VIEWER_SCOPED_PORTAL_QUERY_KEYS } from '@/lib/client/queries/portal'

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
  mockGetRouteContext.mockReturnValue({
    session: isLoggedIn ? loggedInSession : null,
    settings: {},
    registeredAuthProviders: [],
  })

  return render(
    <IntlProvider locale="en" defaultLocale="en">
      {/* showThemeToggle=false removes the theme dropdown trigger so the only
          remaining button is the avatar / user-dropdown trigger */}
      <PortalHeader orgName="Acme" userRole={userRole} showThemeToggle={false} />
    </IntlProvider>
  )
}

describe('PortalHeader — Admin dropdown item', () => {
  afterEach(() => cleanup())

  it('shows an Admin item in the user dropdown for team members', async () => {
    renderHeader({ userRole: 'admin', isLoggedIn: true })
    // The avatar button is the only button in the header (theme toggle off,
    // NotificationBell mocked away, standalone Admin renders as a link).
    const trigger = screen.getByRole('button')
    // Radix DropdownMenuTrigger opens on pointerDown (not click).
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    expect(await screen.findByRole('menuitem', { name: /admin/i })).toBeInTheDocument()
  })

  it('hides the Admin item for portal users', async () => {
    renderHeader({ userRole: 'user', isLoggedIn: true })
    const trigger = screen.getByRole('button')
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    // Wait for the dropdown to open (Settings will appear), then confirm
    // no Admin menuitem is present.
    await screen.findByRole('menuitem', { name: /settings/i })
    expect(screen.queryByRole('menuitem', { name: /admin/i })).toBeNull()
  })
})

describe('PortalHeader — sign-out cache hygiene', () => {
  beforeEach(() => {
    mockInvalidateQueries.mockClear()
    mockRemoveQueries.mockClear()
    mockSignOut.mockClear()
  })
  afterEach(() => cleanup())

  it('removes (not merely invalidates) every viewer-scoped cache so internal tags do not outlive a team session', async () => {
    renderHeader({ userRole: 'admin', isLoggedIn: true })
    fireEvent.pointerDown(screen.getByRole('button'), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitem', { name: /log out|sign out/i }))
    await vi.waitFor(() => expect(mockSignOut).toHaveBeenCalled())

    // Loaders read through ensureQueryData, which serves retained-but-stale
    // data, and a reset would restore initialData; only removal actually
    // drops the team-scoped payloads.
    await vi.waitFor(() => {
      const removedKeys = mockRemoveQueries.mock.calls.map(
        (call) => (call as unknown as [{ queryKey: unknown[] }])[0].queryKey
      )
      expect(removedKeys).toEqual(expect.arrayContaining([...VIEWER_SCOPED_PORTAL_QUERY_KEYS]))
    })
    expect(VIEWER_SCOPED_PORTAL_QUERY_KEYS).toEqual(
      expect.arrayContaining([
        ['portal', 'tags'],
        ['portal', 'data'],
        ['portal', 'post'],
        ['portal', 'roadmaps'],
        ['portal', 'roadmapPosts'],
        ['publicPosts'],
      ])
    )
  })
})

describe('PortalHeader — single-IdP redirect', () => {
  beforeEach(() => {
    mockOpenAuthPopover.mockClear()
    mockSocial.mockClear()
    mockHasAny.mockReturnValue(true) // the portal has a usable sign-in method
    mockResolveSole.mockReturnValue(null)
    mockHasDistinctSignup.mockReturnValue(true)
  })
  afterEach(() => cleanup())

  it('redirects straight to the sole OIDC provider on Log in, skipping the dialog', () => {
    mockResolveSole.mockReturnValue('oidc_entra')
    renderHeader({ userRole: null, isLoggedIn: false })
    fireEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(mockSocial).toHaveBeenCalledWith(expect.objectContaining({ provider: 'oidc_entra' }))
    expect(mockOpenAuthPopover).not.toHaveBeenCalled()
  })

  it('opens the dialog on Log in when more than one method exists', () => {
    mockResolveSole.mockReturnValue(null)
    renderHeader({ userRole: null, isLoggedIn: false })
    fireEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(mockOpenAuthPopover).toHaveBeenCalledWith(expect.objectContaining({ mode: 'login' }))
    expect(mockSocial).not.toHaveBeenCalled()
  })
})

describe('PortalHeader — Sign up button visibility', () => {
  beforeEach(() => {
    mockOpenAuthPopover.mockClear()
    mockHasAny.mockReturnValue(true)
    mockResolveSole.mockReturnValue(null)
  })
  afterEach(() => cleanup())

  it('shows both Log in and Sign up when sign-up is a distinct flow', () => {
    mockHasDistinctSignup.mockReturnValue(true)
    renderHeader({ userRole: null, isLoggedIn: false })
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument()
  })

  it('shows only Log in when sign-up would lead to the same form', () => {
    mockHasDistinctSignup.mockReturnValue(false)
    renderHeader({ userRole: null, isLoggedIn: false })
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign up/i })).toBeNull()
  })
})
