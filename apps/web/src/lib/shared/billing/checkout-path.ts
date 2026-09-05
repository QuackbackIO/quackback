import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import { canonicalPlanId } from '@/lib/server/domains/settings/cloud/cloud.types'
import { formatUsd } from '@/lib/shared/format-usd'
import type { PaidPlanId } from './plan-action'

export const CHECKOUT_PATH = '/admin/settings/billing/checkout'

export type BillingPeriod = 'monthly' | 'annual'

export type CheckoutSearch = {
  plan?: PaidPlanId
  period?: BillingPeriod
  /** Branding removal added to the order. */
  branding?: boolean
}

export const PAID_PLAN_IDS = ['pro', 'business', 'enterprise'] as const

export function isPaidPlanId(value: unknown): value is PaidPlanId {
  return typeof value === 'string' && (PAID_PLAN_IDS as readonly string[]).includes(value)
}

/** Accepts `business`/`enterprise` and returns the canonical paid id, or null. */
export function parsePaidPlanId(value: unknown): PaidPlanId | null {
  if (typeof value !== 'string') return null
  const canonical = canonicalPlanId(value)
  return isPaidPlanId(canonical) ? canonical : null
}

/** Tolerant: an unknown or malformed value is dropped rather than failing the route. */
export function parseCheckoutSearch(raw: Record<string, unknown>): CheckoutSearch {
  const search: CheckoutSearch = {}
  const plan = parsePaidPlanId(raw.plan)
  if (plan) search.plan = plan
  if (raw.period === 'monthly' || raw.period === 'annual') search.period = raw.period
  if (raw.branding === true || raw.branding === 'true') search.branding = true
  return search
}

/** Deep link into the configurator with a plan (and optionally period / add-on) preselected. */
export function checkoutPath(search: CheckoutSearch = {}): string {
  const params = new URLSearchParams()
  if (search.plan) params.set('plan', parsePaidPlanId(search.plan) ?? search.plan)
  if (search.period) params.set('period', search.period)
  if (search.branding) params.set('branding', 'true')
  const query = params.toString()
  return query ? `${CHECKOUT_PATH}?${query}` : CHECKOUT_PATH
}

export type CheckoutSummary = {
  /** Sticker for the workspace over one interval. */
  unitCents: number
  /** Recurring charge per interval (always one workspace). */
  totalCents: number
  /** Same total expressed per month, for comparing annual and monthly side by side. */
  monthlyEquivalentCents: number
  interval: 'year' | 'month'
}

export function checkoutSummary(
  plan: Pick<BillingCatalogue['plans'][number], 'priceMonthlyCents' | 'priceYearlyCents'>,
  period: BillingPeriod
): CheckoutSummary {
  const unitCents = period === 'annual' ? plan.priceYearlyCents : plan.priceMonthlyCents
  return {
    unitCents,
    totalCents: unitCents,
    monthlyEquivalentCents: period === 'annual' ? Math.round(unitCents / 12) : unitCents,
    interval: period === 'annual' ? 'year' : 'month',
  }
}

type PricedPlan = Pick<
  BillingCatalogue['plans'][number],
  'priceMonthlyCents' | 'priceYearlyCents'
> & { annualSavingsCents?: number }

/** Whole-percent saving of paying yearly over twelve monthly payments; null when there is none. */
export function annualSavingsPercent(plan: PricedPlan): number | null {
  const yearOfMonthly = plan.priceMonthlyCents * 12
  if (yearOfMonthly <= 0 || plan.priceYearlyCents >= yearOfMonthly) return null
  return Math.round((1 - plan.priceYearlyCents / yearOfMonthly) * 100)
}

/** Yearly sticker versus twelve monthly payments. Prefers a catalogue-supplied amount. */
export function annualSavingsCents(plan: PricedPlan): number {
  if (typeof plan.annualSavingsCents === 'number' && Number.isFinite(plan.annualSavingsCents)) {
    return plan.annualSavingsCents
  }
  return plan.priceMonthlyCents * 12 - plan.priceYearlyCents
}

/** Annual-toggle badge. Null when yearly is not cheaper. */
export function annualSavingsLabel(plan: PricedPlan | null | undefined): string | null {
  if (!plan) return null
  const cents = annualSavingsCents(plan)
  if (cents <= 0) return null
  return `Save ${formatUsd(cents, 0)}/yr`
}
