import type { BillingProjectionOverview } from '@/lib/server/domains/billing/projection-overview'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import {
  canonicalPlanId,
  isPlanId,
  PLAN_CATALOGUE,
  type PlanIdAlias,
} from '@/lib/server/domains/settings/cloud/cloud.types'

export type PaidPlanId = 'growth' | 'business' | 'enterprise'
export type CataloguePlanId = 'free' | PaidPlanId | PlanIdAlias
export type DowngradePlanId = 'free' | PaidPlanId

export type BillingPlanAction =
  | { kind: 'current' }
  | { kind: 'trial'; planId: PaidPlanId }
  | { kind: 'subscribe'; planId: PaidPlanId }
  | { kind: 'switch'; planId: PaidPlanId }
  | { kind: 'downgrade'; planId: DowngradePlanId }
  | { kind: 'unavailable' }

function isPaidPlanId(id: string): id is PaidPlanId {
  const canonical = canonicalPlanId(id)
  return canonical === 'growth' || canonical === 'business' || canonical === 'enterprise'
}

function hasLivePaidSub(overview: BillingProjectionOverview): boolean {
  return Boolean(overview.status && overview.status !== 'canceled')
}

export function planRank(id: string): number {
  const canonical = canonicalPlanId(id)
  if (!isPlanId(canonical)) return Number.NaN
  return PLAN_CATALOGUE[canonical].rank
}

export function isPlanDowngrade(fromPlanId: string, toPlanId: string): boolean {
  const from = planRank(fromPlanId)
  const to = planRank(toPlanId)
  return Number.isFinite(from) && Number.isFinite(to) && to < from
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
    if (id === 'free') return { kind: 'downgrade', planId: 'free' }
    if (isPaidPlanId(id)) return { kind: 'subscribe', planId: id }
    return { kind: 'unavailable' }
  }
  if (overview.plan === id) return { kind: 'current' }
  if (!canAct) return { kind: 'unavailable' }

  if (id === 'free') {
    if (overview.trialActive || hasLivePaidSub(overview)) {
      return { kind: 'downgrade', planId: 'free' }
    }
    return { kind: 'unavailable' }
  }

  if (!isPaidPlanId(id)) return { kind: 'unavailable' }

  if (hasLivePaidSub(overview)) {
    if (isPlanDowngrade(overview.plan, id)) return { kind: 'downgrade', planId: id }
    return { kind: 'switch', planId: id }
  }

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
