import type { BillingProjectionOverview } from '@/lib/server/domains/billing/projection-overview'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'

export type PaidPlanId = 'growth' | 'pro' | 'scale'
export type CataloguePlanId = 'free' | PaidPlanId

export type BillingPlanAction =
  | { kind: 'current' }
  | { kind: 'trial'; planId: PaidPlanId }
  | { kind: 'subscribe'; planId: PaidPlanId }
  | { kind: 'switch'; planId: PaidPlanId }
  | { kind: 'downgrade' }
  | { kind: 'unavailable' }

function isPaidPlanId(id: string): id is PaidPlanId {
  return id === 'growth' || id === 'pro' || id === 'scale'
}

function hasLivePaidSub(overview: BillingProjectionOverview): boolean {
  return Boolean(overview.status && overview.status !== 'canceled')
}

export function billingPlanAction(
  planId: CataloguePlanId,
  overview: BillingProjectionOverview,
  trialedPlanIds: readonly string[] = []
): BillingPlanAction {
  const canAct = overview.canUpgrade || overview.canManageBilling
  if (overview.trialEnded && overview.trialPlanId) {
    if (!canAct) return { kind: 'unavailable' }
    if (planId === 'free') return { kind: 'downgrade' }
    if (isPaidPlanId(planId)) return { kind: 'subscribe', planId }
    return { kind: 'unavailable' }
  }
  if (overview.plan === planId) return { kind: 'current' }
  if (!canAct) return { kind: 'unavailable' }

  if (planId === 'free') {
    if (overview.trialActive || hasLivePaidSub(overview)) return { kind: 'downgrade' }
    return { kind: 'unavailable' }
  }

  if (!isPaidPlanId(planId)) return { kind: 'unavailable' }

  if (hasLivePaidSub(overview)) return { kind: 'switch', planId }

  // Complimentary grant: convert via checkout, never a second product trial.
  if (overview.plan !== 'free' && !overview.trialActive) {
    return { kind: 'subscribe', planId }
  }

  const alreadyTrialed = trialedPlanIds.includes(planId)
  if (!alreadyTrialed && !overview.trialActive && overview.canUpgrade) {
    return { kind: 'trial', planId }
  }
  return { kind: 'subscribe', planId }
}

export function catalogueTrialDays(catalogue: BillingCatalogue | null): number {
  return catalogue?.trialDays && catalogue.trialDays > 0 ? catalogue.trialDays : 7
}

export function catalogueTrialedPlanIds(catalogue: BillingCatalogue | null): PaidPlanId[] {
  return (catalogue?.trialedPlanIds ?? []).filter(isPaidPlanId)
}
