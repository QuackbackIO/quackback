import type { BillingProjectionOverview } from '@/lib/server/domains/billing/projection-overview'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import { canonicalPlanId, type PlanIdAlias } from '@/lib/server/domains/settings/cloud/cloud.types'

export type PaidPlanId = 'growth' | 'pro' | 'scale'
export type CataloguePlanId = 'free' | PaidPlanId | PlanIdAlias

export type BillingPlanAction =
  | { kind: 'current' }
  | { kind: 'trial'; planId: PaidPlanId }
  | { kind: 'subscribe'; planId: PaidPlanId }
  | { kind: 'switch'; planId: PaidPlanId }
  | { kind: 'downgrade' }
  | { kind: 'unavailable' }

function isPaidPlanId(id: string): id is PaidPlanId {
  const canonical = canonicalPlanId(id)
  return canonical === 'growth' || canonical === 'pro' || canonical === 'scale'
}

function hasLivePaidSub(overview: BillingProjectionOverview): boolean {
  return Boolean(overview.status && overview.status !== 'canceled')
}

export function billingPlanAction(
  planId: CataloguePlanId,
  overview: BillingProjectionOverview,
  trialedPlanIds: readonly string[] = []
): BillingPlanAction {
  const id = canonicalPlanId(planId)
  const canAct = overview.canUpgrade || overview.canManageBilling
  if (overview.trialEnded && overview.trialPlanId) {
    if (!canAct) return { kind: 'unavailable' }
    if (id === 'free') return { kind: 'downgrade' }
    if (isPaidPlanId(id)) return { kind: 'subscribe', planId: id }
    return { kind: 'unavailable' }
  }
  if (overview.plan === id) return { kind: 'current' }
  if (!canAct) return { kind: 'unavailable' }

  if (id === 'free') {
    if (overview.trialActive || hasLivePaidSub(overview)) return { kind: 'downgrade' }
    return { kind: 'unavailable' }
  }

  if (!isPaidPlanId(id)) return { kind: 'unavailable' }

  if (hasLivePaidSub(overview)) return { kind: 'switch', planId: id }

  // Complimentary grant: convert via checkout, never a second product trial.
  if (overview.plan !== 'free' && !overview.trialActive) {
    return { kind: 'subscribe', planId: id }
  }

  const alreadyTrialed = trialedPlanIds.map(canonicalPlanId).includes(id)
  if (!alreadyTrialed && !overview.trialActive && overview.canUpgrade) {
    return { kind: 'trial', planId: id }
  }
  return { kind: 'subscribe', planId: id }
}

export function catalogueTrialDays(catalogue: BillingCatalogue | null): number {
  return catalogue?.trialDays && catalogue.trialDays > 0 ? catalogue.trialDays : 7
}

export function catalogueTrialedPlanIds(catalogue: BillingCatalogue | null): PaidPlanId[] {
  const seen = new Set<PaidPlanId>()
  for (const id of catalogue?.trialedPlanIds ?? []) {
    const canonical = canonicalPlanId(id)
    if (isPaidPlanId(canonical)) seen.add(canonical)
  }
  return [...seen]
}
