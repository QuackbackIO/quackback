export type SeatUsage = { used: number; limit: number | null }

export function seatInviteBlocked(usage: SeatUsage | undefined): boolean {
  return usage != null && usage.limit != null && usage.used >= usage.limit
}

/** Cheapest advertised plan that lifts this seat cap. Matches CP definitions. */
export function seatUpgradePlanName(limit: number | null): string | null {
  if (limit == null) return null
  if (limit < 10) return 'Pro'
  return 'Scale'
}
