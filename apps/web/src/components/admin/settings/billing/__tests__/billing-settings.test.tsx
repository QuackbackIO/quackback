// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import type { BillingProjectionOverview } from '@/lib/server/domains/billing/projection-overview'
import { BillingPlansView } from '../billing-settings'

const catalogue: BillingCatalogue = {
  version: 1,
  currency: 'usd',
  annualDiscountMonths: 2,
  recommendedPlanId: 'pro',
  brandingRemoval: { monthlyCents: 5900, annualCents: 59000 },
  aiIncludedCentsPerMonth: { free: 0, growth: 1000, pro: 3000, scale: 10000 },
  aiTopUpPackCents: 1000,
  aiBlendedCentsPerMTok: 500,
  emailTopUpPackCents: 1000,
  emailTopUpPackUnits: 10_000,
  plans: [
    {
      id: 'free',
      name: 'Free',
      rank: 0,
      priceMonthlyCents: 0,
      priceYearlyCents: 0,
      billedPer: 'workspace',
      bestFor: 'For trying Quackback out',
      highlights: ['1 seat', 'Unlimited boards & posts'],
      recommended: false,
    },
    {
      id: 'growth',
      name: 'Growth',
      rank: 1,
      priceMonthlyCents: 1500,
      priceYearlyCents: 14400,
      billedPer: 'seat',
      bestFor: 'For small teams getting started',
      highlights: ['Custom domain', 'All AI features · $10/mo included'],
      recommended: false,
    },
    {
      id: 'pro',
      name: 'Pro',
      rank: 2,
      priceMonthlyCents: 3000,
      priceYearlyCents: 28800,
      billedPer: 'seat',
      bestFor: 'For teams working the inbox daily',
      highlights: ['Workflows & SLAs', '$30/mo AI usage included'],
      recommended: true,
    },
    {
      id: 'scale',
      name: 'Scale',
      rank: 3,
      priceMonthlyCents: 5900,
      priceYearlyCents: 58800,
      billedPer: 'seat',
      bestFor: 'For orgs with compliance needs',
      highlights: ['SSO (SAML & OIDC)', '$100/mo AI usage included'],
      recommended: false,
    },
  ],
}

const paidOverview: BillingProjectionOverview = {
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

function renderView(
  overrides: {
    overview?: BillingProjectionOverview
    catalogue?: BillingCatalogue | null
    usage?: Array<{ key: string; label: string; used: number; limit: number | null }>
  } = {}
) {
  return render(
    <BillingPlansView
      overview={overrides.overview ?? paidOverview}
      catalogue={overrides.catalogue === undefined ? catalogue : overrides.catalogue}
      catalogueError={null}
      invoices={[
        {
          id: 'in_1',
          number: 'INV-1001',
          createdAt: '2026-08-14T00:00:00.000Z',
          amountCents: 288000,
          currency: 'usd',
          status: 'paid',
          hostedUrl: 'https://billing.example.com/invoice/in_1',
        },
      ]}
      invoicesError={null}
      usage={overrides.usage}
    />
  )
}

describe('BillingPlansView', () => {
  it('renders the active paid plan, seat meter, and invoices', () => {
    renderView()

    expect(screen.getByRole('heading', { level: 2, name: 'Pro' })).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText(/Renews/)).toBeInTheDocument()
    expect(screen.getByText(/10 seats × \$30\/seat/)).toBeInTheDocument()
    expect(screen.queryByText(/\$24\/seat/)).not.toBeInTheDocument()
    expect(screen.queryByText(/billed annually/)).not.toBeInTheDocument()
    expect(screen.getByText(/7 of 10 used/)).toBeInTheDocument()
    expect(screen.getByText(/6 members · 1 pending invite · 3 seats available/)).toBeInTheDocument()
    expect(screen.getByText('Each member or pending invite uses a seat.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add seats' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Remove seats' })).toBeEnabled()
    expect(screen.getByRole('heading', { name: 'Plans' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Current plan' })).toBeDisabled()
    const switchLinks = screen.getAllByRole('link', { name: 'Switch to this plan' })
    expect(switchLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/admin/settings/billing/checkout?plan=growth&period=annual&seats=7',
      '/admin/settings/billing/checkout?plan=scale&period=annual&seats=7',
    ])
    expect(screen.getByText('INV-1001')).toBeInTheDocument()
  })

  it('shows AI usage in dollars and an emails meter', () => {
    renderView({
      usage: [{ key: 'emailsPerMonth', label: 'emails', used: 1840, limit: 10_000 }],
    })
    expect(screen.getByText('AI usage')).toBeInTheDocument()
    expect(screen.getByText('$25.20 of $30.00')).toBeInTheDocument()
    expect(screen.getByText(/\$30\/mo included, used first/)).toBeInTheDocument()
    expect(screen.getByText(/\$10\.00 extra credit/)).toBeInTheDocument()
    expect(screen.getByText('Emails')).toBeInTheDocument()
    expect(screen.getByText('Changelog and status-page mail this month.')).toBeInTheDocument()
    expect(screen.getByText('1,840 of 10,000')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Top up' })).toHaveLength(2)
    expect(screen.getByRole('heading', { name: 'Add-ons' })).toBeInTheDocument()
    expect(screen.getByText('Remove Quackback branding')).toBeInTheDocument()
    const addBranding = screen.getByRole('button', { name: 'Add' })
    expect(addBranding).toBeEnabled()
    const brandingForm = addBranding.closest('form')
    expect(brandingForm).toHaveAttribute('action', '/api/billing/session')
    expect(brandingForm?.querySelector('input[name="action"]')).toHaveValue('branding')
    expect(brandingForm?.querySelector('input[name="billingPeriod"]')).toHaveValue('annual')
  })

  it('lets a purchased branding add-on be removed', () => {
    renderView({ overview: { ...paidOverview, hideBranding: true } })
    const remove = screen.getByRole('button', { name: 'Remove' })
    expect(remove).toBeEnabled()
    expect(remove.closest('form')?.querySelector('input[name="action"]')).toHaveValue(
      'branding-remove'
    )
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
  })

  it('hides the seat meter on a grandfathered flat plan', () => {
    renderView({
      overview: {
        ...paidOverview,
        seats: { used: 4, pending: 0, members: 4, purchased: null },
        ai: null,
      },
      catalogue: {
        ...catalogue,
        plans: catalogue.plans.map((plan) =>
          plan.id === 'pro' ? { ...plan, billedPer: 'workspace' as const } : plan
        ),
      },
    })
    expect(screen.queryByText(/of \d+ used/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add seats' })).not.toBeInTheDocument()
    expect(screen.getByText(/Switching plans moves you onto per-seat pricing/)).toBeInTheDocument()
  })

  it('shows leftover AI extra credit on Free', () => {
    renderView({
      overview: {
        ...paidOverview,
        plan: 'free',
        planName: 'Free',
        status: null,
        canUpgrade: true,
        canManageBilling: true,
        renewalAt: null,
        seats: { used: 1, pending: 0, members: 1, purchased: null },
        ai: { includedCents: 0, usedCents: 0, extraCents: 1000 },
      },
    })
    expect(screen.getByText('AI usage')).toBeInTheDocument()
    expect(screen.getByText('$0.00 of $0.00')).toBeInTheDocument()
    expect(screen.getByText(/\$10\.00 extra credit/)).toBeInTheDocument()
  })

  it('hides the seat meter on Free and offers trials', () => {
    renderView({
      overview: {
        ...paidOverview,
        plan: 'free',
        planName: 'Free',
        status: null,
        canUpgrade: true,
        canManageBilling: false,
        renewalAt: null,
        seats: { used: 1, pending: 0, members: 1, purchased: null },
        ai: { includedCents: 0, usedCents: 0, extraCents: 0 },
      },
    })
    expect(screen.queryByRole('button', { name: 'Add seats' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Start 7-day trial' })).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Current plan' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Downgrade' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Switch to Free' })).not.toBeInTheDocument()
  })

  it('shows trial expiry, Continue with the plan, and uncapped seats', () => {
    renderView({
      overview: {
        ...paidOverview,
        plan: 'growth',
        planName: 'Growth',
        status: null,
        trialActive: true,
        trialPlanId: 'growth',
        trialPlanName: 'Growth',
        trialExpiresAt: '2026-09-01T00:00:00.000Z',
        canUpgrade: true,
        canManageBilling: false,
        seats: { used: 4, pending: 1, members: 3, purchased: null },
      },
    })
    expect(screen.getAllByText('Trial').length).toBeGreaterThan(0)
    expect(screen.getByText(/Trial ends/)).toBeInTheDocument()
    expect(screen.getByText(/Uncapped during your trial/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Continue with Growth' }).length).toBeGreaterThan(
      0
    )
    expect(screen.queryByRole('button', { name: 'Add seats' })).not.toBeInTheDocument()
  })

  it('sends an ended trial to the choose-a-plan page with payment', () => {
    renderView({
      overview: {
        ...paidOverview,
        plan: 'free',
        planName: 'Free',
        status: null,
        trialActive: false,
        trialEnded: true,
        trialPlanId: 'pro',
        trialPlanName: 'Pro',
        trialExpiresAt: '2026-08-18T00:00:00.000Z',
        canUpgrade: true,
        canManageBilling: false,
        seats: { used: 3, pending: 0, members: 3, purchased: null },
      },
    })
    expect(screen.getByText('Order summary')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeInTheDocument()
    expect(screen.getByText('Current')).toBeInTheDocument()
    expect(screen.getByText(/Downgrade to Free plan/)).toBeInTheDocument()
  })

  it('does not call a Free trial when the last plan name is missing', () => {
    renderView({
      overview: {
        ...paidOverview,
        plan: 'free',
        planName: 'Free',
        status: null,
        trialActive: false,
        trialEnded: true,
        trialPlanId: null,
        trialPlanName: null,
        trialExpiresAt: '2026-08-18T00:00:00.000Z',
        canUpgrade: true,
        canManageBilling: false,
        seats: { used: 3, pending: 0, members: 3, purchased: null },
      },
    })
    expect(screen.getByText('Order summary')).toBeInTheDocument()
    expect(screen.queryByText(/Your Free trial ended/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeInTheDocument()
  })

  it('does not offer Continue when the catalogue did not load', () => {
    renderView({
      catalogue: null,
      overview: {
        ...paidOverview,
        plan: 'growth',
        planName: 'Growth',
        status: null,
        trialActive: true,
        trialPlanId: 'growth',
        trialPlanName: 'Growth',
        trialExpiresAt: '2026-09-01T00:00:00.000Z',
        canUpgrade: true,
        canManageBilling: false,
        seats: { used: 4, pending: 1, members: 3, purchased: null },
      },
    })
    expect(screen.queryByRole('button', { name: /Continue with/ })).not.toBeInTheDocument()
  })

  it('does not offer Continue with a historical trial on a paid plan', () => {
    renderView({
      overview: {
        ...paidOverview,
        canUpgrade: true,
        trialPlanId: null,
        trialPlanName: null,
      },
    })
    expect(screen.queryByRole('button', { name: /Continue with/ })).not.toBeInTheDocument()
  })

  it('shows annual monthly equivalent from the catalogue', () => {
    renderView()
    expect(screen.getByText(/Moving up applies now/)).toBeInTheDocument()
    expect(screen.getByText('$24')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Monthly' }))
    expect(screen.getByText('$30')).toBeInTheDocument()
  })

  it('opens the subscribe dialog on the selected billing period', () => {
    renderView({
      overview: {
        ...paidOverview,
        plan: 'free',
        planName: 'Free',
        status: null,
        trialActive: false,
        trialEnded: true,
        trialPlanId: 'pro',
        trialPlanName: 'Pro',
        trialExpiresAt: '2026-08-18T00:00:00.000Z',
        canUpgrade: true,
        canManageBilling: false,
        renewalAt: null,
        seats: { used: 3, pending: 0, members: 3, purchased: null },
      },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Monthly' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(document.querySelector('form input[name="billingPeriod"]')).toHaveValue('monthly')
  })

  it('hides Top up when pack prices are missing', () => {
    const { aiTopUpPackCents: _ai, emailTopUpPackCents: _email, ...rest } = catalogue
    renderView({
      catalogue: rest,
      usage: [{ key: 'emailsPerMonth', label: 'emails', used: 1840, limit: 10_000 }],
    })
    expect(screen.queryByRole('button', { name: 'Top up' })).not.toBeInTheDocument()
  })

  it('hides email Top up when emails are unlimited', () => {
    renderView({
      usage: [{ key: 'emailsPerMonth', label: 'emails', used: 1840, limit: null }],
    })
    expect(screen.queryByText('Emails')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Top up' })).toHaveLength(1)
  })

  it('shows API requests and finite plan limits for the current subscription', () => {
    renderView({
      usage: [
        { key: 'apiRequestsPerMonth', label: 'API requests', used: 1200, limit: 250_000 },
        { key: 'maxStatusComponents', label: 'status components', used: 4, limit: 25 },
        { key: 'maxCustomRoles', label: 'custom roles', used: 1, limit: 5 },
        { key: 'maxSendingDomains', label: 'sending domains', used: 0, limit: 3 },
        { key: 'maxTeamSeats', label: 'seats', used: 7, limit: 10 },
        { key: 'aiTokensPerMonth', label: 'AI tokens this month', used: 100, limit: 6_000_000 },
        { key: 'maxBoards', label: 'boards', used: 2, limit: null },
      ],
    })
    expect(screen.getByText('AI usage')).toBeInTheDocument()
    expect(screen.getByText('API requests')).toBeInTheDocument()
    expect(screen.getByText('REST API calls this month.')).toBeInTheDocument()
    expect(screen.getByText('1,200 of 250,000')).toBeInTheDocument()
    expect(screen.getByText('Status components')).toBeInTheDocument()
    expect(screen.getByText('4 of 25')).toBeInTheDocument()
    expect(screen.getByText('Custom roles')).toBeInTheDocument()
    expect(screen.getByText('1 of 5')).toBeInTheDocument()
    expect(screen.getByText('Sending domains')).toBeInTheDocument()
    expect(screen.getByText('0 of 3')).toBeInTheDocument()
    const usage = screen.getByRole('heading', { name: 'Usage' }).closest('section')
    expect(usage).toBeTruthy()
    expect(within(usage as HTMLElement).queryByText('Seats')).not.toBeInTheDocument()
    expect(screen.queryByText('AI tokens this month')).not.toBeInTheDocument()
    expect(screen.queryByText('Boards')).not.toBeInTheDocument()
  })
})
