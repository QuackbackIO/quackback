import {
  canonicalPlanId,
  isPlanId,
  type PlanId,
} from '@/lib/server/domains/settings/cloud/cloud.types'
import type { PlanUsageLine } from './plan-usage'

/**
 * Numeric caps a workspace must fit before switching to that plan
 * (null = unlimited). Usage meters (AI, email, API) are not deletable
 * resources and are omitted.
 */
export const PLAN_NUMERIC_CAPS: Record<
  PlanId,
  {
    maxBoards: number | null
    maxPosts: number | null
    maxTeamSeats: number | null
    maxStatusComponents: number | null
    maxCustomRoles: number | null
    maxSendingDomains: number | null
    maxInboundEmailAddresses: number | null
    maxHelpCenterLocales: number | null
    maxStatusSubscribers: number | null
  }
> = {
  free: {
    maxBoards: 1,
    maxPosts: 50,
    maxTeamSeats: 1,
    maxStatusComponents: 3,
    maxCustomRoles: 0,
    maxSendingDomains: 0,
    maxInboundEmailAddresses: 1,
    maxHelpCenterLocales: 1,
    maxStatusSubscribers: 100,
  },
  pro: {
    maxBoards: null,
    maxPosts: null,
    maxTeamSeats: 5,
    maxStatusComponents: 10,
    maxCustomRoles: 0,
    maxSendingDomains: 1,
    maxInboundEmailAddresses: 1,
    maxHelpCenterLocales: 1,
    maxStatusSubscribers: 250,
  },
  business: {
    maxBoards: null,
    maxPosts: null,
    maxTeamSeats: 20,
    maxStatusComponents: 25,
    maxCustomRoles: 5,
    maxSendingDomains: 3,
    maxInboundEmailAddresses: 2,
    maxHelpCenterLocales: 3,
    maxStatusSubscribers: 1000,
  },
  enterprise: {
    maxBoards: null,
    maxPosts: null,
    maxTeamSeats: null,
    maxStatusComponents: null,
    maxCustomRoles: null,
    maxSendingDomains: null,
    maxInboundEmailAddresses: null,
    maxHelpCenterLocales: null,
    maxStatusSubscribers: null,
  },
}

export const FREE_PLAN_CAPS = PLAN_NUMERIC_CAPS.free

export type PlanCapKey = keyof (typeof PLAN_NUMERIC_CAPS)[PlanId]
export type FreeCapKey = PlanCapKey

export type PlanDowngradeIssue = {
  key: PlanCapKey
  used: number
  cap: number
  message: string
  actionLabel: string
  href: string
}

export type FreeDowngradeIssue = PlanDowngradeIssue

const RESOURCE: Record<PlanCapKey, { singular: string; plural: string; href: string }> = {
  maxBoards: { singular: 'board', plural: 'boards', href: '/admin/settings/boards' },
  maxPosts: { singular: 'post', plural: 'posts', href: '/admin/feedback' },
  maxTeamSeats: { singular: 'seat', plural: 'seats', href: '/admin/settings/members' },
  maxStatusComponents: {
    singular: 'status component',
    plural: 'status components',
    href: '/admin/settings/status',
  },
  maxCustomRoles: {
    singular: 'custom role',
    plural: 'custom roles',
    href: '/admin/settings/members',
  },
  maxSendingDomains: {
    singular: 'sending domain',
    plural: 'sending domains',
    href: '/admin/settings/domains',
  },
  maxInboundEmailAddresses: {
    singular: 'inbound email address',
    plural: 'inbound email addresses',
    href: '/admin/settings/channels/email',
  },
  maxHelpCenterLocales: {
    singular: 'help center language',
    plural: 'help center languages',
    href: '/admin/settings/help-center?tab=domains-languages',
  },
  maxStatusSubscribers: {
    singular: 'status subscriber',
    plural: 'status subscribers',
    href: '/admin/status?view=subscribers',
  },
}

/**
 * Plan features a downgrade can turn off, in display order, with the plans
 * that include each. `paused` is the wording with plan limits on: features
 * that were running keep running for 7 days after the drop, then pause, are
 * kept, and come back on upgrade (MCP, AI insights and the audit log stop at
 * once). `disabled` is the wording with plan limits off, where the plan change
 * itself turns them off. Copilot drafts and the REST API are on every plan, so
 * no downgrade loses them.
 */
const PLAN_FEATURES: ReadonlyArray<{
  paused: string
  disabled: string
  plans: readonly PlanId[]
}> = [
  {
    paused: 'Your custom domain redirects to your workspace address after 7 days.',
    disabled: 'Custom domains will be disabled',
    plans: ['pro', 'business', 'enterprise'],
  },
  {
    paused: 'Live workflows pause after 7 days. They are kept.',
    disabled: 'Workflows and automations will be disabled',
    plans: ['business', 'enterprise'],
  },
  {
    paused: 'Single sign-on turns off after 7 days. Your team signs in with email links.',
    disabled: 'Single sign-on will be disabled',
    plans: ['enterprise'],
  },
  {
    paused: 'The AI assistant stops answering after 7 days. AI insights stop now.',
    disabled: 'AI assistant and insights will be disabled',
    plans: ['pro', 'business', 'enterprise'],
  },
  {
    paused: 'AI article translation stops after 7 days. Published translations stay.',
    disabled: 'AI article translation will be disabled',
    plans: ['business', 'enterprise'],
  },
  {
    paused: 'Webhooks pause after 7 days. Endpoints are kept.',
    disabled: 'Webhooks will be disabled',
    plans: ['pro', 'business', 'enterprise'],
  },
  {
    paused: 'MCP access pauses. Keys are kept.',
    disabled: 'MCP access pauses. Keys are kept.',
    plans: ['pro', 'business', 'enterprise'],
  },
  {
    paused: 'The audit log is hidden. Entries are still recorded.',
    disabled: 'The audit log will be disabled',
    plans: ['enterprise'],
  },
]

/** Whether the plan limits rules (7-day grace, then pause) apply to this workspace. */
export type DowngradeCopyOptions = { planLimits?: boolean }

function featuresLost(
  fromPlanId: string,
  toPlanId: string,
  options: DowngradeCopyOptions
): string[] {
  const from = canonicalPlanId(fromPlanId)
  const to = canonicalPlanId(toPlanId)
  if (!isPlanId(from) || !isPlanId(to)) return []
  return PLAN_FEATURES.filter(
    (feature) => feature.plans.includes(from) && !feature.plans.includes(to)
  ).map((feature) => (options.planLimits ? feature.paused : feature.disabled))
}

export function usedByKey(lines: readonly PlanUsageLine[]): Record<string, number> {
  return Object.fromEntries(lines.map((line) => [line.key, line.used]))
}

/** Numeric caps to check usage against (null or absent = unlimited). */
export type PlanCaps = Partial<Record<PlanCapKey, number | null>>

/**
 * Caps that never block a plan change. Existing posts always stay: a plan
 * below its post cap only stops new ones, so posts are shown as information.
 */
export const NON_BLOCKING_CAP_KEYS: readonly PlanCapKey[] = ['maxPosts']

const ALL_CAP_KEYS = Object.keys(RESOURCE) as PlanCapKey[]

/** Usage over `caps`, one issue per key in `keys` (every cap key by default). */
export function capIssues(
  used: Record<string, number>,
  caps: PlanCaps,
  keys: readonly PlanCapKey[] = ALL_CAP_KEYS
): PlanDowngradeIssue[] {
  const issues: PlanDowngradeIssue[] = []
  for (const key of ALL_CAP_KEYS) {
    if (!keys.includes(key)) continue
    const cap = caps[key]
    if (cap == null) continue
    const count = used[key] ?? 0
    if (count <= cap) continue
    const remove = count - cap
    const noun = RESOURCE[key]
    const unit = remove === 1 ? noun.singular : noun.plural
    const have = count === 1 ? noun.singular : noun.plural
    issues.push({
      key,
      used: count,
      cap,
      message: `You have ${count} out of ${cap} ${have}`,
      actionLabel: `Remove ${remove} ${unit}`,
      href: noun.href,
    })
  }
  return issues
}

/** What must be resolved before switching to `planId`. Posts never block. */
export function planDowngradeIssues(
  used: Record<string, number>,
  planId: string
): PlanDowngradeIssue[] {
  const id = canonicalPlanId(planId)
  if (!isPlanId(id)) return []
  return capIssues(
    used,
    PLAN_NUMERIC_CAPS[id],
    ALL_CAP_KEYS.filter((key) => !NON_BLOCKING_CAP_KEYS.includes(key))
  )
}

/** A cap that is over but needs no fix: shown, never blocking. */
export type PlanCapInfo = { key: PlanCapKey; used: number; cap: number; message: string }

/** Usage over `planId`'s non-blocking caps (posts), for display only. */
export function planDowngradeInfo(used: Record<string, number>, planId: string): PlanCapInfo[] {
  const id = canonicalPlanId(planId)
  if (!isPlanId(id)) return []
  return capIssues(used, PLAN_NUMERIC_CAPS[id], NON_BLOCKING_CAP_KEYS).map(
    ({ key, used: count, cap, message }) => ({ key, used: count, cap, message })
  )
}

export function freeDowngradeIssues(used: Record<string, number>): PlanDowngradeIssue[] {
  return planDowngradeIssues(used, 'free')
}

export function featuresDisabledOnFree(
  planId: string | null | undefined,
  options: DowngradeCopyOptions = {}
): string[] {
  const from = planId ? canonicalPlanId(planId) : 'business'
  return featuresLost(isPlanId(from) ? from : 'business', 'free', options)
}

export function featuresDisabledOnDowngrade(
  fromPlanId: string | null | undefined,
  toPlanId: string,
  options: DowngradeCopyOptions = {}
): string[] {
  if (canonicalPlanId(toPlanId) === 'free') return featuresDisabledOnFree(fromPlanId, options)
  return fromPlanId ? featuresLost(fromPlanId, toPlanId, options) : []
}
