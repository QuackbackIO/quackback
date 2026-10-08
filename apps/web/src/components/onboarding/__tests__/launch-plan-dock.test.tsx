// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'
import type { LaunchStatus } from '@/lib/shared/launch-checklist'

const hoisted = vi.hoisted(() => ({
  fetches: 0,
  fail: false,
  canView: true,
  role: 'admin',
  status: null as unknown,
  progress: {} as Record<string, string>,
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
        if (hoisted.fail) throw new Error('offline')
        return hoisted.status
      },
      staleTime: 0,
      refetchOnWindowFocus: true,
    }),
  },
}))
vi.mock('@/lib/server/functions/onboarding-progress', () => ({
  getOnboardingProgressFn: async () => ({ ...hoisted.progress }),
}))
vi.mock('@/lib/server/functions/admin', () => ({ setLaunchTaskResolutionFn: vi.fn() }))
vi.mock('@/lib/client/hooks/use-permission', () => ({
  usePermission: (permission: string) => permission === 'member.view' && hoisted.canView,
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useSessionContext: () => ({ user: { id: 'user_acme' } }),
  useUserRole: () => hoisted.role,
}))

import { LaunchPlanDock, useLaunchPlanInHelp } from '../launch-plan-dock'

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

function mount(cached?: LaunchStatus, children: ReactNode = <LaunchPlanDock />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (cached) client.setQueryData(['admin', 'onboarding'], cached)
  const view = render(
    <IntlProvider locale="en" messages={en}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </IntlProvider>
  )
  return { ...view, client }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

beforeEach(() => {
  localStorage.clear()
  hoisted.fetches = 0
  hoisted.fail = false
  hoisted.canView = true
  hoisted.role = 'admin'
  hoisted.status = open
  hoisted.progress = {}
})
afterEach(cleanup)

describe('launch plan dock', () => {
  it("is a plain link to the Launch plan page with the plan's one count", async () => {
    mount(open)
    const link = await screen.findByRole('link', { name: /Launch plan/ })
    expect(link).toHaveAttribute('href', '/admin/getting-started')
    expect(link).toHaveTextContent('Step 2 of 3')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('loads the launch status itself on a page that has not, and remembers it for a reload', async () => {
    mount()
    expect(await screen.findByRole('link', { name: /Launch plan/ })).toHaveTextContent(
      'Step 2 of 3'
    )
    expect(hoisted.fetches).toBe(1)
    cleanup()

    // A failing fetch after a reload still shows the last count it saw.
    hoisted.fail = true
    mount()
    expect(await screen.findByRole('link', { name: /Launch plan/ })).toHaveTextContent(
      'Step 2 of 3'
    )
  })

  it('catches up when the window regains focus, so another tab never goes stale', async () => {
    mount()
    expect(await screen.findByRole('link', { name: /Launch plan/ })).toHaveTextContent(
      'Step 2 of 3'
    )
    hoisted.status = choresDone
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Launch plan/ })).toHaveTextContent('Step 3 of 3')
    )
    focusManager.setFocused(undefined)
  })

  it('stays after the first win, marked done, until the win is dismissed', async () => {
    hoisted.status = resolved
    const { client } = mount()
    const link = await screen.findByRole('link', { name: /Launch plan/ })
    expect(link).toHaveTextContent('Done')

    hoisted.progress = { firstWinShownAt: new Date().toISOString() }
    await act(() => client.invalidateQueries({ queryKey: ['onboarding', 'progress'] }))
    await waitFor(() => expect(screen.queryByRole('link', { name: /Launch plan/ })).toBeNull())
    cleanup()

    // And stays gone after a reload.
    mount()
    await settle()
    expect(screen.queryByRole('link', { name: /Launch plan/ })).toBeNull()
  })

  it('draws its track so it shows in a light theme', async () => {
    mount(open)
    const link = await screen.findByRole('link', { name: /Launch plan/ })
    const track = link.querySelector('[aria-hidden="true"]')
    expect(track?.className).toContain('bg-foreground/10')
  })

  it('is absent for a teammate who is not an admin', async () => {
    hoisted.role = 'member'
    mount(open)
    await settle()
    expect(screen.queryByRole('link', { name: /Launch plan/ })).toBeNull()
  })

  it('is absent once the launch window has closed', async () => {
    hoisted.status = { ...open, inLaunchWindow: false }
    mount()
    await settle()
    expect(screen.queryByRole('link', { name: /Launch plan/ })).toBeNull()
  })

  it('is absent for someone who cannot see the team', async () => {
    hoisted.canView = false
    mount(open)
    await settle()
    expect(screen.queryByRole('link', { name: /Launch plan/ })).toBeNull()
    expect(hoisted.fetches).toBe(0)
  })
})

function HelpProbe() {
  return <p>{useLaunchPlanInHelp() ? 'offered' : 'not offered'}</p>
}

describe('the Launch plan in Help', () => {
  it('is offered while any step of the plan is open, the win included', async () => {
    mount(undefined, <HelpProbe />)
    expect(await screen.findByText('offered')).toBeTruthy()
    cleanup()

    // After the win, the optional steps still open keep it there.
    hoisted.status = { ...resolved, hasIntegration: false }
    mount(undefined, <HelpProbe />)
    expect(await screen.findByText('offered')).toBeTruthy()
  })

  it('goes once every step is done or skipped, and never comes for a teammate', async () => {
    hoisted.status = resolved
    mount(undefined, <HelpProbe />)
    await settle()
    expect(screen.getByText('not offered')).toBeTruthy()
    cleanup()

    hoisted.role = 'member'
    hoisted.status = open
    mount(undefined, <HelpProbe />)
    await settle()
    expect(screen.getByText('not offered')).toBeTruthy()
  })

  it('is not offered to a workspace that never had a launch plan', async () => {
    hoisted.status = { ...open, launchWindow: null, inLaunchWindow: false }
    mount(undefined, <HelpProbe />)
    await settle()
    expect(screen.getByText('not offered')).toBeTruthy()
  })
})
