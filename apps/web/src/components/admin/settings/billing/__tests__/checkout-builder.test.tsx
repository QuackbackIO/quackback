// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import type { BillingProjectionOverview } from '@/lib/server/domains/billing/projection-overview'
import { CheckoutBuilder, type CheckoutSelection } from '../checkout-builder'

vi.mock('../free-downgrade-dialog', () => ({
  FreeDowngradeDialog: () => <p>downgrade dialog</p>,
  PlanDowngradeDialog: () => <p>downgrade dialog</p>,
}))

const catalogue: BillingCatalogue = {
  version: 1,
  currency: 'usd',
  annualDiscountMonths: 2,
  recommendedPlanId: 'pro',
  brandingRemoval: { monthlyCents: 5900, annualCents: 59000 },
  trialDays: 14,
  trialedPlanIds: [],
  plans: [
    {
      id: 'free',
      name: 'Free',
      rank: 0,
      priceMonthlyCents: 0,
      priceYearlyCents: 0,
      billedPer: 'workspace',
      bestFor: 'For trying Quackback out',
      highlights: ['1 seat'],
      recommended: false,
    },
    {
      id: 'pro',
      name: 'Pro',
      rank: 1,
      priceMonthlyCents: 3700,
      priceYearlyCents: 34800,
      billedPer: 'workspace',
      bestFor: 'For small teams',
      highlights: ['Custom domain'],
      recommended: false,
    },
    {
      id: 'business',
      name: 'Business',
      rank: 2,
      priceMonthlyCents: 7500,
      priceYearlyCents: 70800,
      billedPer: 'workspace',
      bestFor: 'For inbox teams',
      highlights: ['Workflows & SLAs', 'Moderation'],
      recommended: true,
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      rank: 3,
      priceMonthlyCents: 12900,
      priceYearlyCents: 118800,
      billedPer: 'workspace',
      bestFor: 'For compliance needs',
      highlights: ['SSO', 'Audit log'],
      recommended: false,
    },
  ],
}

const freeOverview: BillingProjectionOverview = {
  plan: 'free',
  planName: 'Free',
  status: null,
  trialActive: false,
  trialExpiresAt: null,
  renewalAt: null,
  cancellationAt: null,
  canUpgrade: true,
  canManageBilling: false,
  purchasablePlans: [
    { id: 'pro', name: 'Pro' },
    { id: 'business', name: 'Business' },
    { id: 'enterprise', name: 'Enterprise' },
  ],
  seats: { used: 3, pending: 1, members: 2, purchased: null },
  ai: null,
  hideBranding: false,
}

const proOverview: BillingProjectionOverview = {
  ...freeOverview,
  plan: 'business',
  planName: 'Business',
  status: 'active',
  canManageBilling: true,
  seats: { used: 7, pending: 1, members: 6, purchased: null },
}

function renderBuilder(
  overview: BillingProjectionOverview,
  selection: Partial<CheckoutSelection> = {}
) {
  const onChange = vi.fn()
  render(
    <CheckoutBuilder
      overview={overview}
      catalogue={catalogue}
      selection={{ plan: 'business', period: 'annual', branding: false, ...selection }}
      onChange={onChange}
    />
  )
  return { onChange }
}

function checkoutForm(): HTMLFormElement | null {
  const marker = document.querySelector(
    'form[action="/api/billing/session"] input[value="checkout"]'
  )
  return marker ? marker.closest('form') : null
}

describe('CheckoutBuilder', () => {
  it('summarises the preselected plan and cycle and hands off to checkout', () => {
    renderBuilder(freeOverview)

    expect(screen.getByRole('radio', { name: /Yearly/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /Save \$192\/yr/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^Business/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByText('View & compare features').length).toBeGreaterThan(0)

    const summary = screen.getByRole('complementary')
    expect(within(summary).getByText('Business plan')).toBeInTheDocument()
    expect(within(summary).getByText('Workspace × $708/year')).toBeInTheDocument()
    expect(within(summary).getAllByText('$708/year')).toHaveLength(2)
    expect(within(summary).getByText('$59/mo')).toBeInTheDocument()

    const form = checkoutForm()
    expect(form?.querySelector('input[name="planId"]')).toHaveValue('business')
    expect(form?.querySelector('input[name="billingPeriod"]')).toHaveValue('annual')
    expect(form?.querySelector('input[name="quantity"]')).toHaveValue('1')
    expect(within(summary).getByRole('button', { name: 'Continue to payment' })).toBeEnabled()
  })

  it('offers the trial as an alternative to a Free workspace that has not tried the plan', () => {
    renderBuilder(freeOverview)
    expect(
      screen.getByRole('button', { name: /Or try Business free for 14 days/ })
    ).toBeInTheDocument()
  })

  it('reports selection changes without clearing the plan', () => {
    const { onChange } = renderBuilder(freeOverview)
    fireEvent.click(screen.getByRole('radio', { name: /Monthly/ }))
    expect(onChange).toHaveBeenCalledWith({ period: 'monthly' })
    fireEvent.click(screen.getByRole('radio', { name: /^Enterprise/ }))
    expect(onChange).toHaveBeenCalledWith({ plan: 'enterprise' })
  })

  it('prices monthly without a monthly-equivalent line', () => {
    renderBuilder(freeOverview, { period: 'monthly' })
    const summary = screen.getByRole('complementary')
    expect(within(summary).getByText('Workspace × $75/mo')).toBeInTheDocument()
    expect(within(summary).getAllByText('$75/mo')).toHaveLength(2)
    expect(within(summary).queryByText('Monthly equivalent')).not.toBeInTheDocument()
  })

  it('marks the current plan and disables checkout for it', () => {
    renderBuilder(proOverview, { plan: 'business' })
    expect(screen.getAllByText('Current').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Current plan' })).toBeDisabled()
    expect(checkoutForm()).toBeNull()
    expect(screen.getByRole('button', { name: 'Switch to Free' })).toBeInTheDocument()
  })

  it('explains pro-rata and end-of-period timing when moving between paid plans', () => {
    renderBuilder(proOverview, { plan: 'enterprise' })
    expect(screen.getByText(/Moving up applies now, billed pro-rata/)).toBeInTheDocument()
    renderBuilder(proOverview, { plan: 'pro' })
    expect(screen.getByText(/takes effect at the end of the current period/)).toBeInTheDocument()
  })

  it('gates a lower paid plan behind the quota dialog instead of posting checkout', () => {
    renderBuilder(proOverview, { plan: 'pro' })
    const summary = screen.getByRole('complementary')
    expect(checkoutForm()).toBeNull()
    expect(within(summary).getByRole('button', { name: 'Switch to Pro' })).toBeInTheDocument()
  })

  it('asks for a plan when none is selected', () => {
    renderBuilder(freeOverview, { plan: null })
    expect(screen.getByText('Pick a plan to see your total.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeDisabled()
  })

  it('adds branding removal to the same checkout when ticked', () => {
    const { onChange } = renderBuilder(freeOverview)
    expect(screen.getByText('Remove Quackback branding')).toBeInTheDocument()
    expect(screen.getByText('$590/yr')).toBeInTheDocument()
    expect(checkoutForm()?.querySelector('input[name="brandingRemoval"]')).toBeNull()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Add branding removal to the order' }))
    expect(onChange).toHaveBeenCalledWith({ branding: true })
  })

  it('prices the bundled add-on into the total and posts it with the plan', () => {
    renderBuilder(freeOverview, { branding: true })
    const summary = screen.getByRole('complementary')
    expect(within(summary).getByText('Remove branding')).toBeInTheDocument()
    expect(within(summary).getByText('$590/year')).toBeInTheDocument()
    expect(within(summary).getByText('$1,298/year')).toBeInTheDocument()
    expect(within(summary).getByText('$108/mo')).toBeInTheDocument()
    const form = checkoutForm()
    expect(form?.querySelector('input[name="planId"]')).toHaveValue('business')
    expect(form?.querySelector('input[name="brandingRemoval"]')).toHaveValue('true')
  })

  it('sells the add-on on its own when the plan is the current one', () => {
    renderBuilder(proOverview, { plan: 'business', branding: true })
    const summary = screen.getByRole('complementary')
    expect(within(summary).queryByText(/Workspace ×/)).not.toBeInTheDocument()
    expect(within(summary).getAllByText('$590/year')).toHaveLength(2)
    expect(checkoutForm()).toBeNull()
    const button = within(summary).getByRole('button', { name: 'Continue to payment' })
    const form = button.closest('form')
    expect(form?.querySelector('input[name="action"]')).toHaveValue('branding')
    expect(form?.querySelector('input[name="billingPeriod"]')).toHaveValue('annual')
    expect(screen.getByText(/only the add-on is charged/)).toBeInTheDocument()
  })

  it('shows branding removal as included and unselectable once owned', () => {
    renderBuilder({ ...freeOverview, hideBranding: true }, { branding: true })
    expect(screen.getByText('Included')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('complementary')).not.toHaveTextContent('Remove branding')
    expect(checkoutForm()?.querySelector('input[name="brandingRemoval"]')).toBeNull()
  })

  it('blocks checkout for teammates who cannot change the plan', () => {
    renderBuilder({ ...freeOverview, canUpgrade: false, canManageBilling: false })
    expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeDisabled()
    expect(screen.getByText('Only workspace owners can change the plan.')).toBeInTheDocument()
  })
})
