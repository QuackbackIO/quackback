// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import { describeEntitlementUpgrade } from '@/lib/shared/describe-upgrade'

const catalogue: BillingCatalogue = {
  version: 1,
  currency: 'usd',
  annualDiscountMonths: 2,
  recommendedPlanId: 'pro',
  aiOutcomePriceCents: 29,
  copilot: { freeConversationsPerSeat: 10, addonMonthlyCents: 1900, addonAnnualCents: 19000 },
  brandingRemoval: { monthlyCents: 5900, annualCents: 59000 },
  liteSeatsIncluded: { free: 0, growth: 5, pro: 25, scale: null },
  plans: [
    {
      id: 'scale',
      name: 'Scale',
      rank: 3,
      priceMonthlyCents: 11500,
      priceYearlyCents: 106800,
      billedPer: 'seat',
      bestFor: 'SSO and audit log',
      highlights: ['Audit log', 'SSO'],
      recommended: false,
    },
  ],
}

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({ billingEnabled: true }),
}))
vi.mock('@/lib/client/hooks/use-permission', () => ({
  usePermission: () => true,
}))

const { UpgradeOffer } = await import('../upgrade-offer')

function renderOffer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['billing', 'catalogue'], catalogue)
  return render(
    <QueryClientProvider client={client}>
      <UpgradeOffer description={describeEntitlementUpgrade('auditLog')} />
    </QueryClientProvider>
  )
}

describe('UpgradeOffer', () => {
  it('renders catalogue price and highlights on the first paint', () => {
    renderOffer()
    expect(screen.getByRole('heading', { name: 'Upgrade to Scale' })).toBeTruthy()
    expect(screen.getByText(/The audit log is a Scale feature/)).toBeTruthy()
    expect(screen.getByText('SSO and audit log')).toBeTruthy()
    expect(screen.getByText('Audit log')).toBeTruthy()
    expect(screen.getByText('SSO')).toBeTruthy()
    expect(screen.getByText('$89')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Upgrade to Scale' })).toBeTruthy()
    const form = document.querySelector('form')
    expect(form?.getAttribute('action')).toBe('/api/billing/session')
    expect((document.querySelector('input[name="planId"]') as HTMLInputElement)?.value).toBe(
      'scale'
    )
    expect((document.querySelector('input[name="billingPeriod"]') as HTMLInputElement)?.value).toBe(
      'annual'
    )
  })
})
