// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { portalUtility } from '@/test/portal-utilities'
import { defaultDesign } from '@/lib/shared/design/schema'
import { useState, type ReactNode } from 'react'
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { renderToString } from 'react-dom/server'

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
  linkRenders,
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
  // The label (or target) of each Link render, to tell which tabs rendered.
  linkRenders: [] as string[],
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    invalidate: vi.fn(),
    navigate: vi.fn(),
    state: { location: { pathname: '/' } },
  }),
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/' } }),
  useRouteContext: (opts?: { select?: (context: unknown) => unknown }) =>
    opts?.select ? opts.select(mockGetRouteContext()) : mockGetRouteContext(),
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
  }) => {
    const text = [children]
      .flat()
      .filter((part) => typeof part === 'string')
      .join('')
    linkRenders.push(text || to)
    return (
      <a href={to} className={className} {...(rest as React.HTMLAttributes<HTMLAnchorElement>)}>
        {children}
      </a>
    )
  },
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
  queryOptions: <T,>(options: T) => options,
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
import { foldMenu } from '../use-menu-fold'
import {
  PreviewAttributesContext,
  PreviewDraftProvider,
  type PortalPreviewDraft,
} from '../preview-draft-context'
import { VIEWER_SCOPED_PORTAL_QUERY_KEYS } from '@/lib/client/queries/portal'
import { DEFAULT_FEATURE_FLAGS, getProductFlagUpdate } from '@/lib/shared/types/settings'

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
  workspaceName = 'Acme',
}: {
  userRole?: 'admin' | 'member' | 'user' | null
  isLoggedIn: boolean
  workspaceName?: string
}) {
  mockGetRouteContext.mockReturnValue({
    session: isLoggedIn ? loggedInSession : null,
    settings: {
      name: workspaceName,
      headerDisplayName: 'Unused header',
      headerDisplayMode: 'logo_only',
    },
    registeredAuthProviders: [],
  })

  return render(
    <IntlProvider locale="en" defaultLocale="en">
      {/* showThemeToggle=false removes the theme dropdown trigger so the only
          remaining button is the avatar / user-dropdown trigger */}
      <PortalHeader orgName={workspaceName} userRole={userRole} showThemeToggle={false} />
    </IntlProvider>
  )
}

describe('PortalHeader — Admin dropdown item', () => {
  afterEach(() => cleanup())

  it('renders the workspace name after an update, with legacy header values present', () => {
    const view = renderHeader({ isLoggedIn: false })
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.queryByText('Unused header')).not.toBeInTheDocument()
    view.rerender(
      <IntlProvider locale="en" defaultLocale="en">
        <PortalHeader orgName="Acme team" showThemeToggle={false} />
      </IntlProvider>
    )
    expect(screen.getByText('Acme team')).toBeInTheDocument()
    expect(screen.queryByText('Acme')).not.toBeInTheDocument()
    expect(screen.queryByText('Unused header')).not.toBeInTheDocument()
  })

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

describe('PortalHeader — sign-out cache hygiene', () => {
  beforeEach(() => {
    mockInvalidateQueries.mockClear()
    mockRemoveQueries.mockClear()
    mockSignOut.mockClear()
  })
  afterEach(() => cleanup())

  it('removes (not merely invalidates) every viewer-scoped cache so internal tags do not outlive a team session', async () => {
    renderHeader({ userRole: 'admin', isLoggedIn: true })
    fireEvent.click(screen.getByRole('button'))
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

describe('PortalHeader branding preview drafts', () => {
  afterEach(() => cleanup())

  // The admin's branding preview streams unsaved drafts into the portal. The
  // header shows only the navigation draft, so a stylesheet or welcome-card
  // edit renders none of it. The header asks which sign-in methods exist once
  // per render, which counts its renders.
  it('renders again for a navigation draft only, and then only the tab it changed', () => {
    mockGetRouteContext.mockReturnValue({
      session: null,
      settings: {
        featureFlags: { ...DEFAULT_FEATURE_FLAGS, ...getProductFlagUpdate('feedback', true) },
      },
      registeredAuthProviders: [],
    })
    const drafts: {
      setDraft?: (draft: Omit<PortalPreviewDraft, 'css'>) => void
      setCss?: (css: string) => void
    } = {}
    function Preview({ children }: { children: ReactNode }) {
      const [draft, setDraft] = useState<Omit<PortalPreviewDraft, 'css'>>({})
      const [css, setCss] = useState('')
      drafts.setDraft = setDraft
      drafts.setCss = setCss
      return (
        <PreviewDraftProvider draft={draft} css={css}>
          {children}
        </PreviewDraftProvider>
      )
    }
    render(
      <IntlProvider locale="en" defaultLocale="en">
        <Preview>
          <PortalHeader orgName="Acme" showThemeToggle={false} />
        </Preview>
      </IntlProvider>
    )
    const renders = () => mockHasAny.mock.calls.length
    const settled = renders()
    expect(screen.getByRole('link', { name: 'Roadmap' })).toBeInTheDocument()

    act(() => drafts.setCss!(':root { --font-sans: Inter; }'))
    act(() =>
      drafts.setDraft!({
        welcomeCard: { body: { type: 'doc', content: [{ type: 'paragraph' }] } },
      })
    )
    expect(renders()).toBe(settled)

    linkRenders.length = 0
    act(() =>
      drafts.setDraft!({
        nav: {
          items: [
            { id: 'feedback', type: 'feedback' },
            { id: 'roadmap', type: 'roadmap', label: 'Plans' },
          ],
        },
      })
    )
    expect(renders()).toBe(settled + 1)
    expect(screen.getByRole('link', { name: 'Plans' })).toBeInTheDocument()
    expect(linkRenders).toContain('Plans')
    expect(linkRenders).not.toContain('Feedback')
    expect(linkRenders).not.toContain('Changelog')
  })
})

describe('PortalHeader — first paint', () => {
  it('server-renders the theme toggle, so it does not pop in and shift the header', () => {
    renderHeader({ isLoggedIn: false })
    cleanup()
    const html = renderToString(
      <IntlProvider locale="en" defaultLocale="en">
        <PortalHeader orgName="Acme" />
      </IntlProvider>
    )
    expect(html).toContain('Toggle theme')
  })
})

describe('PortalHeader — design layouts', () => {
  const mountWith = (portalDesign: unknown, attributes?: Record<string, string>) => {
    mockGetRouteContext.mockReturnValue({
      session: null,
      settings: { name: 'Acme', portalDesign },
      registeredAuthProviders: [],
    })
    return render(
      <IntlProvider locale="en" defaultLocale="en">
        <PreviewAttributesContext.Provider value={attributes}>
          <PortalHeader orgName="Acme" userRole={null} showThemeToggle={false} />
        </PreviewAttributesContext.Provider>
      </IntlProvider>
    )
  }
  const design = (header: string) => ({
    engine: 'v2',
    attributes: { 'data-qb-header': header },
    nav: defaultDesign().nav,
  })

  it('keeps two rows on the legacy theme and for a stacked design', () => {
    for (const portalDesign of [undefined, design('stacked')]) {
      const { container, unmount } = mountWith(portalDesign)
      const header = container.querySelector('header')!
      expect(header.querySelector('.md\\:block nav')).toBeNull()
      expect(header.querySelector('.justify-center nav')).toBeNull()
      unmount()
    }
  })

  it('puts the menu beside the logo for inline, with the two-row menu below md', () => {
    const { container } = mountWith(design('inline'))
    const header = container.querySelector('header')!
    expect(header.getAttribute('data-qb-section')).toBe('header')
    const rowMenu = header.querySelector('.md\\:block nav')
    const narrowMenu = header.querySelector('.md\\:hidden nav')
    expect(rowMenu).toBeTruthy()
    expect(narrowMenu).toBeTruthy()
  })

  it('follows the draft layout in the preview over the saved one', () => {
    const { container } = mountWith(design('stacked'), { 'data-qb-header': 'centered' })
    expect(container.querySelector('header .justify-center nav')).toBeTruthy()
  })

  it('never lets a wide wordmark shrink under the menu, and caps it to the header', () => {
    const { container } = mountWith(design('inline'))
    const logo = container.querySelector('[data-qb-part=logo]')!
    expect(logo.className.split(' ')).toContain('md:shrink-0')
  })

  it('lays the veil on a hero photo from the border’s edge, so no line shows under the header', () => {
    const { container } = mountWith(design('inline'))
    const header = container.querySelector('header')!
    expect(header.className.split(' ')).toContain('qb-header')
    const rule = portalUtility('qb-header')
    const photo = rule.slice(rule.indexOf("[data-qb-header-span='photo'] &"))
    expect(photo).toContain('border-color: transparent')
    // The first layer (the veil) carries its box: from the padding's edge it would repeat
    // into the 1px transparent bottom border and draw its deepest row there.
    const value = photo.slice(photo.indexOf('background:') + 11)
    let depth = 0
    const end = [...value].findIndex((c) => {
      depth += c === '(' ? 1 : c === ')' ? -1 : 0
      return c === ',' && depth === 0
    })
    expect(value.slice(0, end).trim()).toMatch(/^linear-gradient\(.*\) border-box$/)
  })

  describe('a centred header', () => {
    const mountCentred = ({
      isLoggedIn = false,
      signup = true,
      role = null as 'admin' | null,
    } = {}) => {
      mockHasAny.mockReturnValue(true)
      mockHasDistinctSignup.mockReturnValue(signup)
      mockGetRouteContext.mockReturnValue({
        session: isLoggedIn ? loggedInSession : null,
        settings: { name: 'Acme', portalDesign: design('centered') },
        registeredAuthProviders: [],
      })
      const { container } = render(
        <IntlProvider locale="en" defaultLocale="en">
          <PortalHeader orgName="Acme" userRole={role} />
        </IntlProvider>
      )
      const row = container.querySelector('[data-qb-header-row]')!
      return {
        row,
        lead: row.querySelector('[data-qb-header-lead]')!,
        actions: row.querySelector('[data-qb-header-actions]')!,
      }
    }
    afterEach(() => {
      cleanup()
      mockHasAny.mockReturnValue(false)
      mockHasDistinctSignup.mockReturnValue(true)
    })
    const labels = (el: Element) =>
      [...el.querySelectorAll('button, a')].map(
        (b) => b.getAttribute('aria-label') || b.textContent?.trim()
      )

    it('balances its row: the toggle and Log in lead at the start, Sign up ends it', () => {
      const { row, lead, actions } = mountCentred()
      // Three columns from md: start, the logo, end; each edge on the content column's.
      expect(row.className.split(' ')).toEqual(
        expect.arrayContaining(['md:grid', 'md:grid-cols-[1fr_auto_1fr]'])
      )
      expect(labels(lead)).toEqual([expect.stringMatching(/theme/i), 'Log in'])
      expect(labels(actions)).toEqual(['Sign up'])
      expect(lead.className.split(' ')).toContain('md:justify-self-start')
      expect(actions.className.split(' ')).toContain('md:justify-self-end')
      // The logo sits between the two, in the middle column.
      const order = [...row.children]
      expect(order.indexOf(lead)).toBeLessThan(
        order.indexOf(row.querySelector('[data-qb-part=logo]')!)
      )
      expect(order.indexOf(row.querySelector('[data-qb-part=logo]')!)).toBeLessThan(
        order.indexOf(actions)
      )
    })

    it('on a phone keeps the logo first and every button together at the end', () => {
      const { lead, actions } = mountCentred()
      // Below md the row is a flex line: the logo (order 0), then the lead pushed to the end.
      expect(lead.className.split(' ')).toEqual(
        expect.arrayContaining(['order-1', 'ms-auto', 'md:order-none', 'md:ms-0'])
      )
      expect(actions.className.split(' ')).toEqual(
        expect.arrayContaining(['order-2', 'md:order-none'])
      )
    })

    it('ends with the sole Log in when sign-up is the same, the toggle still leading', () => {
      const { lead, actions } = mountCentred({ signup: false })
      expect(labels(lead)).toEqual([expect.stringMatching(/theme/i)])
      expect(labels(actions)).toEqual(['Log in'])
    })

    it('keeps the account menu at the end when signed in, the admin tools leading', () => {
      const { lead, actions } = mountCentred({ isLoggedIn: true, role: 'admin' })
      expect(labels(actions)).toContain('Open account menu')
      expect(labels(lead)).toContain('Admin')
      expect(labels(lead)).not.toContain('Open account menu')
    })
  })

  describe('an inline menu wider than the room beside the logo', () => {
    let observers: Array<() => void> = []
    const size = (el: Element, sizes: Record<string, number>) => {
      for (const [k, v] of Object.entries(sizes))
        Object.defineProperty(el, k, { configurable: true, get: () => v })
    }
    beforeEach(() => {
      observers = []
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(private cb: () => void) {
            observers.push(() => this.cb())
          }
          observe() {}
          disconnect() {}
        }
      )
    })
    afterEach(() => vi.unstubAllGlobals())
    const resize = () => act(() => observers.forEach((run) => run()))

    it('moves to its own row at every width, and comes back once the row has room', () => {
      const { container } = mountWith(design('inline'))
      const header = container.querySelector('header')!
      const row = header.querySelector('[data-qb-header-row]')!
      // A wide wordmark and six pages: the menu needs 640px and is given 300.
      size(row, { clientWidth: 1000 })
      size(row.querySelector('[data-qb-part=logo]')!, { offsetWidth: 260 })
      size(row.querySelector('[data-qb-header-actions]')!, { offsetWidth: 240 })
      size(row.querySelector('[data-qb-nav-row]')!, { scrollWidth: 640, clientWidth: 300 })
      resize()
      expect(row.querySelector('nav')).toBeNull()
      const own = [...header.querySelectorAll('[data-qb-nav-row]')]
      expect(own).toHaveLength(1)
      expect(own[0]!.className).not.toContain('md:hidden')
      // Wider: 1400 - 260 - 240 - 32 = 868 of room for 640: beside the logo again.
      size(row, { clientWidth: 1400 })
      resize()
      expect(row.querySelector('nav')).toBeTruthy()
    })
  })

  it("folds by the menu's own width against the room beside the logo", () => {
    const read = (content: number, given: number, row = 1000) => ({
      menu: { content, given },
      row,
      logo: 260,
      actions: 240,
    })
    expect(foldMenu({ folded: false, needed: 0 }, read(400, 450))).toEqual({
      folded: false,
      needed: 0,
    })
    expect(foldMenu({ folded: false, needed: 0 }, read(640, 300))).toEqual({
      folded: true,
      needed: 640,
    })
    // Folded, it stays while 1000 - 260 - 240 - 32 = 468 is short of 640.
    expect(foldMenu({ folded: true, needed: 640 }, { ...read(0, 0), menu: null }).folded).toBe(true)
    expect(
      foldMenu({ folded: true, needed: 640 }, { ...read(0, 0, 1200), menu: null }).folded
    ).toBe(false)
  })
})
