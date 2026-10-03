// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ shown: false, claims: 0 }))
vi.mock('@/lib/client/hooks/use-root-context', () => ({ useSessionContext: () => null }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    invalidate: async (...args: unknown[]) => {
      expect(args).toHaveLength(0)
    },
  }),
}))
vi.mock('@/lib/server/functions/onboarding-progress', () => ({
  getOnboardingProgressFn: async () => ({ tourSeenAt: '2026-01-01' }),
  claimFirstWinMomentFn: async () => {
    state.claims++
    const show = !state.shown
    state.shown = true
    return { show }
  },
}))
vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    onboardingStatus: () => ({
      queryKey: ['admin', 'onboarding'],
      queryFn: async () => ({
        hasBoards: false,
        hasFirstWin: true,
        hasStatusComponent: true,
        memberCount: 1,
        hasBranding: false,
        goals: ['status_page'],
        features: { statusPage: true },
      }),
    }),
  },
}))
vi.mock('@/components/admin/settings/boards/create-board-dialog', () => ({
  CreateBoardDialog: () => null,
}))
vi.mock('@/lib/server/functions/admin', () => ({ setLaunchTaskResolutionFn: vi.fn() }))
import { HomeGettingStarted } from '../home-launch-plan'
afterEach(cleanup)
it('claims the celebration once and does not replay a cached claim on the next Home visit', async () => {
  state.shown = false
  state.claims = 0
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const home = () => (
    <IntlProvider locale="en">
      <QueryClientProvider client={client}>
        <HomeGettingStarted />
      </QueryClientProvider>
    </IntlProvider>
  )
  const first = render(home())
  await waitFor(() => expect(screen.getByText('Your first real result is here.')).toBeVisible())
  first.unmount()
  await new Promise((resolve) => setTimeout(resolve, 10))
  render(home())
  await waitFor(() => expect(state.claims).toBe(2))
  expect(screen.queryByText('Your first real result is here.')).toBeNull()
  client.clear()
})
