// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import { BillingPlansView } from '../billing-settings'

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
      id: 'free',
      name: 'Free',
      rank: 0,
      priceMonthlyCents: 0,
      priceYearlyCents: 0,
      billedPer: 'workspace',
      bestFor: 'Solo',
      highlights: ['1 seat'],
      recommended: false,
    },
    {
      id: 'growth',
      name: 'Growth',
      rank: 1,
      priceMonthlyCents: 3200,
      priceYearlyCents: 30000,
      billedPer: 'seat',
      bestFor: 'Small teams',
      highlights: ['Custom domain'],
      recommended: false,
    },
    {
      id: 'pro',
      name: 'Pro',
      rank: 2,
      priceMonthlyCents: 6200,
      priceYearlyCents: 58800,
      billedPer: 'seat',
      bestFor: 'Automation',
      highlights: ['Workflows'],
      recommended: true,
    },
    {
      id: 'scale',
      name: 'Scale',
      rank: 3,
      priceMonthlyCents: 11500,
      priceYearlyCents: 106800,
      billedPer: 'seat',
      bestFor: 'SSO',
      highlights: ['Audit log'],
      recommended: false,
    },
  ],
}

const overview = {
  plan: 'pro' as const,
  planName: 'Pro',
  status: 'active',
  trialExpiresAt: null,
  renewalAt: '2026-09-14T00:00:00.000Z',
  cancellationAt: null,
  canUpgrade: false,
  canManageBilling: true,
  purchasablePlans: [
    { id: 'growth' as const, name: 'Growth' },
    { id: 'pro' as const, name: 'Pro' },
    { id: 'scale' as const, name: 'Scale' },
  ],
}

describe('BillingPlansView', () => {
  it('renders catalogue cards, current plan, and invoices', () => {
    render(
      <BillingPlansView
        overview={overview}
        catalogue={catalogue}
        catalogueError={null}
        invoices={[
          {
            id: 'in_1',
            number: 'INV-1001',
            createdAt: '2026-08-14T00:00:00.000Z',
            amountCents: 6200,
            currency: 'usd',
            status: 'paid',
            hostedUrl: 'https://billing.example.com/invoice/in_1',
          },
        ]}
        invoicesError={null}
      />
    )

    expect(screen.getByRole('heading', { name: 'Current plan' })).toBeInTheDocument()
    expect(screen.getByText(/Renews on/)).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.getByText('Current')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Current plan' })).toBeDisabled()
    const change = screen.getByRole('button', { name: 'Change to Scale' })
    expect(change).toBeInTheDocument()
    const form = change.closest('form')
    expect(form).toHaveAttribute('action', '/api/billing/session')
    expect(form?.querySelector('input[name="action"]')).toHaveValue('checkout')
    expect(form?.querySelector('input[name="planId"]')).toHaveValue('scale')
    expect(form?.querySelector('input[name="billingPeriod"]')).toHaveValue('annual')
    expect(screen.getByText('INV-1001')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View/ })).toHaveAttribute(
      'href',
      'https://billing.example.com/invoice/in_1'
    )
  })

  it('shows finite usage as N of M', () => {
    render(
      <BillingPlansView
        overview={overview}
        catalogue={catalogue}
        catalogueError={null}
        invoices={[]}
        invoicesError={null}
        usage={[
          { key: 'maxBoards', label: 'boards', used: 1, limit: 3 },
          { key: 'maxTeamSeats', label: 'seats', used: 1, limit: 1 },
        ]}
      />
    )
    expect(screen.getByRole('heading', { name: 'Usage' })).toBeInTheDocument()
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    expect(screen.getByText('1 of 1')).toBeInTheDocument()
  })

  it('shows annual monthly equivalent from the catalogue', () => {
    render(
      <BillingPlansView
        overview={overview}
        catalogue={catalogue}
        catalogueError={null}
        invoices={[]}
        invoicesError={null}
      />
    )
    expect(screen.getByText(/Upgrades apply immediately/)).toBeInTheDocument()
    expect(screen.getByText('$49')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Monthly' }))
    expect(screen.getByText('$62')).toBeInTheDocument()
  })
})
