export type SeatUsage = {
  used: number
  limit: number | null
  members?: number
  pendingInvites?: number
}

export function seatInviteBlocked(usage: SeatUsage | undefined): boolean {
  return usage != null && usage.limit != null && usage.used >= usage.limit
}
