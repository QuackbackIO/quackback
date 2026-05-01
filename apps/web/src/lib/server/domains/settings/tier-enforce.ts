import { TierLimitError } from '../../errors/tier-limit-error'
import type { TierFeatureFlags } from './tier-limits.types'

interface EnforceCountLimitArgs {
  /** Null = unlimited (OSS default). */
  limit: number | null
  /** Lazy — only called when limit is set, so OSS pays nothing. */
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

interface EnforceAiQuotaArgs {
  /** Null = unlimited (OSS default). 0 = feature blocked entirely. */
  limit: number | null
  currentCount: () => Promise<number>
}

export async function enforceAiQuota(args: EnforceAiQuotaArgs): Promise<void> {
  if (args.limit === null) return
  const current = await args.currentCount()
  if (current < args.limit) return

  throw new TierLimitError({
    limit: 'aiOpsPerMonth',
    current,
    max: args.limit,
    message: `You've reached your plan's AI operation quota for this month (${args.limit}). Upgrade to increase it.`,
  })
}

export function enforceFeatureGate(args: EnforceFeatureGateArgs): void {
  if (args.enabled) return
  throw new TierLimitError({
    limit: `features.${args.feature}`,
    message: `${args.friendly} is not available on your plan. Upgrade to enable it.`,
  })
}
