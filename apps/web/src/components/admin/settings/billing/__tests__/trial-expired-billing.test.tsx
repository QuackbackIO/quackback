// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingProjectionOverview } from '@/lib/server/domains/billing/projection-overview'

vi.mock('@/lib/client/queries/billing', () => ({
  beginPlanDowngradeFn: vi.fn(() => new Promise(() => {})),
  cancelPlanDowngradeFn: vi.fn(),
  billingQueries: { all: ['billing'] },
}))

const { TrialExpiredBilling } = await import('../trial-expired-billing')

const EXPIRED = '2026-11-19T12:00:00.000Z'

const overview: BillingProjectionOverview = {
  plan: 'free',
  planName: 'Free',
  status: null,
  trialActive: false,
  trialEnded: true,
  trialExpiresAt: EXPIRED,
  trialPlanId: 'pro',
  trialPlanName: 'Pro',
  renewalAt: null,
  cancellationAt: null,
  canUpgrade: true,
  canManageBilling: false,
  purchasablePlans: [],
  seats: { used: 3, pending: 0, members: 3, purchased: null },
  ai: null,
  hideBranding: false,
}

function renderPage(
  props: {
    overview?: BillingProjectionOverview
    pending?: { planId: string; planName: string }
  } = {}
) {
  render(
    <IntlProvider locale="en" messages={{}}>
      <QueryClientProvider client={new QueryClient()}>
        <TrialExpiredBilling
          overview={props.overview ?? overview}
          catalogue={null}
          catalogueError={null}
          pending={props.pending ?? null}
        />
      </QueryClientProvider>
    </IntlProvider>
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('TrialExpiredBilling lead', () => {
  it('says the trial ended, what to choose, and that admin stays open during the grace period', () => {
    vi.setSystemTime(new Date(Date.parse(EXPIRED) + 3_600_000))
    renderPage()
    expect(screen.getByRole('heading', { name: 'Your Pro trial has ended' })).toBeInTheDocument()
    expect(screen.getByText(/keep Pro, or switch to Free/)).toBeInTheDocument()
    expect(screen.getByText(/The rest of admin stays open until/)).toBeInTheDocument()
  })

  it('says admin waits on the choice once the grace period is over', () => {
    vi.setSystemTime(new Date(Date.parse(EXPIRED) + 72 * 3_600_000))
    renderPage()
    expect(
      screen.getByText('The rest of admin opens again as soon as you choose a plan.')
    ).toBeInTheDocument()
  })

  it('has honest copy when the trial plan is unknown', () => {
    vi.setSystemTime(new Date(Date.parse(EXPIRED) + 72 * 3_600_000))
    renderPage({ overview: { ...overview, trialPlanName: null, trialPlanId: null } })
    expect(screen.getByRole('heading', { name: 'Your trial has ended' })).toBeInTheDocument()
    expect(screen.queryByText(/your plan/)).not.toBeInTheDocument()
    expect(screen.getByText(/pick a paid plan, or switch to Free/)).toBeInTheDocument()
  })

  it('speaks to someone who already chose Free', () => {
    vi.setSystemTime(new Date(Date.parse(EXPIRED) + 72 * 3_600_000))
    renderPage({ pending: { planId: 'free', planName: 'Free' } })
    expect(screen.getByText(/You chose Free/)).toBeInTheDocument()
    expect(
      screen.getByText(/only this page and the pages that fix those limits are open/)
    ).toBeInTheDocument()
  })
})
