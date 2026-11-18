// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingProjectionOverview } from '@/lib/server/domains/billing/projection-overview'

vi.mock('@/lib/client/queries/billing', () => ({
  billingQueries: { all: ['billing'] },
}))

const { TrialExpiredBilling } = await import('../trial-expired-billing')
const { overLimits } = await import('./plan-limits-fixtures')

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
    limits?: ReturnType<typeof overLimits>
  } = {}
) {
  render(
    <IntlProvider locale="en" messages={{}}>
      <QueryClientProvider client={new QueryClient()}>
        <TrialExpiredBilling
          overview={props.overview ?? overview}
          catalogue={null}
          catalogueError={null}
          limits={props.limits}
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
  it('says the trial ended and what to choose, and holds no page back', () => {
    vi.setSystemTime(new Date(Date.parse(EXPIRED) + 72 * 3_600_000))
    renderPage()
    expect(screen.getByRole('heading', { name: 'Your Pro trial has ended' })).toBeInTheDocument()
    expect(screen.getByText(/upgrade to Pro, or downgrade to Free/)).toBeInTheDocument()
    expect(screen.queryByText(/rest of admin/)).not.toBeInTheDocument()
  })

  it('has honest copy when the trial plan is unknown', () => {
    vi.setSystemTime(new Date(Date.parse(EXPIRED) + 72 * 3_600_000))
    renderPage({ overview: { ...overview, trialPlanName: null, trialPlanId: null } })
    expect(screen.getByRole('heading', { name: 'Your trial has ended' })).toBeInTheDocument()
    expect(screen.queryByText(/your plan/)).not.toBeInTheDocument()
    expect(screen.getByText(/upgrade to a paid plan, or downgrade to Free/)).toBeInTheDocument()
  })
})

describe('TrialExpiredBilling with plan limits', () => {
  it('lists the caps over the plan above the plan choice, linking to Plan limits', async () => {
    renderPage({ limits: overLimits() })
    expect(
      await screen.findByRole('heading', { name: 'Over your limits' }, { timeout: 10_000 })
    ).toBeInTheDocument()
    expect(
      document.querySelector('[data-plan-limit-row="maxBoards"][data-status="over"]')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See plan limits' })).toHaveAttribute(
      'href',
      '/admin/settings/billing/limits'
    )
  })

  it('shows nothing extra without plan billing', () => {
    renderPage({ limits: overLimits({ enabled: false }) })
    expect(screen.queryByRole('heading', { name: 'Over your limits' })).toBeNull()
    expect(document.querySelector('[data-plan-limit-issues]')).toBeNull()
  })
})
