/**
 * Outcome → product flag map for onboarding. Choosing a goal narrows which
 * suite products start enabled so nav chrome matches the job to be done;
 * operators can re-enable anything later under Settings → General.
 */
import type { OnboardingOutcome } from '@/lib/shared/db-types'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'
import { getProductFlagUpdate } from '@/lib/server/domains/settings/settings.types'

const ALL_PRODUCTS = ['feedback', 'support', 'helpCenter', 'changelog', 'status'] as const

/** Products that stay on for a given onboarding outcome. */
export const OUTCOME_ENABLED_PRODUCTS: Record<
  OnboardingOutcome,
  ReadonlyArray<(typeof ALL_PRODUCTS)[number]>
> = {
  product_feedback: ['feedback', 'changelog'],
  customer_support: ['support', 'helpCenter', 'status'],
  help_center: ['helpCenter', 'changelog'],
  internal: ['feedback'],
}

/**
 * Build the feature-flag patch that enables the outcome's products and
 * disables the rest. AI flags are left untouched (defaults / Labs apply).
 */
export function featureFlagsForOnboardingOutcome(
  outcome: OnboardingOutcome
): Partial<FeatureFlags> {
  const enabled = new Set(OUTCOME_ENABLED_PRODUCTS[outcome])
  const patch: Partial<FeatureFlags> = {}
  for (const productId of ALL_PRODUCTS) {
    Object.assign(patch, getProductFlagUpdate(productId, enabled.has(productId)))
  }
  return patch
}
