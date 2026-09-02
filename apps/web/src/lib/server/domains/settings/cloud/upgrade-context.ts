import { hasLivePaidSub } from '@/lib/shared/billing/trial-state'
import { PLAN_CATALOGUE, type CloudConfig, type PlanId } from './cloud.types'

/**
 * The commercial facts an upgrade prompt may name. Deliberately narrower than
 * {@link CloudConfig}: no customer or subscription reference, no dates, no
 * entitlement map. The plan name is already shown to every teammate by the
 * trial banner, so naming it here leaks nothing new.
 */
export interface UpgradeContext {
  currentPlan: PlanId
  currentPlanName: string
  trialActive: boolean
  /**
   * Whether this workspace may start a first-time product trial from a prompt.
   * Plan-agnostic on purpose: which paid plans were already tried lives in the
   * billing catalogue, and the client intersects the two.
   */
  trialEligible: boolean
}

/**
 * Null when cloud is off or no plan is in force — the prompt then falls back to
 * plan-only copy ("Upgrade to Pro to unlock") rather than guessing "Free".
 *
 * Trial eligibility mirrors `billingPlanAction`: only a Free workspace with no
 * live subscription, not already trialing, and authorised to upgrade, is
 * offered a trial. Everything else converts through checkout.
 */
export function upgradeContextFor(cloud: CloudConfig): UpgradeContext | null {
  if (!cloud.enabled || !cloud.plan) return null
  const trialEligible =
    cloud.canUpgrade &&
    !cloud.trialActive &&
    cloud.plan === 'free' &&
    !hasLivePaidSub(cloud.subscriptionStatus)
  return {
    currentPlan: cloud.plan,
    currentPlanName: PLAN_CATALOGUE[cloud.plan].name,
    trialActive: cloud.trialActive,
    trialEligible,
  }
}
