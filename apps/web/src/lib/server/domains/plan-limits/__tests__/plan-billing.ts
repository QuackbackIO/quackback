/**
 * A stored `cloud` blob that turns plan billing on, so the plan limits rules
 * run, while the stored tier limits still decide every cap and feature.
 *
 * Every projected cap is 0 and the effective cap is the larger of the stored
 * and projected one, so a stored cap stands and a stored null stays
 * unlimited. Every entitlement is granted, so the tier feature flags alone
 * decide which features the plan has. Pair it with stored tier limits: with
 * none, the projection's zero floor applies to everything.
 */
import { ENTITLEMENT_KEYS, type PlanId } from '@/lib/server/domains/settings/cloud/cloud.types'
import { PROJECTED_LIMIT_KEYS } from '@/lib/server/domains/settings/cloud/billing-projection'

const ZERO = Object.fromEntries(PROJECTED_LIMIT_KEYS.map((key) => [key, 0]))

export function planBillingOn(plan: PlanId = 'free') {
  return {
    enabled: true,
    projection: {
      version: 1,
      effectivePlan: plan,
      trialStartedAt: null,
      trialExpiresAt: null,
      subscriptionStatus: null,
      entitlements: Object.fromEntries(ENTITLEMENT_KEYS.map((key) => [key, true])),
      freeLimits: ZERO,
      planLimits: ZERO,
      planLimitsExpireAt: null,
      canUpgrade: true,
      canManageBilling: true,
      renewalAt: null,
      cancellationAt: null,
    },
  }
}
