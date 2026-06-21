// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

// vi.hoisted ensures these mocks are available when the vi.mock factory runs
// (vi.mock calls are hoisted above imports by the Vitest transformer).
const { mockGetRouteContext } = vi.hoisted(() => ({
  mockGetRouteContext: vi.fn(),
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
  useAuthPopoverSafe: () => null,
}))

vi.mock('@/components/auth/oauth-buttons', () => ({
  hasAnyPortalAuthMethod: () => false,
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: null }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('@/lib/server/functions/chat', () => ({
  getMyConversationsFn: vi.fn(),
}))

vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  useAuthBroadcast: () => {},
}))

vi.mock('@/lib/client/auth-client', () => ({
  signOut: vi.fn(),
}))

vi.mock('@/components/notifications', () => ({
  NotificationBell: () => null,
}))

vi.mock('@/components/shared/user-stats', () => ({
  UserStatsBar: () => null,
}))

import { PortalHeader } from '../portal-header'

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
