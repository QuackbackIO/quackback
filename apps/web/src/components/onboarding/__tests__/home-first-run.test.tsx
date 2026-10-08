// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'
import type { LaunchStatus } from '@/lib/shared/launch-checklist'

const hoisted = vi.hoisted(() => ({
  status: null as unknown,
  progress: {} as Record<string, string>,
  card: vi.fn(),
  dismissWin: vi.fn(),
  dismiss: vi.fn(),
  start: vi.fn(),
}))

// Automatic branding has its own suite; here it has nothing to show.
vi.mock('@/components/admin/branding/use-automatic-website-branding', () => ({
  useAutomaticWebsiteBranding: () => ({
    status: null,
    pending: false,
    error: null,
    undo: vi.fn(),
    accept: vi.fn(),
    dismiss: vi.fn(),
  }),
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useWorkspaceSettings: () => ({ name: 'Acme' }),
  useBaseUrl: () => 'https://acme.example.com',
}))
vi.mock('@/lib/client/hooks/use-permission', () => ({ usePermission: () => true }))
const tourView = vi.hoisted(() => ({ narrow: false, copilot: false }))
vi.mock('@/components/admin/ask/copilot-on-home', () => ({
  useCopilotOnHome: () => tourView.copilot,
}))
vi.mock('@/lib/server/functions/activation', () => ({
  markPublicBoardLinkCopiedFn: vi.fn(),
  markStatusLinkCopiedFn: vi.fn(),
}))
vi.mock('@/lib/client/plg-events', () => ({ recordPlgEvent: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))
vi.mock('@/lib/server/functions/onboarding-progress', () => ({
  getOnboardingProgressFn: async () => ({ ...hoisted.progress }),
  getFirstWinCardFn: hoisted.card,
  dismissFirstWinFn: hoisted.dismissWin,
  dismissTourOfferFn: hoisted.dismiss,
}))
vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    onboardingStatus: () => ({
      queryKey: ['admin', 'onboarding'],
      queryFn: async () => hoisted.status,
    }),
  },
}))
vi.mock('@/components/admin/settings/boards/create-board-dialog', () => ({
  CreateBoardDialog: () => null,
}))
vi.mock('@/lib/server/functions/admin', () => ({ setLaunchTaskResolutionFn: vi.fn() }))
vi.mock('../product-tour', () => ({ useProductTour: () => ({ start: hoisted.start }) }))

import { HomeGettingStarted, HomeTourOffer } from '../home-launch-plan'

const NOW = Date.now()
const OPEN = {
  startsAt: new Date(NOW - 86_400_000).toISOString(),
  endsAt: new Date(NOW + 13 * 86_400_000).toISOString(),
}

function status(overrides: Partial<LaunchStatus> = {}): LaunchStatus {
  return {
    hasBoards: true,
    hasPublicBoard: true,
    memberCount: 1,
    hasBranding: false,
    goals: ['customer_support'],
    hasFirstWin: false,
    launchWindow: OPEN,
    inLaunchWindow: true,
    features: {
      supportInbox: true,
      helpCenter: false,
      statusPage: false,
      integrations: true,
      assistant: false,
    },
    ...overrides,
  }
}

/** Home's first-run blocks as Home lays them out: the plan area, then the tour offer last. */
function mount({ tour = true }: { tour?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <IntlProvider locale="en" messages={en}>
      <QueryClientProvider client={client}>
        <HomeGettingStarted />
        {tour ? <HomeTourOffer /> : null}
      </QueryClientProvider>
    </IntlProvider>
  )
  return { ...view, client }
}

beforeEach(() => {
  tourView.narrow = false
  tourView.copilot = false
  window.matchMedia = ((query: string) => ({
    matches: tourView.narrow && query.includes('max-width'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  hoisted.progress = {}
  hoisted.card.mockReset()
  hoisted.card.mockResolvedValue(null)
  hoisted.dismissWin.mockReset()
  hoisted.dismissWin.mockResolvedValue({ ok: true })
  hoisted.dismiss.mockReset()
  // The server records Not now on the person, so the next read carries it.
  hoisted.dismiss.mockImplementation(async () => {
    hoisted.progress = { ...hoisted.progress, tourDismissedAt: new Date().toISOString() }
    return { ok: true }
  })
  hoisted.start.mockReset()
})
afterEach(cleanup)

describe('Home first-run cards', () => {
  it('shows an established workspace none of them after an upgrade', async () => {
    hoisted.status = status({ launchWindow: null, inLaunchWindow: false, hasFirstWin: true })
    const { client } = mount()
    await waitFor(() => expect(client.getQueryData(['onboarding', 'progress'])).toBeDefined())
    expect(screen.queryByText('New here? Take the 60-second tour')).toBeNull()
    expect(screen.queryByText(/Launch plan ·/)).toBeNull()
    expect(screen.queryByRole('region', { name: /first customer/ })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Launch plan done.' })).toBeNull()
    expect(hoisted.card).not.toHaveBeenCalled()
  })

  it('offers the tour in the launch window and remembers Not now', async () => {
    hoisted.status = status()
    const { client } = mount()
    expect(await screen.findByText('New here? Take the 60-second tour')).toBeVisible()
    expect(screen.getByText('Launch plan · Step 2 of 3')).toBeVisible()
    expect(screen.queryByText('Try it yourself')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(hoisted.dismiss).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText('New here? Take the 60-second tour')).toBeNull())
    expect(hoisted.start).not.toHaveBeenCalled()
    expect(screen.getByText('Launch plan · Step 2 of 3')).toBeVisible()

    await client.invalidateQueries({ queryKey: ['onboarding', 'progress'] })
    expect(screen.queryByText('New here? Take the 60-second tour')).toBeNull()
  })

  it('puts the tour offer in the page as its own quiet card, never over the plan', async () => {
    hoisted.status = status()
    mount()
    const offer = await screen.findByRole('region', { name: 'New here? Take the 60-second tour' })
    expect(offer.className).not.toMatch(/\bfixed\b/)
    expect(offer.className).toContain('rounded-panel')
    // The plan's action is the one filled button; Take tour is drawn in outline.
    const take = within(offer).getByRole('button', { name: 'Take tour' })
    expect(take.className).not.toContain('bg-primary')
    expect(take.className).toContain('border')
    cleanup()

    // The plan area no longer carries the offer: Home places it last.
    const { client } = mount({ tour: false })
    await waitFor(() => expect(client.getQueryData(['admin', 'onboarding'])).toBeDefined())
    await screen.findByText('Launch plan · Step 2 of 3')
    expect(screen.queryByText('New here? Take the 60-second tour')).toBeNull()
  })

  it('starts the tour from the offer and hides the offer once it was seen', async () => {
    hoisted.status = status()
    mount()
    // The offer's own Start: a launch step done in place is a Start button too.
    const offer = await screen.findByRole('region', { name: 'New here? Take the 60-second tour' })
    fireEvent.click(within(offer).getByRole('button', { name: 'Take tour' }))
    expect(hoisted.start).toHaveBeenCalledTimes(1)
    cleanup()

    hoisted.progress = { tourSeenAt: new Date().toISOString() }
    const { client } = mount()
    await waitFor(() => expect(client.getQueryData(['onboarding', 'progress'])).toBeDefined())
    expect(screen.queryByText('New here? Take the 60-second tour')).toBeNull()
  })

  it('celebrates the first win, and keeps a quiet row to the optional steps', async () => {
    hoisted.status = status({ goals: ['product_feedback'], hasFirstWin: true })
    hoisted.card.mockResolvedValue({
      summary: {
        kind: 'idea',
        name: 'Ana',
        domain: 'northwind.com',
        subject: 'Export to CSV',
        votes: 1,
        avatarUrl: null,
        at: new Date(NOW).toISOString(),
        href: '/admin/feedback?post=post_1',
      },
    })
    mount()
    const card = await screen.findByRole('region', { name: 'Your first customer idea is in' })
    expect(card).toHaveTextContent('Ana from northwind.com · 1 vote')
    expect(card).toHaveTextContent('Export to CSV')
    expect(within(card).getByRole('link', { name: 'View idea' })).toHaveAttribute(
      'href',
      '/admin/feedback?post=post_1'
    )
    // The plan is done: Home no longer leads with a launch step, and says so once.
    expect(screen.queryByText(/Launch plan ·/)).toBeNull()
    const done = screen.getByRole('region', { name: 'Launch plan done.' })
    expect(within(done).getByRole('link', { name: '4 optional steps' })).toHaveAttribute(
      'href',
      '/admin/getting-started'
    )
  })

  it('keeps the plan row after the card is dismissed', async () => {
    hoisted.status = status({ hasFirstWin: true })
    hoisted.card.mockResolvedValue({ summary: null })
    mount()
    const card = await screen.findByRole('region', { name: 'Your first customer is here' })
    fireEvent.click(within(card).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(hoisted.dismissWin).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Your first customer is here' })).toBeNull()
    )
    expect(screen.getByRole('region', { name: 'Launch plan done.' })).toBeVisible()
  })

  it('lets the plan row go once every optional step is done or skipped', async () => {
    const skipped = { resolution: 'dismissed' as const, resolvedAt: new Date(NOW).toISOString() }
    hoisted.status = status({
      hasFirstWin: true,
      hasWidgetInstalled: true,
      hasWidgetEnabled: true,
      hasBranding: true,
      memberCount: 2,
      publicBoardLinkCopiedAt: new Date(NOW).toISOString(),
      taskResolutions: { customer_support: { 'connect-integration': skipped } },
    })
    hoisted.card.mockResolvedValue({ summary: null })
    mount()
    await screen.findByRole('region', { name: 'Your first customer is here' })
    expect(screen.queryByRole('region', { name: 'Launch plan done.' })).toBeNull()
  })

  it('does not ask for the card before a first win', async () => {
    hoisted.status = status()
    const { client } = mount()
    await waitFor(() => expect(client.getQueryData(['onboarding', 'progress'])).toBeDefined())
    expect(hoisted.card).not.toHaveBeenCalled()
  })

  it('stops offering the tour once the first win arrives', async () => {
    hoisted.status = status({ hasFirstWin: true })
    hoisted.card.mockResolvedValue({ summary: null })
    const { client } = mount()
    await screen.findByRole('region', { name: 'Your first customer is here' })
    await waitFor(() => expect(client.getQueryData(['onboarding', 'progress'])).toBeDefined())
    expect(screen.queryByText('New here? Take the 60-second tour')).toBeNull()
  })

  it('offers no tour on a phone, where the sidebar it points at is hidden', async () => {
    hoisted.status = status()
    tourView.narrow = true
    tourView.copilot = true
    const { client } = mount()
    await waitFor(() => expect(client.getQueryData(['onboarding', 'progress'])).toBeDefined())
    await screen.findByText('Launch plan · Step 2 of 3')
    expect(screen.queryByText('New here? Take the 60-second tour')).toBeNull()
  })
})
