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
 * Plan features a downgrade can switch off, in display order, with the plans
 * that include each. Copilot drafts and the REST API are on every plan, so no
 * downgrade loses them.
 */
const PLAN_FEATURES: ReadonlyArray<{ lost: string; plans: readonly PlanId[] }> = [
  { lost: 'Custom domains will be disabled', plans: ['pro', 'business', 'enterprise'] },
  { lost: 'Workflows and automations will be disabled', plans: ['business', 'enterprise'] },
  { lost: 'Single sign-on will be disabled', plans: ['enterprise'] },
  { lost: 'AI assistant and insights will be disabled', plans: ['pro', 'business', 'enterprise'] },
  { lost: 'AI article translation will be disabled', plans: ['business', 'enterprise'] },
  { lost: 'Webhooks will be disabled', plans: ['pro', 'business', 'enterprise'] },
  { lost: 'MCP access will be revoked', plans: ['pro', 'business', 'enterprise'] },
  { lost: 'The audit log will be disabled', plans: ['enterprise'] },
]

function featuresLost(fromPlanId: string, toPlanId: string): string[] {
  const from = canonicalPlanId(fromPlanId)
  const to = canonicalPlanId(toPlanId)
  if (!isPlanId(from) || !isPlanId(to)) return []
  return PLAN_FEATURES.filter(
    (feature) => feature.plans.includes(from) && !feature.plans.includes(to)
  ).map((feature) => feature.lost)
}

export function usedByKey(lines: readonly PlanUsageLine[]): Record<string, number> {
  return Object.fromEntries(lines.map((line) => [line.key, line.used]))
}

export function planDowngradeIssues(
  used: Record<string, number>,
  planId: string
): PlanDowngradeIssue[] {
  const id = canonicalPlanId(planId)
  if (!isPlanId(id)) return []
  const caps = PLAN_NUMERIC_CAPS[id]
  const issues: PlanDowngradeIssue[] = []
  for (const key of Object.keys(RESOURCE) as PlanCapKey[]) {
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

export function freeDowngradeIssues(used: Record<string, number>): PlanDowngradeIssue[] {
  return planDowngradeIssues(used, 'free')
}

export function featuresDisabledOnFree(planId: string | null | undefined): string[] {
  const from = planId ? canonicalPlanId(planId) : 'business'
  return featuresLost(isPlanId(from) ? from : 'business', 'free')
}

export function featuresDisabledOnDowngrade(
  fromPlanId: string | null | undefined,
  toPlanId: string
): string[] {
  if (canonicalPlanId(toPlanId) === 'free') return featuresDisabledOnFree(fromPlanId)
  return fromPlanId ? featuresLost(fromPlanId, toPlanId) : []
}
