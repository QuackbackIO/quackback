// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { focusManager, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'
import type { LaunchStatus } from '@/lib/shared/launch-checklist'

const hoisted = vi.hoisted(() => ({
  fetches: 0,
  progressFetches: 0,
  canView: true,
  role: 'admin',
  status: null as unknown,
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    onboardingStatus: () => ({
      queryKey: ['admin', 'onboarding'],
      queryFn: async () => {
        hoisted.fetches++
        return hoisted.status
      },
      staleTime: 0,
      refetchOnWindowFocus: true,
    }),
  },
}))
vi.mock('@/lib/server/functions/onboarding-progress', () => ({
  getOnboardingProgressFn: async () => {
    hoisted.progressFetches++
    return {}
  },
}))
vi.mock('@/lib/server/functions/admin', () => ({ setLaunchTaskResolutionFn: vi.fn() }))
vi.mock('@/lib/client/hooks/use-permission', () => ({
  usePermission: (permission: string) => permission === 'member.view' && hoisted.canView,
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useSessionContext: () => ({ user: { id: 'user_acme' } }),
  useUserRole: () => hoisted.role,
}))

import { LaunchPlanDock, LaunchPlanInHelp } from '../launch-plan-dock'
import { launchStatusQuery, onboardingProgressQuery } from '../use-launch-plan'

const NOW = Date.now()
const window_ = {
  startsAt: new Date(NOW - 86_400_000).toISOString(),
  endsAt: new Date(NOW + 13 * 86_400_000).toISOString(),
}
const open: LaunchStatus = {
  hasBoards: true,
  hasPublicBoard: true,
  memberCount: 1,
  hasBranding: false,
  launchWindow: window_,
  inLaunchWindow: true,
  goals: ['product_feedback', 'customer_support', 'help_center'],
  features: {
    supportInbox: true,
    helpCenter: true,
    statusPage: false,
    integrations: true,
    assistant: false,
  },
}
// Every chore is done: the plan still waits for a customer.
const choresDone: LaunchStatus = {
  ...open,
  publicBoardLinkCopiedAt: '2026-10-03T10:00:00.000Z',
  hasWidgetInstalled: true,
  hasWidgetEnabled: true,
  hasHelpArticle: true,
  hasBranding: true,
  hasPublishedChangelog: true,
  hasIntegration: true,
  memberCount: 2,
}
const resolved: LaunchStatus = { ...choresDone, hasFirstWin: true }
const PROGRESS_KEY = ['onboarding', 'progress']

/** Home's own reads of the launch status and this person's markers. */
function HomeReads() {
  useQuery(launchStatusQuery())
  useQuery(launchStatusQuery({ poll: false }))
  useQuery(onboardingProgressQuery())
  return null
}

function mount(
  cached?: { status?: LaunchStatus; progress?: Record<string, string> },
  children: ReactNode = <LaunchPlanDock />
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (cached?.status) client.setQueryData(['admin', 'onboarding'], cached.status)
  if (cached?.progress) client.setQueryData(PROGRESS_KEY, cached.progress)
  const view = render(
    <IntlProvider locale="en" messages={en}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </IntlProvider>
  )
  return { ...view, client }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

function refocus() {
  act(() => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
  })
}

beforeEach(() => {
  localStorage.clear()
  hoisted.fetches = 0
  hoisted.progressFetches = 0
  hoisted.canView = true
  hoisted.role = 'admin'
  hoisted.status = open
})
afterEach(() => {
  cleanup()
  focusManager.setFocused(undefined)
})

describe('launch plan dock', () => {
  it("is a plain link to the Launch plan page with the plan's one count", async () => {
    mount({ status: open })
    const link = await screen.findByRole('link', { name: /Launch plan/ })
    expect(link).toHaveAttribute('href', '/admin/getting-started')
    expect(link).toHaveTextContent('Step 2 of 3')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('never loads the launch status itself: away from Home it shows the last count it saw', async () => {
    mount({ status: open })
    await screen.findByRole('link', { name: /Launch plan/ })
    cleanup()

    // Another page after a reload: nothing is loaded, and nothing is asked for.
    hoisted.status = choresDone
    mount()
    expect(await screen.findByRole('link', { name: /Launch plan/ })).toHaveTextContent(
      'Step 2 of 3'
    )
    refocus()
    await settle()
    expect(screen.getByRole('link', { name: /Launch plan/ })).toHaveTextContent('Step 2 of 3')
    expect(hoisted.fetches).toBe(0)
    expect(hoisted.progressFetches).toBe(0)
  })

  it('shows nothing on a page that has not loaded the plan and never saw it', async () => {
    mount()
    await settle()
    expect(screen.queryByRole('link', { name: /Launch plan/ })).toBeNull()
    expect(hoisted.fetches).toBe(0)
  })

  it('catches up as Home refetches on focus in the launch window', async () => {
    mount(
      { status: open, progress: {} },
      <>
        <HomeReads />
        <LaunchPlanDock />
      </>
    )
    expect(await screen.findByRole('link', { name: /Launch plan/ })).toHaveTextContent(
      'Step 2 of 3'
    )
    hoisted.status = choresDone
    refocus()
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Launch plan/ })).toHaveTextContent('Step 3 of 3')
    )
  })

  it('leaves Home alone on focus once the launch window has closed', async () => {
    const closed = { ...open, inLaunchWindow: false }
    hoisted.status = closed
    mount({ status: closed, progress: {} }, <HomeReads />)
    await settle()
    hoisted.fetches = 0
    refocus()
    await settle()
    expect(hoisted.fetches).toBe(0)
  })

  it('stays after the first win, marked done, until the win is dismissed', async () => {
    const { client } = mount({ status: resolved, progress: {} })
    const link = await screen.findByRole('link', { name: /Launch plan/ })
    expect(link).toHaveTextContent('Done')

    // Dismissing the win on Home writes the marker into the cache.
    act(() => client.setQueryData(PROGRESS_KEY, { firstWinShownAt: new Date().toISOString() }))
    await waitFor(() => expect(screen.queryByRole('link', { name: /Launch plan/ })).toBeNull())
    cleanup()

    // And stays gone after a reload, on a page that loaded the status but not the marker.
    mount({ status: resolved })
    await settle()
    expect(screen.queryByRole('link', { name: /Launch plan/ })).toBeNull()
    expect(hoisted.progressFetches).toBe(0)
  })

  it('says Done for a win it has not seen, on a page that has not loaded the marker', async () => {
    mount({ status: open })
    await screen.findByRole('link', { name: /Launch plan/ })
    cleanup()

    mount({ status: resolved })
    expect(await screen.findByRole('link', { name: /Launch plan/ })).toHaveTextContent('Done')
    expect(hoisted.progressFetches).toBe(0)
  })

  it('draws its track so it shows in a light theme', async () => {
    mount({ status: open })
    const link = await screen.findByRole('link', { name: /Launch plan/ })
    const track = link.querySelector('[aria-hidden="true"]')
    expect(track?.className).toContain('bg-foreground/10')
  })

  it('is absent for a teammate who is not an admin', async () => {
    hoisted.role = 'member'
    mount({ status: open })
    await settle()
    expect(screen.queryByRole('link', { name: /Launch plan/ })).toBeNull()
  })

  it('is absent once the launch window has closed', async () => {
    mount({ status: { ...open, inLaunchWindow: false } })
    await settle()
    expect(screen.queryByRole('link', { name: /Launch plan/ })).toBeNull()
  })

  it('is absent for someone who cannot see the team', async () => {
    hoisted.canView = false
    mount({ status: open })
    await settle()
    expect(screen.queryByRole('link', { name: /Launch plan/ })).toBeNull()
  })
})

const helpProbe = (
  <LaunchPlanInHelp>
    <p>offered</p>
  </LaunchPlanInHelp>
)
const offered = () => screen.queryByText('offered') !== null

describe('the Launch plan in Help', () => {
  it('is offered while any step of the plan is open, the win included', async () => {
    mount({ status: open }, helpProbe)
    expect(await screen.findByText('offered')).toBeTruthy()
    cleanup()

    // After the win, the optional steps still open keep it there.
    mount({ status: { ...resolved, hasIntegration: false } }, helpProbe)
    expect(await screen.findByText('offered')).toBeTruthy()
  })

  it('never loads the launch status itself, and remembers the last answer for other pages', async () => {
    mount({ status: open }, helpProbe)
    await screen.findByText('offered')
    cleanup()

    mount(undefined, helpProbe)
    expect(await screen.findByText('offered')).toBeTruthy()
    expect(hoisted.fetches).toBe(0)
  })

  it('goes once every step is done or skipped, and never comes for a teammate', async () => {
    mount({ status: resolved }, helpProbe)
    await settle()
    expect(offered()).toBe(false)
    cleanup()

    hoisted.role = 'member'
    mount({ status: open }, helpProbe)
    await settle()
    expect(offered()).toBe(false)
  })

  it('is not offered to a workspace that never had a launch plan', async () => {
    mount({ status: { ...open, launchWindow: null, inLaunchWindow: false } }, helpProbe)
    await settle()
    expect(offered()).toBe(false)
  })
})
