import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import type { BillingProjectionOverview } from '@/lib/server/domains/billing/projection-overview'

export function checkoutSuccessCopy(
  overview: BillingProjectionOverview | null | undefined,
  _catalogue?: BillingCatalogue | null
): { title: string; body: string } {
  if (!overview || overview.plan === 'free' || overview.trialActive) {
    return {
      title: "You're subscribed",
      body: 'Your plan and invoices are on this page. You can change them any time.',
    }
  }
  return {
    title: "You're subscribed",
    body: `You're on ${overview.planName}. You can change this any time.`,
  }
}
