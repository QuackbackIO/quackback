import { getFirstEnabledAdminProductPath, type FeatureFlags } from '@/lib/shared/types/settings'

/**
 * Admin landing destination. While an admin still has Getting Started
 * work, that page is home. Once the launch plan is done, the first
 * enabled product is home — Feedback, then Support, then Help Center,
 * Changelog, Status, or Analytics if every product is off.
 */
export function resolveAdminHomePath(input: {
  isAdmin: boolean
  launchResolved: boolean
  flags?: Partial<FeatureFlags> | null
}): string {
  if (input.isAdmin && !input.launchResolved) return '/admin/getting-started'
  return getFirstEnabledAdminProductPath(input.flags)
}
