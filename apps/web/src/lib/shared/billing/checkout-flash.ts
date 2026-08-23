import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import type { BillingProjectionOverview } from '@/lib/server/domains/billing/projection-overview'

export function checkoutSuccessCopy(
  overview: BillingProjectionOverview | null | undefined,
  catalogue: BillingCatalogue | null | undefined
): { title: string; body: string } {
  if (!overview || overview.plan === 'free' || overview.trialActive) {
    return {
      title: "You're subscribed",
      body: 'Your plan, seats, and invoices are on this page. You can change them any time.',
    }
  }
  const plan = catalogue?.plans.find((entry) => entry.id === overview.plan)
  const seats = overview.seats?.purchased ?? overview.seats?.used ?? 0
  const bits = [`You're on ${overview.planName}`]
  if (plan?.billedPer === 'seat' && seats > 0) {
    bits.push(`${seats} ${seats === 1 ? 'seat' : 'seats'}`)
  }
  return {
    title: "You're subscribed",
    body: `${bits.join(' · ')}. You can change this any time.`,
  }
}
