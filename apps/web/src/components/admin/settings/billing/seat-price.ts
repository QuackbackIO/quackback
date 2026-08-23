export type SeatBillingPeriod = 'monthly' | 'annual'

/** Monthly sticker, unless the active interval is known to be annual. */
export function seatUnitCents(
  plan: { priceMonthlyCents: number; priceYearlyCents: number },
  period: SeatBillingPeriod | null | undefined
): number {
  if (period === 'annual') return Math.round(plan.priceYearlyCents / 12)
  return plan.priceMonthlyCents
}

/**
 * Recurring total for the known interval, or null when the workspace period
 * is unknown so callers omit yearly/monthly rollups rather than guessing.
 */
export function seatRecurringTotalCents(
  plan: { priceMonthlyCents: number; priceYearlyCents: number },
  quantity: number,
  period: SeatBillingPeriod | null | undefined
): { cents: number; suffix: '/mo' | '/yr' } | null {
  if (period === 'annual') return { cents: quantity * plan.priceYearlyCents, suffix: '/yr' }
  if (period === 'monthly') return { cents: quantity * plan.priceMonthlyCents, suffix: '/mo' }
  return null
}
