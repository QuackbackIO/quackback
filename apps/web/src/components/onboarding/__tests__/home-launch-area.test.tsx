// @vitest-environment happy-dom
/**
 * Home's try-it slot holds the Try it yourself card only in the launch window,
 * and only when one of its test actions will work.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
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

import { HomeLaunchArea } from '../home-try-it'

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

beforeEach(() => {
  hoisted.context = { goals: ['product_feedback'], feedbackPrivate: false }
  hoisted.flags = { feedback: true, supportInbox: true }
  hoisted.canConverse = true
  hoisted.status = status()
  hoisted.progress = {}
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("Home's try-it slot", () => {
  it('shows the Try it yourself card in the launch window with the actions that work', async () => {
    hoisted.status = status({ canPostTestIdea: false })
    render(providers(<HomeLaunchArea flags={hoisted.flags as never} />))
    expect(await screen.findByText('Try it yourself')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send a message' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Post an idea' })).toBeNull()
  })

  it('leaves the card out past the launch window', async () => {
    hoisted.status = status({ launchWindow: null, inLaunchWindow: false })
    render(providers(<HomeLaunchArea flags={hoisted.flags as never} />))
    await waitFor(() => expect(screen.queryByText('Take the 60-second tour')).toBeNull())
    expect(screen.queryByText('Try it yourself')).toBeNull()
  })

  it('leaves the card out when no test path would work', async () => {
    hoisted.canConverse = false
    render(providers(<HomeLaunchArea flags={hoisted.flags as never} />))
    expect(await screen.findByText('Take the 60-second tour')).toBeVisible()
    expect(screen.queryByText('Try it yourself')).toBeNull()
  })
})
