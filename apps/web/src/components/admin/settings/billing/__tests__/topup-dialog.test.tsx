// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'

const catalogue: { current: BillingCatalogue | null } = {
  current: {
    version: 1,
    currency: 'usd',
    annualDiscountMonths: 2,
    recommendedPlanId: 'pro',
    brandingRemoval: { monthlyCents: 5900, annualCents: 59000 },
    aiTopUpPackCents: 1000,
    emailTopUpPackCents: 1000,
    emailTopUpPackUnits: 10_000,
    plans: [],
  },
}

vi.mock('@/lib/client/queries/billing', () => ({
  billingQueries: {
    catalogue: () => ({
      queryKey: ['billing', 'catalogue'],
      queryFn: () => Promise.resolve(catalogue.current),
    }),
  },
}))

import { TopUpDialog } from '../topup-dialog'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('TopUpDialog', () => {
  it('quotes the catalogue pack price', async () => {
    catalogue.current = {
      version: 1,
      currency: 'usd',
      annualDiscountMonths: 2,
      recommendedPlanId: 'pro',
      brandingRemoval: { monthlyCents: 5900, annualCents: 59000 },
      aiTopUpPackCents: 1000,
      plans: [],
    }
    render(<TopUpDialog open meter="ai" onOpenChange={() => {}} />, { wrapper })
    expect(await screen.findByText(/\$10 per pack/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to checkout' })).toBeEnabled()
  })

  it('does not invent a $10 pack when the catalogue omits the price', async () => {
    catalogue.current = {
      version: 1,
      currency: 'usd',
      annualDiscountMonths: 2,
      recommendedPlanId: 'pro',
      brandingRemoval: { monthlyCents: 5900, annualCents: 59000 },
      plans: [],
    }
    render(<TopUpDialog open meter="ai" onOpenChange={() => {}} />, { wrapper })
    expect(await screen.findByRole('button', { name: 'Continue to checkout' })).toBeDisabled()
    expect(screen.queryByText(/\$10 per pack/)).not.toBeInTheDocument()
    expect(screen.queryByText('$10.00')).not.toBeInTheDocument()
  })
})
