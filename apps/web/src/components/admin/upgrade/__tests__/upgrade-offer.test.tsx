// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import type { UpgradeContext } from '@/lib/server/domains/settings/cloud/upgrade-context'
import { describeEntitlementUpgrade } from '@/lib/shared/describe-upgrade'

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
      bestFor: 'Trying it out',
      highlights: ['1 seat'],
      recommended: false,
    },
    {
      id: 'growth',
      name: 'Growth',
      rank: 1,
      priceMonthlyCents: 2900,
      priceYearlyCents: 29000,
      billedPer: 'seat',
      bestFor: 'Small teams',
      highlights: ['Custom domain', 'API, MCP & webhooks'],
      recommended: false,
    },
    {
      id: 'pro',
      name: 'Pro',
      rank: 2,
      priceMonthlyCents: 5900,
      priceYearlyCents: 59000,
      billedPer: 'seat',
      bestFor: 'Inbox teams',
      highlights: ['Workflows & SLAs', 'Moderation & private boards'],
      recommended: true,
    },
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

const routerState = { billingEnabled: true }
const permission = { canCheckout: true }

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => routerState,
  useLocation: (opts: { select: (loc: { pathname: string; searchStr: string }) => string }) =>
    opts.select({ pathname: '/admin/automation/workflows', searchStr: '' }),
}))
vi.mock('@/lib/client/hooks/use-permission', () => ({
  usePermission: () => permission.canCheckout,
}))

const { UpgradeOffer } = await import('../upgrade-offer')

function renderOffer(
  context: UpgradeContext | null,
  options: {
    entitlement?: 'auditLog' | 'workflows' | 'webhooks'
    catalogue?: BillingCatalogue
  } = {}
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['billing', 'catalogue'], options.catalogue ?? catalogue)
  client.setQueryData(['billing', 'upgrade-context'], context)
  return render(
    <QueryClientProvider client={client}>
      <UpgradeOffer description={describeEntitlementUpgrade(options.entitlement ?? 'auditLog')} />
    </QueryClientProvider>
  )
}

const onPro: UpgradeContext = {
  currentPlan: 'pro',
  currentPlanName: 'Pro',
  trialActive: false,
  trialEligible: false,
}
const onFree: UpgradeContext = {
  currentPlan: 'free',
  currentPlanName: 'Free',
  trialActive: false,
  trialEligible: true,
}

describe('UpgradeOffer', () => {
  afterEach(() => {
    cleanup()
    routerState.billingEnabled = true
    permission.canCheckout = true
  })

  it('names the feature, both plans, the unlock list and the price on the first paint', () => {
    renderOffer(onPro)
    expect(
      screen.getByRole('heading', { name: 'The audit log is available from the Scale plan' })
    ).toBeTruthy()
    expect(screen.getByText('Upgrade from Pro to Scale to unlock:')).toBeTruthy()
    expect(screen.getByText('Audit log')).toBeTruthy()
    expect(screen.getByText('SSO')).toBeTruthy()
    expect(screen.queryByText(/Plus everything in/)).toBeNull()
    expect(screen.getByText('$89')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Upgrade to Scale' })).toHaveAttribute(
      'href',
      '/admin/settings/billing/checkout?plan=scale&period=annual'
    )
    expect(screen.getByRole('link', { name: /Compare all plans/ })).toHaveAttribute(
      'href',
      '/admin/settings/billing'
    )
    expect(document.querySelector('form')).toBeNull()
  })

  it('carries the chosen billing cycle into the configurator', () => {
    renderOffer(onPro)
    fireEvent.click(screen.getByRole('radio', { name: /Monthly/ }))
    expect(screen.getByRole('link', { name: 'Upgrade to Scale' })).toHaveAttribute(
      'href',
      '/admin/settings/billing/checkout?plan=scale&period=monthly'
    )
  })

  it('folds in the plans between the current one and the target', () => {
    renderOffer({ ...onFree, trialEligible: false })
    expect(screen.getByText('Upgrade from Free to Scale to unlock:')).toBeTruthy()
    expect(screen.getByText('Plus everything in Growth:')).toBeTruthy()
    expect(screen.getByText(/Custom domain · API, MCP & webhooks/)).toBeTruthy()
    expect(screen.getByText('Plus everything in Pro:')).toBeTruthy()
  })

  it('offers a first-time trial that returns to the page that raised the prompt', () => {
    renderOffer(onFree, { entitlement: 'workflows' })
    expect(screen.getByRole('button', { name: 'Try Pro free for 14 days' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Upgrade to Pro' })).toBeNull()
    expect(screen.getByText(/Free for 14 days, then the price above/)).toBeTruthy()
    const form = document.querySelector('form')
    expect(form?.getAttribute('action')).toBe('/api/billing/trial')
    expect((document.querySelector('input[name="planId"]') as HTMLInputElement)?.value).toBe('pro')
    expect((document.querySelector('input[name="returnTo"]') as HTMLInputElement)?.value).toBe(
      '/admin/automation/workflows'
    )
  })

  it('falls back to checkout once that plan has been tried', () => {
    renderOffer(onFree, {
      entitlement: 'workflows',
      catalogue: { ...catalogue, trialedPlanIds: ['pro'] },
    })
    expect(screen.getByRole('link', { name: 'Upgrade to Pro' })).toBeTruthy()
    expect(screen.queryByText(/Free for 14 days/)).toBeNull()
  })

  it('acknowledges a running trial', () => {
    renderOffer(
      { currentPlan: 'growth', currentPlanName: 'Growth', trialActive: true, trialEligible: false },
      { entitlement: 'workflows' }
    )
    expect(screen.getByText("You're trialing Growth. Upgrade to Pro to unlock:")).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Upgrade to Pro' })).toBeTruthy()
  })

  it('uses plan-only copy when the current plan is unknown', () => {
    renderOffer(null)
    expect(screen.getByText('Upgrade to Scale to unlock:')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Upgrade to Scale' })).toBeTruthy()
  })

  it('tells teammates without billing access who can act instead of linking to a page they cannot open', () => {
    permission.canCheckout = false
    renderOffer(onPro)
    expect(screen.getByText('Only workspace owners can change the plan.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Upgrade to/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Compare all plans/ })).toBeNull()
    expect(screen.getByText('Audit log')).toBeTruthy()
  })

  it('still routes an owner to Plan & billing when the catalogue is unavailable', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['billing', 'catalogue'], null)
    client.setQueryData(['billing', 'upgrade-context'], onPro)
    render(
      <QueryClientProvider client={client}>
        <UpgradeOffer description={describeEntitlementUpgrade('auditLog')} />
      </QueryClientProvider>
    )
    expect(screen.getByText(/The audit log is a Scale feature/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View & compare plans' })).toHaveAttribute(
      'href',
      '/admin/settings/billing'
    )
    expect(screen.queryByText('Only workspace owners can change the plan.')).toBeNull()
  })

  it('renders copy only when billing is off', () => {
    routerState.billingEnabled = false
    renderOffer(onPro)
    expect(
      screen.getByRole('heading', { name: 'The audit log is available from the Scale plan' })
    ).toBeTruthy()
    expect(screen.getByText(/The audit log is a Scale feature/)).toBeTruthy()
    expect(document.querySelector('form')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
