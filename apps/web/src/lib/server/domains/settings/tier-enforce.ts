import { TierLimitError } from '../../errors/tier-limit-error'
import { aiTokensThisMonth } from '../ai/usage-counter'
import { getTierLimits } from './tier-limits.service'
import type { TierFeatureFlags } from './tier-limits.types'
import { db, emailSendingDomains, isNull, sql, statusComponents } from '@/lib/server/db'

interface EnforceCountLimitArgs {
  /** Null = unlimited. */
  limit: number | null
  /** Lazy — only called when limit is set, so unlimited workspaces pay nothing. */
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
 * Refuses to create another status component once the active (non-deleted)
 * count would meet the plan's `maxStatusComponents` limit. Unlimited by
 * default (no tier-limits row, or an explicit null) — matches every other
 * count limit's OSS default. Call this from every status-component create
 * path: the public REST API's `POST /api/v1/status/components` handler, and
 * the admin server-fn create action.
 */
export async function enforceStatusComponentLimit(): Promise<void> {
  const limits = await getTierLimits()
  await enforceCountLimit({
    limit: limits.maxStatusComponents,
    name: 'maxStatusComponents',
    friendly: 'status components',
    currentCount: async () => {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(statusComponents)
        .where(isNull(statusComponents.deletedAt))
      return row?.count ?? 0
    },
  })
}

/**
 * Refuses to add another sending domain once the plan's `maxSendingDomains`
 * limit is reached.
 *
 * The only count limit here that guards something outside this workspace.
 * Adding a sending domain creates an identity on the mail provider account
 * every workspace shares, and that account has an identity quota — so the
 * failure mode of no ceiling is not one workspace overspending its plan, it is
 * one workspace exhausting a resource the rest depend on.
 *
 * ## The count runs on the caller's executor, on purpose
 *
 * Every other limit here reads and throws, and the window between the read and
 * the create is harmless because the resource being overspent belongs to the
 * workspace overspending it. This one is different, so the caller passes the
 * transaction it is about to insert in and holds a lock across both — see
 * `createSendingDomain`, which is the only caller and the only insert path. The
 * limit is passed in for the same reason: reading it inside the transaction
 * would put a settings query inside a lock that nothing else needs to wait on.
 *
 * ## Why the default is still unlimited
 *
 * A self-hoster runs the whole provider account and every identity on it is
 * theirs; a ceiling there would be a number invented to constrain someone with
 * nobody to take the resource from. On a fleet the ceiling is not optional and
 * it is not a default: the control plane writes a `maxSendingDomains` into every
 * tenant's tier limits, and a tenant whose limits were never written can add
 * domains without one. That is the same posture as every other limit in this
 * file — the mechanism is shared and the values are the deployment's — and it
 * is why the fleet's provisioning path must write the value rather than rely on
 * anything here.
 */
export async function enforceSendingDomainLimit(
  limit: number | null,
  exec: Pick<typeof db, 'select'>
): Promise<void> {
  await enforceCountLimit({
    limit,
    name: 'maxSendingDomains',
    friendly: 'sending domains',
    currentCount: async () => {
      const [row] = await exec
        .select({ count: sql<number>`count(*)::int` })
        .from(emailSendingDomains)
      return row?.count ?? 0
    },
  })
}

/**
 * Pre-call gate for any LLM-driven AI service. Refuses when the workspace
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

/** Pre-compose gate for billable outbound mail. Null = unlimited. */
export async function enforceEmailBudget(): Promise<void> {
  const limits = await getTierLimits()
  if (limits.emailsPerMonth === null) return
  const { emailsSentThisMonth } = await import('@/lib/server/email/email-budget')
  const used = await emailsSentThisMonth()
  if (used < limits.emailsPerMonth) return
  throw new TierLimitError({
    limit: 'emailsPerMonth',
    current: used,
    max: limits.emailsPerMonth,
    message:
      limits.emailsPerMonth === 0
        ? 'Outbound email is not included on your plan. Upgrade to enable it.'
        : `You've reached your email budget for this month (${used.toLocaleString()} of ${limits.emailsPerMonth.toLocaleString()}). Upgrade to increase it.`,
  })
}
