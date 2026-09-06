// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

const { mockPathname, mockGetRouteContext } = vi.hoisted(() => ({
  mockPathname: { value: '/' },
  mockGetRouteContext: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn(), navigate: vi.fn() }),
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: mockPathname.value } }),
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
  resolveSoleOidcProvider: () => null,
  hasDistinctSignup: () => true,
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: null }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('@/lib/server/functions/conversation', () => ({
  getMyConversationsFn: vi.fn(),
}))

vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  useAuthBroadcast: () => {},
}))

vi.mock('@/lib/client/auth-client', () => ({
  signOut: vi.fn(),
  authClient: { signIn: { oauth2: vi.fn() } },
}))

vi.mock('@/components/notifications', () => ({
  NotificationBell: () => null,
}))

vi.mock('@/components/shared/user-stats', () => ({
  UserStatsBar: () => null,
}))

import { PortalHeader } from '../portal-header'

const HEADER_LINKS = [
  { label: 'Community', url: 'https://community.example.com' },
  { label: 'Status', url: '/status' },
]

function renderHeader(pathname: string, headerLinks: { label: string; url: string }[] | undefined) {
  mockPathname.value = pathname
  mockGetRouteContext.mockReturnValue({
    session: null,
    settings: {
      featureFlags: { helpCenter: true },
      helpCenterConfig: { enabled: true, headerLinks },
    },
    registeredAuthProviders: [],
  })

  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <PortalHeader orgName="Acme" userRole={null} showThemeToggle={false} />
    </IntlProvider>
  )
}

describe('PortalHeader — help center header links', () => {
  afterEach(() => cleanup())

  it('renders configured links beside the nav on help center pages', () => {
    renderHeader('/hc', HEADER_LINKS)
    const community = screen.getByRole('link', { name: 'Community' })
    expect(community).toHaveAttribute('href', 'https://community.example.com')
    expect(community).toHaveAttribute('target', '_blank')
    const status = screen.getByRole('link', { name: 'Status' })
    expect(status).toHaveAttribute('href', '/status')
    expect(status).not.toHaveAttribute('target')
  })

  it('hides the links outside help center pages', () => {
    renderHeader('/', HEADER_LINKS)
    expect(screen.queryByRole('link', { name: 'Community' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Status' })).toBeNull()
  })

  it('renders nothing when no links are configured', () => {
    renderHeader('/hc', [])
    expect(screen.queryByRole('link', { name: 'Community' })).toBeNull()
  })

  it('tolerates a legacy config without the headerLinks field', () => {
    renderHeader('/hc', undefined)
    expect(screen.queryByRole('link', { name: 'Community' })).toBeNull()
  })
})
