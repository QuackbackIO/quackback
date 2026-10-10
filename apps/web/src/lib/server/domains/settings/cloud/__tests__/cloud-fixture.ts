/**
 * The stored `settings.cloud` blob, shaped the way the control plane actually
 * writes it.
 *
 * Why this exists as a helper rather than a literal per test: commercial state
 * is only believed when it arrives as a full control-plane **projection**.
 * `resolveCloudConfig` refuses anything else — `parseBillingProjection`
 * requires exactly the projection keys and nothing more — and a refused
 * projection resolves to DISABLED, where `isEntitled()` grants every key.
 *
 * So the failure mode of a hand-written fixture is the dangerous direction: a
 * blob like `{ enabled: true, plan: 'free' }` does not gate anything, it opens
 * everything, and a gate test written against it passes whether or not the
 * gate is wired at all. Building the projection in one place keeps that
 * silent-pass out of every suite that asserts a refusal.
 */
import { ENTITLEMENT_KEYS, PLAN_CATALOGUE, type PlanId } from '../cloud.types'

/** Numeric limits. Not what these suites assert; present because the parse demands them. */
const LIMITS = {
  maxBoards: 25,
  maxPosts: 1_000,
  maxTeamSeats: 10,
  maxStatusComponents: 25,
  maxCustomRoles: 5,
  maxSendingDomains: 3,
  aiTokensPerMonth: 100_000,
  apiRequestsPerMonth: 100_000,
  apiRequestsPerMinute: 600,
}

export type EntitlementOverrides = Partial<Record<(typeof ENTITLEMENT_KEYS)[number], boolean>>

/**
 * A cloud-enabled workspace on `plan`.
 *
 * Entitlements default to exactly what the plan catalogue grants, so `'free'`
 * refuses and `'pro'` allows without the caller restating the matrix. Pass
 * `entitlements` to express the override case, where the control plane's
 * projection disagrees with the catalogue and must win.
 */
export function storedCloud(plan: PlanId, entitlements?: EntitlementOverrides) {
  const grants = new Set<string>(PLAN_CATALOGUE[plan].grants)
  return {
    enabled: true,
    projection: {
      version: 1,
      effectivePlan: plan,
      trialStartedAt: null,
      trialExpiresAt: null,
      subscriptionStatus: null,
      entitlements:
        entitlements ?? Object.fromEntries(ENTITLEMENT_KEYS.map((key) => [key, grants.has(key)])),
      freeLimits: LIMITS,
      planLimits: LIMITS,
      planLimitsExpireAt: null,
      canUpgrade: true,
      canManageBilling: false,
      renewalAt: null,
      cancellationAt: null,
    },
  }
}
