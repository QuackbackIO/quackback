export type PlanUsageLine = {
  key: string
  label: string
  used: number
  limit: number | null
}

export function formatUsageLine(line: PlanUsageLine): string {
  if (line.limit == null) return `${line.used} ${line.label}`
  return `${line.used} of ${line.limit} ${line.label}`
}

export function finiteUsageLines(lines: PlanUsageLine[]): PlanUsageLine[] {
  return lines.filter((line) => line.limit != null)
}

/** Finite quotas the usage card can show, in display order. */
const USAGE_QUOTAS = [
  { key: 'maxBoards', label: 'boards' },
  { key: 'maxPosts', label: 'posts' },
  { key: 'maxTeamSeats', label: 'seats' },
  { key: 'maxStatusComponents', label: 'status components' },
  { key: 'maxCustomRoles', label: 'custom roles' },
  { key: 'maxSendingDomains', label: 'sending domains' },
  { key: 'maxInboundEmailAddresses', label: 'inbound email addresses' },
  { key: 'maxHelpCenterLocales', label: 'help center languages' },
  { key: 'maxStatusSubscribers', label: 'status subscribers' },
  { key: 'aiTokensPerMonth', label: 'AI tokens this month' },
  { key: 'emailsPerMonth', label: 'emails' },
  { key: 'apiRequestsPerMonth', label: 'API requests' },
] as const

type UsageKey = (typeof USAGE_QUOTAS)[number]['key']

/**
 * Usage against each quota, one line per key. A missing usage count reads as
 * zero and a missing limit reads as unlimited. Callers that render the card
 * filter out unlimited lines with {@link finiteUsageLines}.
 */
export function planUsageLines(
  limits: Partial<Record<UsageKey, number | null>>,
  used: Partial<Record<UsageKey, number>>
): PlanUsageLine[] {
  return USAGE_QUOTAS.map(({ key, label }) => ({
    key,
    label,
    used: used[key] ?? 0,
    limit: limits[key] ?? null,
  }))
}
