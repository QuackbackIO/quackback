import type { PlanUsageLine } from './plan-usage'

/** Numeric Free caps. Must match CP `FREE_TIER_LIMITS`. */
export const FREE_PLAN_CAPS = {
  maxBoards: 2,
  maxPosts: 50,
  maxTeamSeats: 1,
  maxStatusComponents: 3,
  maxCustomRoles: 0,
  maxSendingDomains: 0,
} as const

export type FreeCapKey = keyof typeof FREE_PLAN_CAPS

export type FreeDowngradeIssue = {
  key: FreeCapKey
  message: string
  actionLabel: string
  href: string
}

const RESOURCE: Record<FreeCapKey, { singular: string; plural: string; href: string }> = {
  maxBoards: { singular: 'board', plural: 'boards', href: '/admin/settings/boards' },
  maxPosts: { singular: 'post', plural: 'posts', href: '/admin' },
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
  pro: [
    'Custom domains will be disabled',
    'Workflows and automations will be disabled',
    'AI assistant, drafts and insights will be disabled',
    'API access will be revoked',
    'Webhooks will be disabled',
    'MCP access will be revoked',
  ],
  scale: [
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

export function freeDowngradeIssues(used: Record<string, number>): FreeDowngradeIssue[] {
  const issues: FreeDowngradeIssue[] = []
  for (const key of Object.keys(FREE_PLAN_CAPS) as FreeCapKey[]) {
    const cap = FREE_PLAN_CAPS[key]
    const count = used[key] ?? 0
    if (count <= cap) continue
    const remove = count - cap
    const noun = RESOURCE[key]
    const unit = remove === 1 ? noun.singular : noun.plural
    issues.push({
      key,
      message: `You have ${count} ${count === 1 ? noun.singular : noun.plural}`,
      actionLabel: `Remove ${remove} ${unit}`,
      href: noun.href,
    })
  }
  return issues
}

export function featuresDisabledOnFree(planId: string | null | undefined): string[] {
  if (!planId) return FREE_DISABLED_FEATURES.pro
  return FREE_DISABLED_FEATURES[planId] ?? FREE_DISABLED_FEATURES.pro
}
