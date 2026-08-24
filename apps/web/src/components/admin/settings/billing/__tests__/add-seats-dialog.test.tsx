// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import type { BillingProjectionOverview } from '@/lib/server/domains/billing/projection-overview'

const overview: BillingProjectionOverview = {
  plan: 'pro',
  planName: 'Pro',
  status: 'active',
  trialActive: false,
  trialExpiresAt: null,
  renewalAt: '2026-09-12T00:00:00.000Z',
  cancellationAt: null,
  canUpgrade: false,
  canManageBilling: true,
  purchasablePlans: [
    { id: 'growth', name: 'Growth' },
    { id: 'pro', name: 'Pro' },
    { id: 'scale', name: 'Scale' },
  ],
  seats: { used: 7, pending: 1, members: 6, purchased: 10 },
  ai: { includedCents: 3000, usedCents: 2520, extraCents: 1000 },
  hideBranding: false,
}

const catalogue: BillingCatalogue = {
  version: 1,
  currency: 'usd',
  annualDiscountMonths: 2,
  recommendedPlanId: 'pro',
  brandingRemoval: { monthlyCents: 5900, annualCents: 59000 },
  plans: [
    {
      id: 'pro',
      name: 'Pro',
      rank: 2,
      priceMonthlyCents: 3000,
      priceYearlyCents: 28800,
      billedPer: 'seat',
      bestFor: 'For teams working the inbox daily',
      highlights: ['Workflows & SLAs'],
      recommended: true,
    },
  ],
}

vi.mock('@/lib/client/queries/billing', () => ({
  billingQueries: {
    overview: () => ({
      queryKey: ['billing', 'overview'],
      queryFn: () => Promise.resolve(overview),
    }),
    catalogue: () => ({
      queryKey: ['billing', 'catalogue'],
      queryFn: () => Promise.resolve(catalogue),
    }),
    seatsPreview: () => ({
      queryKey: ['billing', 'seats-preview'],
      queryFn: () =>
        Promise.resolve({ amountDueCents: 1234, periodEnd: '2026-09-12T00:00:00.000Z' }),
    }),
  },
}))

import { AddSeatsDialog } from '../add-seats-dialog'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('AddSeatsDialog', () => {
  it('quotes the monthly sticker and due today, not yearly/12 totals', async () => {
    render(<AddSeatsDialog open onOpenChange={() => {}} />, { wrapper })

    expect(await screen.findByText('Your Pro plan is $30/seat.')).toBeInTheDocument()
    expect(screen.getByText('1 seat × $30/seat')).toBeInTheDocument()
    expect(screen.queryByText(/\/yr/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\$24/)).not.toBeInTheDocument()
    expect(await screen.findByText(/Due today, prorated to/)).toBeInTheDocument()
    expect(screen.getByText('$12.34')).toBeInTheDocument()
    expect(screen.getByText('New total · 11 seats')).toBeInTheDocument()
  })
})
