import type { PlanId } from './cloud/cloud.types'
import type { TierFeatureFlags } from './tier-limits.types'

/**
 * Feature flags that are not entitlements. Must match CP `definitions.ts`
 * for the same plan. Copied from `effectivePlan` because the projection
 * entitlements map does not carry these keys.
 *
 * `visitorAnalytics` is the exception to the CP-match rule: the control plane
 * does not define it. Every plan includes it, so a cloud workspace keeps
 * counting unless an operator tier-limits row switches it off. Changing a
 * plan's grant here is the one place that controls it.
 */
export const PLAN_ONLY_FEATURES: Record<
  PlanId,
  Pick<
    TierFeatureFlags,
    'analyticsExports' | 'customColors' | 'customCss' | 'integrations' | 'visitorAnalytics'
  >
> = {
  free: {
    analyticsExports: false,
    customColors: true,
    customCss: false,
    integrations: false,
    visitorAnalytics: true,
  },
  pro: {
    analyticsExports: false,
    customColors: true,
    customCss: false,
    integrations: false,
    visitorAnalytics: true,
  },
  business: {
    analyticsExports: true,
    customColors: true,
    customCss: true,
    integrations: true,
    visitorAnalytics: true,
  },
  enterprise: {
    analyticsExports: true,
    customColors: true,
    customCss: true,
    integrations: true,
    visitorAnalytics: true,
  },
}
