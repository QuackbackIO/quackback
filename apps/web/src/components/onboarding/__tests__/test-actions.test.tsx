// @vitest-environment happy-dom
/**
 * The cross-branch test actions: the tour end card's next step, the Launch
 * plan's first-win action and Home's try-it slot each open the test sheet,
 * and each offers only an action that will work.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Suspense, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { LaunchStatus } from '@/lib/shared/launch-checklist'

const hoisted = vi.hoisted(() => ({
  context: { goals: ['product_feedback'] as string[], feedbackPrivate: false },
  flags: { feedback: true, supportInbox: true } as Record<string, boolean>,
  canConverse: true,
  status: null as unknown,
  progress: {} as Record<string, string>,
}))

const router = vi.hoisted(() => ({
  state: { location: { pathname: '/admin' } },
  navigate: async () => undefined,
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => router,
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  createFileRoute: () => (options: unknown) => options,
}))
vi.mock('@/lib/server/functions/onboarding-progress', () => ({
  getTourContextFn: async () => ({
    ...hoisted.context,
    empty: { feedback: false, support: false, helpCenter: false, status: false },
  }),
  markTourSeenFn: async () => ({ ok: true }),
  getOnboardingProgressFn: async () => ({ ...hoisted.progress }),
  claimFirstWinMomentFn: async () => ({ show: false }),
  dismissTourOfferFn: async () => ({ ok: true }),
}))
vi.mock('@/lib/server/functions/admin', () => ({ setLaunchTaskResolutionFn: vi.fn() }))
vi.mock('@/lib/server/functions/activation', () => ({ markPublicBoardLinkCopiedFn: vi.fn() }))
vi.mock('@/lib/client/plg-events', () => ({ recordPlgEvent: vi.fn() }))
vi.mock('@/components/admin/settings/boards/create-board-dialog', () => ({
  CreateBoardDialog: () => null,
}))
vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    onboardingStatus: () => ({
      queryKey: ['admin', 'onboarding'],
      queryFn: async () => hoisted.status,
    }),
  },
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({ useFeatureFlags: () => hoisted.flags }))
vi.mock('@/lib/client/use-permissions', () => ({
  usePermissions: () => new Set([PERMISSIONS.MEMBER_VIEW, PERMISSIONS.CONVERSATION_VIEW]),
}))
vi.mock('@/lib/client/hooks/use-permission', () => ({
  usePermission: (permission: string) =>
    permission === PERMISSIONS.CONVERSATION_VIEW && hoisted.canConverse,
}))
vi.mock('../try-messenger-sheet', () => ({
  TryMessengerSheet: ({ open, start }: { open: boolean; start: string }) =>
    open ? <div role="region" aria-label="Test sheet">{`sheet:${start}`}</div> : null,
}))

import { useProductTour } from '../product-tour'
import { firstWinTestStart, tourTestStart } from '../test-actions'
import {
  AdminProductTourProvider,
  OPEN_TRY_MESSENGER_EVENT as HOST_EVENT,
} from '../admin-product-tour'
import { OPEN_TRY_MESSENGER_EVENT } from '../try-messenger-button'
import { Route as GettingStartedRoute } from '@/routes/admin/getting-started'

const NOW = Date.now()

function status(overrides: Record<string, unknown> = {}): LaunchStatus {
  return {
    hasBoards: true,
    hasPublicBoard: false,
    memberCount: 2,
    hasBranding: true,
    goals: ['product_feedback'],
    hasFirstWin: false,
    canPostTestIdea: true,
    launchWindow: {
      startsAt: new Date(NOW - 86_400_000).toISOString(),
      endsAt: new Date(NOW + 13 * 86_400_000).toISOString(),
    },
    inLaunchWindow: true,
    features: {
      supportInbox: true,
      helpCenter: false,
      statusPage: false,
      integrations: true,
      assistant: false,
    },
    ...overrides,
  } as LaunchStatus
}

function providers(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <IntlProvider locale="en" messages={en}>
      <QueryClientProvider client={client}>
        <Suspense fallback={null}>{children}</Suspense>
      </QueryClientProvider>
    </IntlProvider>
  )
}

function StartTour() {
  const tour = useProductTour()
  return (
    <button type="button" onClick={() => tour?.start()}>
      Start tour
    </button>
  )
}

async function finishTour() {
  render(
    providers(
      <AdminProductTourProvider>
        <StartTour />
        {[
          'products',
          'feedback-empty',
          'nav-feedback',
          'nav-roadmap',
          'support-empty',
          'nav-support',
          'view-portal',
          'search',
        ].map((target) => (
          <div key={target} data-tour={target} />
        ))}
      </AdminProductTourProvider>
    )
  )
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Start tour' }))
  })
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent(/1 of \d/))
  const total = Number(/1 of (\d)/.exec(screen.getByRole('dialog').textContent ?? '')![1])
  for (let step = 2; step <= total + 1; step++) {
    await act(async () => {
      fireEvent.keyDown(document, { key: 'ArrowRight' })
    })
    if (step <= total) {
      await waitFor(() =>
        expect(screen.getByRole('dialog')).toHaveTextContent(`${step} of ${total}`)
      )
    }
  }
  await waitFor(() => expect(screen.getByRole('dialog', { name: "That's the tour" })).toBeVisible())
}

beforeEach(() => {
  hoisted.context = { goals: ['product_feedback'], feedbackPrivate: false }
  hoisted.flags = { feedback: true, supportInbox: true }
  hoisted.canConverse = true
  hoisted.status = status()
  hoisted.progress = {}
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        x: 10,
        y: 100,
        left: 10,
        top: 100,
        right: 230,
        bottom: 140,
        width: 220,
        height: 40,
        toJSON: () => ({}),
      }) as DOMRect
  )
  HTMLElement.prototype.scrollIntoView = vi.fn()
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
  })) as unknown as typeof window.matchMedia
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the sheet host', () => {
  it('listens for the event the entry points send', () => {
    expect(HOST_EVENT).toBe(OPEN_TRY_MESSENGER_EVENT)
  })
})

describe('choosing the test action', () => {
  it('ends the tour on a message, or an idea when feedback is private and an idea can land', () => {
    expect(tourTestStart({ message: true, idea: true }, false)).toBe('message')
    expect(tourTestStart({ message: true, idea: true }, true)).toBe('idea')
    expect(tourTestStart({ message: true, idea: false }, true)).toBe('message')
    expect(tourTestStart({ message: false, idea: false }, true)).toBeNull()
    expect(tourTestStart({ message: false, idea: true }, false)).toBeNull()
  })

  it('matches the first-win step and offers nothing that cannot work', () => {
    expect(firstWinTestStart('feedback', { message: true, idea: true })).toBe('idea')
    expect(firstWinTestStart('feedback', { message: true, idea: false })).toBeNull()
    expect(firstWinTestStart('support', { message: true, idea: true })).toBe('message')
    expect(firstWinTestStart('support', { message: false, idea: true })).toBeNull()
    expect(firstWinTestStart('helpCenter', { message: true, idea: true })).toBeNull()
  })
})

describe('the tour end card', () => {
  it('sends a test message from the end card and opens the sheet', async () => {
    await finishTour()
    fireEvent.click(await screen.findByRole('button', { name: 'Send a test message' }))
    expect(screen.queryByRole('dialog', { name: "That's the tour" })).toBeNull()
    expect(await screen.findByRole('region', { name: 'Test sheet' })).toHaveTextContent(
      'sheet:message'
    )
  })

  it('posts a test idea when feedback is private', async () => {
    hoisted.context = { goals: ['product_feedback'], feedbackPrivate: true }
    await finishTour()
    fireEvent.click(await screen.findByRole('button', { name: 'Post a test idea' }))
    expect(await screen.findByRole('region', { name: 'Test sheet' })).toHaveTextContent(
      'sheet:idea'
    )
  })

  it('falls back to a message when a test idea could not land', async () => {
    hoisted.context = { goals: ['product_feedback'], feedbackPrivate: true }
    hoisted.status = status({ canPostTestIdea: false })
    await finishTour()
    expect(await screen.findByRole('button', { name: 'Send a test message' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Post a test idea' })).toBeNull()
  })

  it('offers only Done when no test action would work', async () => {
    hoisted.canConverse = false
    await finishTour()
    // The end card's action loads lazily; let it settle so its absence is real.
    await act(async () => {
      await import('../test-actions')
    })
    expect(screen.getByRole('button', { name: 'Done' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Send a test message' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Post a test idea' })).toBeNull()
  })
})

describe("the Launch plan's first-win step", () => {
  const Route = (GettingStartedRoute as unknown as { component: () => ReactNode }).component
  // The admin layout hosts the sheet the page's action opens.
  const Page = () => (
    <AdminProductTourProvider>
      <Route />
    </AdminProductTourProvider>
  )

  it('offers a test idea for "Get your first idea"', async () => {
    render(providers(<Page />))
    fireEvent.click(await screen.findByRole('button', { name: 'Post a test idea' }))
    expect(await screen.findByRole('region', { name: 'Test sheet' })).toHaveTextContent(
      'sheet:idea'
    )
  })

  it('offers a test message for the support first win', async () => {
    hoisted.status = status({ goals: ['customer_support'] })
    render(providers(<Page />))
    fireEvent.click(await screen.findByRole('button', { name: 'Send a test message' }))
    expect(await screen.findByRole('region', { name: 'Test sheet' })).toHaveTextContent(
      'sheet:message'
    )
  })

  it('offers no action when the matching test would not work', async () => {
    hoisted.status = status({ canPostTestIdea: false })
    render(providers(<Page />))
    expect(await screen.findByText('Marked done when it happens')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Post a test idea' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send a test message' })).toBeNull()
  })
})
