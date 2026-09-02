import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import type { PaidPlanId } from './plan-action'

export const CHECKOUT_PATH = '/admin/settings/billing/checkout'

export type BillingPeriod = 'monthly' | 'annual'

export type CheckoutSearch = {
  plan?: PaidPlanId
  period?: BillingPeriod
  seats?: number
  /** Branding removal added to the order. */
  branding?: boolean
}

const PAID_PLAN_IDS: readonly PaidPlanId[] = ['growth', 'pro', 'scale']

export function isPaidPlanId(value: unknown): value is PaidPlanId {
  return typeof value === 'string' && (PAID_PLAN_IDS as readonly string[]).includes(value)
}

/** Tolerant: an unknown or malformed value is dropped rather than failing the route. */
export function parseCheckoutSearch(raw: Record<string, unknown>): CheckoutSearch {
  const search: CheckoutSearch = {}
  if (isPaidPlanId(raw.plan)) search.plan = raw.plan
  if (raw.period === 'monthly' || raw.period === 'annual') search.period = raw.period
  const seats = typeof raw.seats === 'string' ? Number(raw.seats) : raw.seats
  if (typeof seats === 'number' && Number.isInteger(seats) && seats >= 1 && seats <= 1000) {
    search.seats = seats
  }
  if (raw.branding === true || raw.branding === 'true') search.branding = true
  return search
}

/** Deep link into the configurator with a plan (and optionally period / seats / add-on) preselected. */
export function checkoutPath(search: CheckoutSearch = {}): string {
  const params = new URLSearchParams()
  if (search.plan) params.set('plan', search.plan)
  if (search.period) params.set('period', search.period)
  if (search.seats != null) params.set('seats', String(search.seats))
  if (search.branding) params.set('branding', 'true')
  const query = params.toString()
  return query ? `${CHECKOUT_PATH}?${query}` : CHECKOUT_PATH
}

export type CheckoutSummary = {
  /** Sticker for one billing unit over one interval (a seat-year on annual, a seat-month on monthly). */
  unitCents: number
  /** Seats billed; always 1 for workspace-priced plans. */
  quantity: number
  /** Recurring charge per interval. */
  totalCents: number
  /** Same total expressed per month, for comparing annual and monthly side by side. */
  monthlyEquivalentCents: number
  interval: 'year' | 'month'
  billedPer: 'seat' | 'workspace'
}

export function checkoutSummary(
  plan: Pick<
    BillingCatalogue['plans'][number],
    'priceMonthlyCents' | 'priceYearlyCents' | 'billedPer'
  >,
  period: BillingPeriod,
  seats: number
): CheckoutSummary {
  const quantity = plan.billedPer === 'seat' ? Math.max(1, seats) : 1
  const unitCents = period === 'annual' ? plan.priceYearlyCents : plan.priceMonthlyCents
  const totalCents = unitCents * quantity
  return {
    unitCents,
    quantity,
    totalCents,
    monthlyEquivalentCents: period === 'annual' ? Math.round(totalCents / 12) : totalCents,
    interval: period === 'annual' ? 'year' : 'month',
    billedPer: plan.billedPer,
  }
}

/** Whole-percent saving of paying yearly over twelve monthly payments; null when there is none. */
export function annualSavingsPercent(
  plan: Pick<BillingCatalogue['plans'][number], 'priceMonthlyCents' | 'priceYearlyCents'>
): number | null {
  const yearOfMonthly = plan.priceMonthlyCents * 12
  if (yearOfMonthly <= 0 || plan.priceYearlyCents >= yearOfMonthly) return null
  return Math.round((1 - plan.priceYearlyCents / yearOfMonthly) * 100)
}
