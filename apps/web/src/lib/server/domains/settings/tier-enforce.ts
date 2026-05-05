import { TierLimitError } from '../../errors/tier-limit-error'
import { aiTokensThisMonth } from '../ai/usage-counter'
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
 * Combined helper: read tier limits and refuse if the feature is off.
 * Replaces the 4-line `getTierLimits + enforceFeatureGate` pattern at
 * each call site.
 */
export async function assertTierFeature(
  feature: keyof TierFeatureFlags,
  friendly: string
): Promise<void> {
  const limits = await getTierLimits()
  enforceFeatureGate({ enabled: limits.features[feature], feature, friendly })
}

/**
 * Pre-call gate for any LLM-driven AI service. Refuses when the tenant
 * has used up its monthly token budget. Token usage is recorded after
 * each call by withUsageLogging, so this is a "you're already at/over"
 * check — small overruns are possible if many calls fire concurrently.
 *
 * 0 budget blocks AI entirely. Null = unlimited (the OSS default).
 */
export async function enforceAiTokenBudget(): Promise<void> {
  const limits = await getTierLimits()
  if (limits.aiTokensPerMonth === null) return
  const used = await aiTokensThisMonth()
  if (used < limits.aiTokensPerMonth) return
  throw new TierLimitError({
    limit: 'aiTokensPerMonth',
    current: used,
    max: limits.aiTokensPerMonth,
    message:
      limits.aiTokensPerMonth === 0
        ? 'AI features are not included on your plan. Upgrade to enable them.'
        : `You've used your AI token budget for this month (${used.toLocaleString()} of ${limits.aiTokensPerMonth.toLocaleString()}). Upgrade to increase it.`,
  })
}
