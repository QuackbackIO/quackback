import { TierLimitError } from '../../errors/tier-limit-error'
import { aiOpsThisMonth } from '../ai/usage-counter'
import { getTierLimits } from './tier-limits.service'
import type { TierFeatureFlags } from './tier-limits.types'

interface EnforceCountLimitArgs {
  /** Null = unlimited. */
  limit: number | null
  /** Lazy — only called when limit is set, so unlimited tenants pay nothing. */
  currentCount: () => Promise<number>
  /** Matches the TierLimits key (e.g. 'maxBoards'). */
  name: string
  /** User-facing word in the message (e.g. 'boards'). */
  friendly: string
}

export async function enforceCountLimit(args: EnforceCountLimitArgs): Promise<void> {
  if (args.limit === null) return
  const current = await args.currentCount()
  if (current < args.limit) return

  throw new TierLimitError({
    limit: args.name,
    current,
    max: args.limit,
    message: `You've reached your plan's ${args.friendly} limit (${args.limit}). Upgrade to add more.`,
  })
}

interface EnforceFeatureGateArgs {
  enabled: boolean
  feature: keyof TierFeatureFlags
  friendly: string
}

export function enforceFeatureGate(args: EnforceFeatureGateArgs): void {
  if (args.enabled) return
  throw new TierLimitError({
    limit: `features.${args.feature}`,
    message: `${args.friendly} is not available on your plan. Upgrade to enable it.`,
  })
}

/**
 * Combined gate for AI services: refuses if the feature flag is off OR the
 * monthly aiOpsPerMonth quota has been reached. Each AI service caller becomes
 * a one-liner instead of repeating the same 5-line preamble.
 */
export async function enforceAiOp(
  feature: keyof TierFeatureFlags,
  friendly: string
): Promise<void> {
  const limits = await getTierLimits()
  enforceFeatureGate({ enabled: limits.features[feature], feature, friendly })
  if (limits.aiOpsPerMonth === null) return
  const current = await aiOpsThisMonth()
  if (current < limits.aiOpsPerMonth) return
  throw new TierLimitError({
    limit: 'aiOpsPerMonth',
    current,
    max: limits.aiOpsPerMonth,
    message: `You've reached your plan's AI operation quota for this month (${limits.aiOpsPerMonth}). Upgrade to increase it.`,
  })
}
