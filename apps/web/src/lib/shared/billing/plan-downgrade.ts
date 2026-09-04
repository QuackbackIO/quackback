import {
  canonicalPlanId,
  isPlanId,
  type PlanId,
} from '@/lib/server/domains/settings/cloud/cloud.types'
import type { PlanUsageLine } from './plan-usage'

/**
 * Numeric caps a workspace must fit before switching to that plan.
 * Must match CP `PLAN_DEFINITIONS` / `FREE_TIER_LIMITS` (null = unlimited).
 * Usage meters (AI, email, API) are not deletable resources and are omitted.
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
  }
> = {
  free: {
    maxBoards: 1,
    maxPosts: 50,
    maxTeamSeats: 1,
    maxStatusComponents: 3,
    maxCustomRoles: 0,
    maxSendingDomains: 0,
  },
  growth: {
    maxBoards: null,
    maxPosts: null,
    maxTeamSeats: null,
    maxStatusComponents: 10,
    maxCustomRoles: 0,
    maxSendingDomains: 1,
  },
  business: {
    maxBoards: null,
    maxPosts: null,
    maxTeamSeats: null,
    maxStatusComponents: 25,
    maxCustomRoles: 5,
    maxSendingDomains: 3,
  },
  enterprise: {
    maxBoards: null,
    maxPosts: null,
    maxTeamSeats: null,
    maxStatusComponents: null,
    maxCustomRoles: null,
    maxSendingDomains: null,
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
}

export const FREE_DISABLED_FEATURES: Record<string, string[]> = {
  growth: [
    'Custom domains will be disabled',
    'AI assistant, drafts and insights will be disabled',
    'API access will be revoked',
    'Webhooks will be disabled',
    'MCP access will be revoked',
  ],
  business: [
    'Custom domains will be disabled',
    'Workflows and automations will be disabled',
    'AI assistant, drafts and insights will be disabled',
    'API access will be revoked',
    'Webhooks will be disabled',
    'MCP access will be revoked',
  ],
  enterprise: [
    'Custom domains will be disabled',
    'Workflows and automations will be disabled',
    'Single sign-on will be disabled',
    'AI assistant, drafts and insights will be disabled',
    'API access will be revoked',
    'Webhooks will be disabled',
    'MCP access will be revoked',
    'The audit log will be disabled',
  ],
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
  if (!planId) return FREE_DISABLED_FEATURES.business
  return FREE_DISABLED_FEATURES[canonicalPlanId(planId)] ?? FREE_DISABLED_FEATURES.business
}

export function featuresDisabledOnDowngrade(
  fromPlanId: string | null | undefined,
  toPlanId: string
): string[] {
  return canonicalPlanId(toPlanId) === 'free' ? featuresDisabledOnFree(fromPlanId) : []
}
